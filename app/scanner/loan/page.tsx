'use client'

import { useEffect, useRef, useState } from 'react'
import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { useStaff } from '@/app/context/StaffContext'

type StockChoice = {
  id: string
  location_name: string
  bin_code: string
  stock_level: number
}

type LoanItem = {
  id: string
  sku: string
  barcode_number?: string | null
  brand: string | null
  reporting_category: string | null
  tagged_size: string | null
  waist_in: string | number | null
  selling_price: number | null
  stock_level: number | null
  current_location?: string | null
  current_bin?: string | null
  loan_status: string | null
  loaned_at: string | null
  loan_notes: string | null
  ai_title: string | null
  basic_title: string | null
}

type LookupResult = {
  item: LoanItem
  available_locations: StockChoice[]
}

type PendingLoanOut = {
  scanValue: string
  item: LoanItem
  choices: StockChoice[]
}

type PendingReturn = {
  item: LoanItem
  returnLocation: string | null
  returnBin: string | null
  step: 'scan_bin' | 'scan_item'
}

type PreviewLabelItem = {
  sku: string
  sizeText?: string | null
  price?: number | null
}

function getSizeText(item: LoanItem) {
  if (
    item.waist_in !== null &&
    item.waist_in !== undefined &&
    item.waist_in !== ''
  ) {
    return `W${item.waist_in}"`
  }

  if (item.tagged_size) return item.tagged_size

  return ''
}

function openLabelPreview(items: PreviewLabelItem[]) {
  window.localStorage.setItem('label_preview_items', JSON.stringify(items))
  window.open('/labels/preview', '_blank')
}

function parseLoanNotes(value: string | null | undefined) {
  if (!value) return null

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function cleanScan(value: string) {
  return value.trim().replace(/\s+/g, '').toUpperCase()
}

function parseBinScan(value: string) {
  const cleaned = value.trim()
  const match = cleaned.match(/[?&]bin=([^&#]+)/i)

  if (match?.[1]) {
    return decodeURIComponent(match[1]).trim().toUpperCase()
  }

  return cleanScan(cleaned)
}

function splitLocationBin(binScan: string) {
  const clean = parseBinScan(binScan)

  if (!clean) return { location: '', bin: '' }

  if (clean.includes('/')) {
    const [location, ...rest] = clean.split('/')
    return {
      location: cleanScan(location),
      bin: rest.join('/').trim().toUpperCase(),
    }
  }

  if (clean.startsWith('SHOP-')) {
    const parts = clean.split('-')

    if (parts.length >= 3) {
      return {
        location: `${parts[0]}-${parts[1]}`,
        bin: parts.slice(2).join('-') || 'STOCK',
      }
    }
  }

  if (clean === 'WAREHOUSE' || clean === 'DEFAULT') {
    return {
      location: 'WAREHOUSE',
      bin: 'Default',
    }
  }

  return {
    location: 'WAREHOUSE',
    bin: clean,
  }
}

function validItemScan(item: LoanItem, scanned: string) {
  const clean = cleanScan(scanned)
  const valid = [item.sku, item.barcode_number]
    .filter(Boolean)
    .map((value) => cleanScan(String(value)))

  return valid.includes(clean)
}

export default function LoanPage() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { staff } = useStaff()

  const [scanValue, setScanValue] = useState('')
  const [loanItems, setLoanItems] = useState<LoanItem[]>([])
  const [selectedItems, setSelectedItems] = useState<string[]>([])
  const [pendingLoanOut, setPendingLoanOut] = useState<PendingLoanOut | null>(null)
  const [pendingReturn, setPendingReturn] = useState<PendingReturn | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetchLoans()
    focusInput()
  }, [])

  function focusInput() {
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  async function fetchLoans() {
    try {
      const response = await fetch('/api/scanner/loan', {
        method: 'GET',
        cache: 'no-store',
      })

      const data = await response.json()

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not fetch loans.')
      }

      setLoanItems((data.loans || []) as LoanItem[])
      setSelectedItems((prev) =>
        prev.filter((id) => (data.loans || []).some((item: LoanItem) => item.id === id))
      )
    } catch (error: any) {
      setMessage(error.message || 'Could not fetch loans.')
    }
  }

  function toggleSelected(itemId: string) {
    setSelectedItems((prev) =>
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId]
    )
  }

  function reprintSelectedLabels() {
    const selectedLoanItems = loanItems.filter((item) =>
      selectedItems.includes(item.id)
    )

    if (selectedLoanItems.length === 0) {
      setMessage('Select at least one item to reprint.')
      return
    }

    openLabelPreview(
      selectedLoanItems.map((item) => ({
        sku: item.barcode_number || item.sku,
        sizeText: getSizeText(item),
        price: item.selling_price,
      }))
    )
  }

  async function postLoanAction(body: Record<string, any>) {
    const response = await fetch('/api/scanner/loan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

    const data = await response.json()

    if (!response.ok || !data?.ok) {
      throw new Error(data?.message || 'Loan action failed.')
    }

    return data
  }

  async function handleScan() {
    const scanned = scanValue.trim()

    if (!scanned || busy) return

    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    setScanValue('')
    setMessage('')

    if (pendingReturn) {
      await handleReturnScan(scanned)
      focusInput()
      return
    }

    await lookupForLoanOut(scanned)
    focusInput()
  }

  async function lookupForLoanOut(scanned: string) {
    setBusy(true)
    setMessage('Checking available locations...')

    try {
      const data = await postLoanAction({
        action: 'lookup',
        scan_value: scanned,
      })

      const result = data.result as LookupResult

      if (result.item.loan_status === 'on_loan') {
        setMessage(`${result.item.sku} is already on loan.`)
        await fetchLoans()
        return
      }

      if (result.available_locations.length === 0) {
        setMessage(`${result.item.sku} has no available stock location to loan from.`)
        return
      }

      if (result.available_locations.length === 1) {
        await loanOutFromChoice(scanned, result.item, result.available_locations[0])
        return
      }

      setPendingLoanOut({
        scanValue: scanned,
        item: result.item,
        choices: result.available_locations,
      })

      setMessage(`Choose where ${result.item.sku} is being loaned from.`)
    } catch (error: any) {
      setMessage(error.message || 'Could not check loan item.')
    } finally {
      setBusy(false)
    }
  }

  async function loanOutFromChoice(scanned: string, item: LoanItem, choice: StockChoice) {
    if (!staff) return

    const confirmed = window.confirm(
      `Loan ${item.sku} from ${choice.location_name} / ${choice.bin_code} by ${staff.name}?\n\nThis will deduct 1 from that exact bin.`
    )

    if (!confirmed) {
      setMessage('Cancelled.')
      return
    }

    setBusy(true)
    setMessage('Marking item on loan...')

    try {
      const data = await postLoanAction({
        action: 'loan_out',
        scan_value: scanned,
        source_location: choice.location_name,
        source_bin: choice.bin_code,
        staff_id: staff.id,
        staff_name: staff.name,
      })

      const result = data.result

      setPendingLoanOut(null)
      setMessage(
        `${result.item.sku} marked on loan. Deducted from ${result.source_location} / ${result.source_bin}.`
      )

      await fetchLoans()
    } catch (error: any) {
      setMessage(error.message || 'Could not mark item on loan.')
    } finally {
      setBusy(false)
    }
  }

  function cancelLoanChoice() {
    setPendingLoanOut(null)
    setScanValue('')
    setMessage('Loan-out cancelled.')
    focusInput()
  }

  function startReturn(item: LoanItem) {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    setPendingReturn({
      item,
      returnLocation: null,
      returnBin: null,
      step: 'scan_bin',
    })
    setScanValue('')
    setMessage(`Scan destination bin QR first, then scan ${item.sku} to confirm return.`)
    focusInput()
  }

  function cancelReturn() {
    setPendingReturn(null)
    setScanValue('')
    setMessage('Return cancelled.')
    focusInput()
  }

  async function handleReturnScan(scanned: string) {
    if (!pendingReturn || !staff) return

    if (pendingReturn.step === 'scan_bin') {
      const parsed = splitLocationBin(scanned)

      if (!parsed.location || !parsed.bin) {
        setMessage('Could not read bin. Scan a bin QR/label first.')
        return
      }

      setPendingReturn({
        ...pendingReturn,
        returnLocation: parsed.location,
        returnBin: parsed.bin,
        step: 'scan_item',
      })

      setMessage(`Destination set to ${parsed.location} / ${parsed.bin}. Now scan item ${pendingReturn.item.sku}.`)
      return
    }

    if (!validItemScan(pendingReturn.item, scanned)) {
      setMessage(
        `Wrong item scanned. Expected ${pendingReturn.item.sku}${pendingReturn.item.barcode_number ? ` or ${pendingReturn.item.barcode_number}` : ''}.`
      )
      return
    }

    await markReturned(pendingReturn.item, scanned)
  }

  async function markReturned(item: LoanItem, scannedValue: string) {
    if (!staff || !pendingReturn?.returnLocation || !pendingReturn.returnBin) return

    const confirmed = window.confirm(
      `Return ${item.sku} to ${pendingReturn.returnLocation} / ${pendingReturn.returnBin} by ${staff.name}?\n\nStock will only increase after this confirmed scan.`
    )

    if (!confirmed) return

    setBusy(true)
    setMessage('Returning item...')

    try {
      const data = await postLoanAction({
        action: 'return',
        scan_value: scannedValue,
        return_location: pendingReturn.returnLocation,
        return_bin: pendingReturn.returnBin,
        staff_id: staff.id,
        staff_name: staff.name,
      })

      const result = data.result

      setPendingReturn(null)
      setSelectedItems((prev) => prev.filter((id) => id !== item.id))
      setMessage(
        `${result.item.sku} returned to ${result.destination_location} / ${result.destination_bin}.`
      )

      await fetchLoans()
      focusInput()
    } catch (error: any) {
      setMessage(error.message || 'Could not return item.')
    } finally {
      setBusy(false)
    }
  }

  function formatDate(value: string | null) {
    if (!value) return '-'

    return new Date(value).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function getOriginalLocationText(item: LoanItem) {
    const notes = parseLoanNotes(item.loan_notes)

    if (!notes?.source_location && !notes?.source_bin) return 'Original location unknown'

    return `${notes.source_location || 'Original'} / ${notes.source_bin || 'Default'}`
  }

  return (
    <StaffPermissionGate permission="scanner">
      <main
        className="min-h-screen bg-neutral-950 p-3 text-white select-none sm:p-5"
        onClick={focusInput}
      >
        <div className="mx-auto max-w-5xl space-y-4">
          <header className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h1 className="text-2xl font-bold sm:text-3xl">Loans</h1>

                <p className="text-sm text-neutral-400">
                  Loan-out asks which location/bin to deduct from if stock exists in more than one place. Return requires scanning destination bin first, then item barcode/SKU.
                </p>

                {staff ? (
                  <p className="mt-2 text-sm font-bold text-green-300">
                    Active staff: {staff.name}
                  </p>
                ) : (
                  <p className="mt-2 text-sm font-bold text-yellow-300">
                    No active staff selected
                  </p>
                )}
              </div>

              <AppNav current="loan" />
            </div>
          </header>

          {pendingLoanOut && (
            <section className="rounded-2xl border border-blue-700 bg-blue-950 p-4">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-black text-blue-200">
                    Choose Loan Source
                  </h2>

                  <p className="font-mono text-lg font-black">
                    {pendingLoanOut.item.sku}
                  </p>

                  <p className="text-sm text-blue-200">
                    This item has stock in multiple locations. Choose exactly where it is being loaned from.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={cancelLoanChoice}
                  className="rounded-xl border border-blue-500 px-4 py-3 text-sm font-black text-blue-100"
                >
                  CANCEL
                </button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {pendingLoanOut.choices.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() =>
                      loanOutFromChoice(pendingLoanOut.scanValue, pendingLoanOut.item, choice)
                    }
                    disabled={busy}
                    className="rounded-xl border border-blue-700 bg-blue-900 p-4 text-left hover:border-white disabled:opacity-50"
                  >
                    <p className="text-lg font-black">
                      {choice.location_name} / {choice.bin_code}
                    </p>
                    <p className="mt-1 text-sm text-blue-200">
                      Available: {choice.stock_level}
                    </p>
                  </button>
                ))}
              </div>
            </section>
          )}

          {pendingReturn && (
            <section className="rounded-2xl border border-orange-700 bg-orange-950 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-black text-orange-200">
                    Return Scan Required
                  </h2>

                  <p className="text-sm text-orange-200">
                    {pendingReturn.step === 'scan_bin'
                      ? 'Scan destination bin QR/label first.'
                      : `Destination: ${pendingReturn.returnLocation} / ${pendingReturn.returnBin}. Now scan item ${pendingReturn.item.sku}.`}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={cancelReturn}
                  className="rounded-xl border border-orange-500 px-4 py-3 text-sm font-black text-orange-100"
                >
                  CANCEL RETURN
                </button>
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            <h2 className="mb-3 text-2xl font-black">
              {pendingReturn
                ? pendingReturn.step === 'scan_bin'
                  ? 'Scan Return Bin'
                  : 'Scan Item to Confirm Return'
                : 'Scan Item Out on Loan'}
            </h2>

            <input
              ref={inputRef}
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleScan()
              }}
              placeholder={
                staff
                  ? pendingReturn
                    ? pendingReturn.step === 'scan_bin'
                      ? 'Scan destination bin QR/label'
                      : 'Scan same item barcode/SKU'
                    : 'Scan item SKU or barcode'
                  : 'Go to staff PIN screen first'
              }
              disabled={busy || !staff || Boolean(pendingLoanOut)}
              inputMode="none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-5 font-mono text-2xl font-bold outline-none focus:border-white disabled:opacity-50"
              autoFocus
            />

            <button
              onClick={handleScan}
              disabled={busy || !scanValue.trim() || !staff || Boolean(pendingLoanOut)}
              className="mt-3 w-full rounded-xl bg-white px-5 py-5 text-xl font-black text-black disabled:opacity-50"
            >
              {busy
                ? 'PROCESSING...'
                : pendingReturn
                  ? pendingReturn.step === 'scan_bin'
                    ? 'SET RETURN BIN'
                    : 'CONFIRM RETURN'
                  : 'MARK ON LOAN'}
            </button>
          </section>

          {message && (
            <section className="rounded-2xl border border-yellow-800 bg-yellow-950 p-4">
              <p className="text-lg font-bold text-yellow-300">{message}</p>
            </section>
          )}

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-2xl font-black">Currently On Loan</h2>

                <p className="text-sm text-neutral-400">
                  {loanItems.length} item(s) on loan · {selectedItems.length}{' '}
                  selected
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:flex">
                <button
                  onClick={fetchLoans}
                  disabled={busy}
                  className="rounded-xl border border-neutral-700 px-4 py-4 text-sm font-black disabled:opacity-40"
                >
                  REFRESH
                </button>

                <button
                  onClick={reprintSelectedLabels}
                  disabled={selectedItems.length === 0}
                  className="rounded-xl bg-white px-4 py-4 text-sm font-black text-black disabled:opacity-40"
                >
                  {selectedItems.length === 1
                    ? 'PRINT SELECTED LABEL'
                    : 'PRINT SELECTED LABELS'}
                </button>
              </div>
            </div>

            {loanItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-neutral-800 p-8 text-center text-neutral-500">
                No items currently on loan.
              </div>
            ) : (
              <div className="space-y-2">
                {loanItems.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-xl border bg-neutral-950 p-4 ${
                      selectedItems.includes(item.id)
                        ? 'border-white'
                        : 'border-neutral-800'
                    }`}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex min-w-0 gap-3">
                        <input
                          type="checkbox"
                          checked={selectedItems.includes(item.id)}
                          onChange={() => toggleSelected(item.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1 h-6 w-6 shrink-0"
                        />

                        <div className="min-w-0">
                          <p className="font-mono text-xl font-black">
                            {item.sku}
                          </p>

                          {item.barcode_number && (
                            <p className="font-mono text-xs text-neutral-500">
                              Barcode: {item.barcode_number}
                            </p>
                          )}

                          <p className="truncate text-sm text-neutral-300">
                            {item.ai_title || item.basic_title || 'Untitled item'}
                          </p>

                          <p className="mt-1 text-sm text-neutral-400">
                            {item.brand || 'No brand'} ·{' '}
                            {item.reporting_category || 'No category'} ·{' '}
                            {getSizeText(item) || 'No size'} · Loaned:{' '}
                            {formatDate(item.loaned_at)}
                          </p>

                          <p className="mt-1 text-xs text-orange-300">
                            Loaned from: {getOriginalLocationText(item)}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 sm:flex">
                        <button
                          onClick={() => startReturn(item)}
                          disabled={busy || !staff}
                          className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white hover:bg-blue-500 disabled:opacity-40"
                        >
                          RETURN / SCAN BIN
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </StaffPermissionGate>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { useStaff } from '@/app/context/StaffContext'

type ReturnTarget = 'original' | 'shop' | 'warehouse'

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

export default function LoanPage() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { staff } = useStaff()

  const [scanValue, setScanValue] = useState('')
  const [loanItems, setLoanItems] = useState<LoanItem[]>([])
  const [selectedItems, setSelectedItems] = useState<string[]>([])
  const [pendingReturn, setPendingReturn] = useState<{
    item: LoanItem
    target: ReturnTarget
  } | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetchLoans()
    focusInput()
  }, [])

  function focusInput() {
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function cleanScan(value: string) {
    return value.trim().replace(/\s+/g, '').toUpperCase()
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

  async function handleScan() {
    const scanned = cleanScan(scanValue)

    if (!scanned || busy) return

    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    setScanValue('')
    setMessage('')

    if (pendingReturn) {
      await confirmReturnScan(scanned)
      focusInput()
      return
    }

    await loanOutItem(scanned)
    focusInput()
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

  async function loanOutItem(scanned: string) {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    const confirmed = window.confirm(
      `Mark scanned item ${scanned} as ON LOAN by ${staff.name}?\n\nThis will deduct 1 from its current app stock location/bin.`
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
        staff_id: staff.id,
        staff_name: staff.name,
      })

      const result = data.result

      setMessage(
        `${result.item.sku} marked on loan by ${staff.name}. Deducted from ${result.source_location} / ${result.source_bin}.`
      )

      await fetchLoans()
    } catch (error: any) {
      setMessage(error.message || 'Could not mark item on loan.')
    } finally {
      setBusy(false)
    }
  }

  function startReturn(item: LoanItem, target: ReturnTarget) {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    setPendingReturn({ item, target })
    setScanValue('')

    const targetText =
      target === 'original'
        ? 'ORIGINAL LOCATION'
        : target === 'shop'
          ? 'SHOP-1 / STOCK'
          : 'WAREHOUSE / Default'

    setMessage(`Scan ${item.sku} or barcode now to confirm return to ${targetText}.`)
    focusInput()
  }

  function cancelReturn() {
    setPendingReturn(null)
    setScanValue('')
    setMessage('Return cancelled.')
    focusInput()
  }

  async function confirmReturnScan(scannedValue: string) {
    if (!pendingReturn || !staff) return

    const item = pendingReturn.item
    const scanned = cleanScan(scannedValue)
    const validValues = [item.sku, item.barcode_number].filter(Boolean).map((value) => cleanScan(String(value)))

    if (!validValues.includes(scanned)) {
      setMessage(
        `Wrong item scanned. Expected ${item.sku}${item.barcode_number ? ` or ${item.barcode_number}` : ''}, scanned ${scanned}.`
      )
      return
    }

    await markReturned(item, pendingReturn.target, scanned)
  }

  async function markReturned(item: LoanItem, target: ReturnTarget, scannedValue: string) {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    const targetText =
      target === 'original'
        ? 'original location/bin'
        : target === 'shop'
          ? 'SHOP-1 / STOCK'
          : 'WAREHOUSE / Default'

    const confirmed = window.confirm(
      `Return ${item.sku} to ${targetText} by ${staff.name}?\n\nStock will only increase after this confirmed scan.`
    )

    if (!confirmed) return

    setBusy(true)
    setMessage('Returning item...')

    try {
      const data = await postLoanAction({
        action: 'return',
        scan_value: scannedValue,
        target,
        staff_id: staff.id,
        staff_name: staff.name,
      })

      const result = data.result

      setPendingReturn(null)
      setSelectedItems((prev) => prev.filter((id) => id !== item.id))
      setMessage(
        `${result.item.sku} returned to ${result.destination_location} / ${result.destination_bin} by ${staff.name}.`
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

    if (!notes?.source_location && !notes?.source_bin) return 'Original location'

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
                  Scan SKU or barcode. Loaning out deducts from the current stock location/bin. Returns add stock only after the return destination is confirmed.
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

          {pendingReturn && (
            <section className="rounded-2xl border border-orange-700 bg-orange-950 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-black text-orange-200">
                    Confirm Return Scan
                  </h2>

                  <p className="text-sm text-orange-200">
                    Scan{' '}
                    <span className="font-mono font-black">
                      {pendingReturn.item.sku}
                    </span>
                    {pendingReturn.item.barcode_number ? (
                      <>
                        {' '}or barcode{' '}
                        <span className="font-mono font-black">
                          {pendingReturn.item.barcode_number}
                        </span>
                      </>
                    ) : null}{' '}
                    to return to{' '}
                    {pendingReturn.target === 'original'
                      ? getOriginalLocationText(pendingReturn.item)
                      : pendingReturn.target === 'shop'
                        ? 'SHOP-1 / STOCK'
                        : 'WAREHOUSE / Default'}
                    .
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
              {pendingReturn ? 'Scan Item to Confirm Return' : 'Scan Item Out on Loan'}
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
                    ? 'Scan same SKU/barcode to confirm return'
                    : 'Scan item SKU or barcode'
                  : 'Go to staff PIN screen first'
              }
              disabled={busy || !staff}
              inputMode="none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-5 font-mono text-2xl font-bold outline-none focus:border-white disabled:opacity-50"
              autoFocus
            />

            <button
              onClick={handleScan}
              disabled={busy || !scanValue.trim() || !staff}
              className="mt-3 w-full rounded-xl bg-white px-5 py-5 text-xl font-black text-black disabled:opacity-50"
            >
              {busy
                ? 'PROCESSING...'
                : pendingReturn
                  ? 'CONFIRM RETURN'
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
                            Original: {getOriginalLocationText(item)}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 sm:flex">
                        <button
                          onClick={() => startReturn(item, 'original')}
                          disabled={busy || !staff}
                          className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-40"
                        >
                          RETURN ORIGINAL
                        </button>

                        <button
                          onClick={() => startReturn(item, 'shop')}
                          disabled={busy || !staff}
                          className="rounded-xl bg-green-600 px-4 py-3 text-sm font-black text-white hover:bg-green-500 disabled:opacity-40"
                        >
                          RETURN SHOP STOCK
                        </button>

                        <button
                          onClick={() => startReturn(item, 'warehouse')}
                          disabled={busy || !staff}
                          className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white hover:bg-blue-500 disabled:opacity-40"
                        >
                          RETURN WAREHOUSE
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

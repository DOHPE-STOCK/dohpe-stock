'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import AppNav from '@/app/components/AppNav'
import { useStaff } from '@/app/context/StaffContext'

type ReturnTarget = 'shop' | 'warehouse'

type LoanItem = {
  id: string
  sku: string
  brand: string | null
  reporting_category: string | null
  tagged_size: string | null
  waist_in: string | number | null
  selling_price: number | null
  stock_level: number | null
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
    return value.trim().replace(/\s+/g, '')
  }

  function isValidSku(value: string) {
    return /^\d{10}$/.test(value)
  }

  function getCurrentStockLevel(value: number | null | undefined) {
    const stock = Number(value ?? 0)
    return Number.isFinite(stock) ? stock : 0
  }

  async function fetchLoans() {
    const { data, error } = await supabase
      .from('items')
      .select(`
        id,
        sku,
        brand,
        reporting_category,
        tagged_size,
        waist_in,
        selling_price,
        stock_level,
        loan_status,
        loaned_at,
        loan_notes,
        ai_title,
        basic_title
      `)
      .eq('loan_status', 'on_loan')
      .order('loaned_at', { ascending: false })

    if (error) {
      setMessage(error.message)
      return
    }

    setLoanItems((data || []) as LoanItem[])
    setSelectedItems((prev) =>
      prev.filter((id) => (data || []).some((item) => item.id === id))
    )
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
        sku: item.sku,
        sizeText: getSizeText(item),
        price: item.selling_price,
      }))
    )
  }

  async function handleScan() {
    const sku = cleanScan(scanValue)

    if (!sku || busy) return

    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    setScanValue('')
    setMessage('')

    if (!isValidSku(sku)) {
      setMessage(`Invalid SKU: ${sku}`)
      focusInput()
      return
    }

    if (pendingReturn) {
      await confirmReturnScan(sku)
      focusInput()
      return
    }

    await loanOutItem(sku)
    focusInput()
  }

  async function loanOutItem(sku: string) {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    setBusy(true)
    setMessage('Checking item...')

    const { data: item, error: itemError } = await supabase
      .from('items')
      .select(`
        id,
        sku,
        brand,
        reporting_category,
        tagged_size,
        waist_in,
        selling_price,
        stock_level,
        loan_status,
        loaned_at,
        loan_notes,
        ai_title,
        basic_title
      `)
      .eq('sku', sku)
      .maybeSingle()

    if (itemError) {
      setBusy(false)
      setMessage(itemError.message)
      return
    }

    if (!item) {
      setBusy(false)
      setMessage(`Item not found: ${sku}`)
      return
    }

    const itemRow = item as LoanItem

    if (itemRow.loan_status === 'on_loan') {
      setBusy(false)
      setMessage(`${sku} is already on loan.`)
      await fetchLoans()
      return
    }

    const currentStockLevel = getCurrentStockLevel(itemRow.stock_level)
    const newStockLevel = Math.max(0, currentStockLevel - 1)

    const confirmed = window.confirm(
      `Mark SKU ${sku} as ON LOAN by ${staff.name}?\n\nStock level will change from ${currentStockLevel} to ${newStockLevel}.`
    )

    if (!confirmed) {
      setBusy(false)
      setMessage('Cancelled.')
      return
    }

    const now = new Date().toISOString()

    const { error: updateError } = await supabase
      .from('items')
      .update({
        stock_level: newStockLevel,
        loan_status: 'on_loan',
        loaned_at: now,
        loan_returned_at: null,
        loaned_by: staff.id,
        linnworks_location_sync_status: 'pending',
        updated_at: now,
      })
      .eq('id', itemRow.id)

    if (updateError) {
      setBusy(false)
      setMessage(updateError.message)
      return
    }

    const { error: loanError } = await supabase.from('item_loans').insert({
      item_id: itemRow.id,
      sku: itemRow.sku,
      status: 'on_loan',
      loaned_at: now,
      loaned_by: staff.id,
    })

    if (loanError) {
      setBusy(false)
      setMessage(loanError.message)
      return
    }

    const { error: queueError } = await supabase
      .from('linnworks_sync_queue')
      .insert({
        item_id: itemRow.id,
        sku: itemRow.sku,
        action: 'update_stock',
        payload: {
          sku: itemRow.sku,
          stock_level: newStockLevel,
          quantity_change: -1,
          reason: 'loan_out',
          source: 'dohpe_app',
          loaned_at: now,
          loaned_by: staff.name,
        },
        status: 'pending',
      })

    if (queueError) {
      setBusy(false)
      setMessage(queueError.message)
      return
    }

    setBusy(false)
    setMessage(
      `${sku} marked as on loan by ${staff.name}. Stock ${currentStockLevel} → ${newStockLevel}.`
    )
    await fetchLoans()
  }

  function startReturn(item: LoanItem, target: ReturnTarget) {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    setPendingReturn({ item, target })
    setScanValue('')
    setMessage(
      `Scan SKU ${item.sku} now to confirm return to ${
        target === 'shop' ? 'SHOP' : 'WAREHOUSE'
      }.`
    )
    focusInput()
  }

  function cancelReturn() {
    setPendingReturn(null)
    setScanValue('')
    setMessage('Return cancelled.')
    focusInput()
  }

  async function confirmReturnScan(scannedSku: string) {
    if (!pendingReturn) return

    if (scannedSku !== pendingReturn.item.sku) {
      setMessage(
        `Wrong SKU scanned. Expected ${pendingReturn.item.sku}, scanned ${scannedSku}.`
      )
      return
    }

    await markReturned(pendingReturn.item, pendingReturn.target)
  }

  async function markReturned(item: LoanItem, target: ReturnTarget) {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    const returnLocation = target === 'shop' ? 'SHOP-1' : 'WAREHOUSE'
    const returnReason =
      target === 'shop' ? 'loan_returned_to_shop' : 'loan_returned_to_warehouse'

    const currentStockLevel = getCurrentStockLevel(item.stock_level)
    const newStockLevel = currentStockLevel + 1

    const confirmed = window.confirm(
      `Return SKU ${item.sku} to ${returnLocation} by ${staff.name}?\n\nStock level will change from ${currentStockLevel} to ${newStockLevel}.`
    )

    if (!confirmed) return

    setBusy(true)
    setMessage('Returning item...')

    const now = new Date().toISOString()

    const { error: updateError } = await supabase
      .from('items')
      .update({
        stock_level: newStockLevel,
        loan_status: 'not_on_loan',
        loan_returned_at: now,
        loan_notes: null,
        returned_by: staff.id,
        current_location: returnLocation,
        current_bin: returnLocation,
        location_status: 'available',
        linnworks_location_sync_status: 'pending',
        updated_at: now,
      })
      .eq('id', item.id)

    if (updateError) {
      setBusy(false)
      setMessage(updateError.message)
      return
    }

    const { error: loanUpdateError } = await supabase
      .from('item_loans')
      .update({
        status: 'returned',
        returned_at: now,
        returned_by: staff.id,
        updated_at: now,
      })
      .eq('item_id', item.id)
      .eq('status', 'on_loan')

    if (loanUpdateError) {
      setBusy(false)
      setMessage(loanUpdateError.message)
      return
    }

    const { error: queueError } = await supabase
      .from('linnworks_sync_queue')
      .insert({
        item_id: item.id,
        sku: item.sku,
        action: 'update_stock',
        payload: {
          sku: item.sku,
          stock_level: newStockLevel,
          quantity_change: 1,
          location: returnLocation,
          bin: returnLocation,
          reason: returnReason,
          source: 'dohpe_app',
          returned_at: now,
          returned_by: staff.name,
        },
        status: 'pending',
      })

    if (queueError) {
      setBusy(false)
      setMessage(queueError.message)
      return
    }

    setPendingReturn(null)
    setSelectedItems((prev) => prev.filter((id) => id !== item.id))
    setBusy(false)
    setMessage(
      `${item.sku} returned to ${returnLocation} by ${staff.name}. Stock ${currentStockLevel} → ${newStockLevel}.`
    )
    await fetchLoans()
    focusInput()
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

  return (
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
                Scan SKU before removing the tag. Return items here to reprint
                labels and put stock back live.
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
                  Scan SKU{' '}
                  <span className="font-mono font-black">
                    {pendingReturn.item.sku}
                  </span>{' '}
                  to return to{' '}
                  {pendingReturn.target === 'shop' ? 'SHOP' : 'WAREHOUSE'}.
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
            {pendingReturn ? 'Scan SKU to Confirm Return' : 'Scan Item Out on Loan'}
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
                  ? `Scan ${pendingReturn.item.sku} to confirm return`
                  : 'Scan item SKU'
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

                        <p className="truncate text-sm text-neutral-300">
                          {item.ai_title || item.basic_title || 'Untitled item'}
                        </p>

                        <p className="mt-1 text-sm text-neutral-400">
                          {item.brand || 'No brand'} ·{' '}
                          {item.reporting_category || 'No category'} ·{' '}
                          {getSizeText(item) || 'No size'} · Loaned:{' '}
                          {formatDate(item.loaned_at)}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:flex">
                      <button
                        onClick={() => startReturn(item, 'shop')}
                        disabled={busy || !staff}
                        className="rounded-xl bg-green-600 px-4 py-3 text-sm font-black text-white hover:bg-green-500 disabled:opacity-40"
                      >
                        RETURN TO SHOP
                      </button>

                      <button
                        onClick={() => startReturn(item, 'warehouse')}
                        disabled={busy || !staff}
                        className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white hover:bg-blue-500 disabled:opacity-40"
                      >
                        RETURN TO WAREHOUSE
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
  )
}
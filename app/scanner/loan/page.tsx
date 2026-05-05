'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import AppNav from '@/app/components/AppNav'

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

  if (item.tagged_size) {
    return item.tagged_size
  }

  return ''
}

function openLabelPreview(items: PreviewLabelItem[]) {
  window.localStorage.setItem('label_preview_items', JSON.stringify(items))
  window.open('/labels/preview', '_blank')
}

export default function LoanPage() {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [scanValue, setScanValue] = useState('')
  const [loanItems, setLoanItems] = useState<LoanItem[]>([])
  const [selectedItems, setSelectedItems] = useState<string[]>([])
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

    setScanValue('')
    setMessage('')

    if (!isValidSku(sku)) {
      setMessage(`Invalid SKU: ${sku}`)
      focusInput()
      return
    }

    await loanOutItem(sku)
    focusInput()
  }

  async function loanOutItem(sku: string) {
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

    const confirmed = window.confirm(
      `Mark SKU ${sku} as ON LOAN?\n\nThis will set stock level to 0.`
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
        stock_level: 0,
        loan_status: 'on_loan',
        loaned_at: now,
        loan_returned_at: null,
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
          stock_level: 0,
          reason: 'loan_out',
          loaned_at: now,
        },
        status: 'pending',
      })

    if (queueError) {
      setBusy(false)
      setMessage(queueError.message)
      return
    }

    setBusy(false)
    setMessage(`${sku} marked as on loan.`)
    await fetchLoans()
  }

  async function markReturned(item: LoanItem) {
    const confirmed = window.confirm(
      `Mark SKU ${item.sku} as RETURNED?\n\nThis will set stock level back to 1.`
    )

    if (!confirmed) return

    setBusy(true)
    setMessage('Returning item...')

    const now = new Date().toISOString()

    const { error: updateError } = await supabase
      .from('items')
      .update({
        stock_level: 1,
        loan_status: 'not_on_loan',
        loan_returned_at: now,
        loan_notes: null,
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
          stock_level: 1,
          reason: 'loan_returned',
          returned_at: now,
        },
        status: 'pending',
      })

    if (queueError) {
      setBusy(false)
      setMessage(queueError.message)
      return
    }

    setSelectedItems((prev) => prev.filter((id) => id !== item.id))
    setBusy(false)
    setMessage(`${item.sku} returned and back in stock.`)
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
            </div>

            <AppNav current="loan" />
          </div>
        </header>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 text-2xl font-black">Scan Item Out on Loan</h2>

          <input
            ref={inputRef}
            value={scanValue}
            onChange={(e) => setScanValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleScan()
            }}
            placeholder="Scan item SKU"
            disabled={busy}
            inputMode="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-5 font-mono text-2xl font-bold outline-none focus:border-white disabled:opacity-50"
            autoFocus
          />

          <button
            onClick={handleScan}
            disabled={busy || !scanValue.trim()}
            className="mt-3 w-full rounded-xl bg-white px-5 py-5 text-xl font-black text-black disabled:opacity-50"
          >
            {busy ? 'PROCESSING...' : 'MARK ON LOAN'}
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
                        onClick={() => markReturned(item)}
                        disabled={busy}
                        className="rounded-xl bg-green-600 px-4 py-3 text-sm font-black text-white hover:bg-green-500 disabled:opacity-40"
                      >
                        RETURN / IN STOCK
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
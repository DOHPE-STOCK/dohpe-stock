'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
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
  current_location: string | null
  current_bin: string | null
}

type PreviewLabelItem = {
  sku: string
  sizeText?: string | null
  price?: number | null
}

type StockLocationRow = {
  id: string
  item_id: string
  sku: string
  location_name: string | null
  bin_code: string | null
  stock_level: number | null
}

const WAREHOUSE_LOCATION = 'WAREHOUSE'
const WAREHOUSE_BIN = 'Default'
const DEFAULT_SHOP_LOCATION = 'SHOP-1'
const DEFAULT_SHOP_RETURN_BIN = 'STOCK'

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function canonicalLocation(value: any) {
  const clean = text(value)
  const lower = clean.toLowerCase()

  if (!clean) return WAREHOUSE_LOCATION
  if (lower === 'default' || lower === 'warehouse') return WAREHOUSE_LOCATION

  return clean.toUpperCase().startsWith('SHOP-') ? clean.toUpperCase() : clean
}

function normaliseBin(value: any, locationName?: string) {
  const clean = text(value)
  if (clean) return clean

  if (canonicalLocation(locationName) === WAREHOUSE_LOCATION) return WAREHOUSE_BIN
  return DEFAULT_SHOP_RETURN_BIN
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

function getCurrentStockLevel(value: number | null | undefined) {
  const stock = Number(value ?? 0)
  return Number.isFinite(stock) ? stock : 0
}

function getReturnDestination(target: ReturnTarget) {
  if (target === 'shop') {
    return {
      location: DEFAULT_SHOP_LOCATION,
      bin: DEFAULT_SHOP_RETURN_BIN,
      reason: 'loan_returned_to_shop',
    }
  }

  return {
    location: WAREHOUSE_LOCATION,
    bin: WAREHOUSE_BIN,
    reason: 'loan_returned_to_warehouse',
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
        basic_title,
        current_location,
        current_bin
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

  async function getItemStockRows(itemId: string) {
    const { data, error } = await supabase
      .from('item_stock_locations')
      .select('id, item_id, sku, location_name, bin_code, stock_level')
      .eq('item_id', itemId)

    if (error) throw new Error(error.message)

    return (data || []) as StockLocationRow[]
  }

  function chooseLoanSourceRow(item: LoanItem, rows: StockLocationRow[]) {
    const currentLocation = canonicalLocation(item.current_location)
    const currentBin = text(item.current_bin)

    const positiveRows = rows.filter((row) => Number(row.stock_level || 0) > 0)

    if (currentLocation && currentBin) {
      const exact = positiveRows.find(
        (row) =>
          canonicalLocation(row.location_name) === currentLocation &&
          text(row.bin_code).toLowerCase() === currentBin.toLowerCase()
      )

      if (exact) return exact
    }

    const currentLocationFallback = positiveRows.find(
      (row) => canonicalLocation(row.location_name) === currentLocation
    )

    if (currentLocationFallback) return currentLocationFallback

    return [...positiveRows].sort(
      (a, b) => Number(b.stock_level || 0) - Number(a.stock_level || 0)
    )[0] || null
  }

  async function updateExistingStockRow(rowId: string, stockLevel: number, source: string) {
    const { error } = await supabase
      .from('item_stock_locations')
      .update({
        stock_level: stockLevel,
        source,
        updated_at: new Date().toISOString(),
      })
      .eq('id', rowId)

    if (error) throw new Error(error.message)
  }

  async function upsertStockLocation(params: {
    itemId: string
    sku: string
    locationName: string
    binCode: string
    delta: number
    source: string
  }) {
    const locationName = canonicalLocation(params.locationName)
    const binCode = normaliseBin(params.binCode, locationName)
    const now = new Date().toISOString()

    const { data, error } = await supabase
      .from('item_stock_locations')
      .select('id, stock_level')
      .eq('item_id', params.itemId)
      .eq('location_name', locationName)
      .eq('bin_code', binCode)
      .limit(1)

    if (error) throw new Error(error.message)

    const existing = data?.[0]
    const nextStock = Number(existing?.stock_level || 0) + params.delta

    if (nextStock < 0) {
      throw new Error(
        `${params.sku} does not have enough stock in ${locationName} / ${binCode}.`
      )
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from('item_stock_locations')
        .update({
          stock_level: nextStock,
          source: params.source,
          updated_at: now,
        })
        .eq('id', existing.id)

      if (updateError) throw new Error(updateError.message)
      return { locationName, binCode, stockLevel: nextStock }
    }

    const { error: insertError } = await supabase
      .from('item_stock_locations')
      .insert({
        item_id: params.itemId,
        sku: params.sku,
        location_name: locationName,
        location_id: null,
        bin_code: binCode,
        stock_level: nextStock,
        source: params.source,
        synced_at: null,
        updated_at: now,
      })

    if (insertError) throw new Error(insertError.message)

    return { locationName, binCode, stockLevel: nextStock }
  }

  async function updateItemStockSummary(itemId: string) {
    const rows = await getItemStockRows(itemId)

    const stockLevel = rows.reduce(
      (sum, row) => sum + Number(row.stock_level || 0),
      0
    )

    const warehouseStock = rows
      .filter((row) => canonicalLocation(row.location_name) === WAREHOUSE_LOCATION)
      .reduce((sum, row) => sum + Number(row.stock_level || 0), 0)

    const shopFloorStock = rows
      .filter(
        (row) =>
          canonicalLocation(row.location_name).startsWith('SHOP-') &&
          text(row.bin_code).toUpperCase() === 'FLOOR'
      )
      .reduce((sum, row) => sum + Number(row.stock_level || 0), 0)

    const displayRow =
      rows
        .filter((row) => Number(row.stock_level || 0) > 0)
        .sort((a, b) => Number(b.stock_level || 0) - Number(a.stock_level || 0))[0] || null

    const payload = {
      stock_level: stockLevel,
      warehouse_stock: warehouseStock,
      shop_floor_stock: shopFloorStock,
      current_location: displayRow ? canonicalLocation(displayRow.location_name) : null,
      current_bin: displayRow?.bin_code || null,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase.from('items').update(payload).eq('id', itemId)

    if (error) throw new Error(error.message)

    return payload
  }

  async function loanOutItem(sku: string) {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    setBusy(true)
    setMessage('Checking item...')

    try {
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
          basic_title,
          current_location,
          current_bin
        `)
        .eq('sku', sku)
        .maybeSingle()

      if (itemError) throw new Error(itemError.message)

      if (!item) {
        setMessage(`Item not found: ${sku}`)
        return
      }

      const itemRow = item as LoanItem

      if (itemRow.loan_status === 'on_loan') {
        setMessage(`${sku} is already on loan.`)
        await fetchLoans()
        return
      }

      const currentStockLevel = getCurrentStockLevel(itemRow.stock_level)

      if (currentStockLevel <= 0) {
        setMessage(`${sku} has no available stock to loan out.`)
        return
      }

      const stockRows = await getItemStockRows(itemRow.id)
      let sourceRow = chooseLoanSourceRow(itemRow, stockRows)

      if (!sourceRow && currentStockLevel > 0) {
        const fallbackLocation = canonicalLocation(itemRow.current_location)
        const fallbackBin = normaliseBin(itemRow.current_bin, fallbackLocation)

        await upsertStockLocation({
          itemId: itemRow.id,
          sku: itemRow.sku,
          locationName: fallbackLocation,
          binCode: fallbackBin,
          delta: currentStockLevel,
          source: 'loan_stock_row_seed',
        })

        const seededRows = await getItemStockRows(itemRow.id)
        sourceRow = chooseLoanSourceRow(itemRow, seededRows)
      }

      if (!sourceRow) {
        setMessage(`${sku} has no stock location row available to deduct.`)
        return
      }

      const sourceLocation = canonicalLocation(sourceRow.location_name)
      const sourceBin = normaliseBin(sourceRow.bin_code, sourceLocation)
      const sourceCurrentStock = Number(sourceRow.stock_level || 0)
      const newSourceStock = sourceCurrentStock - 1
      const newTotalStockLevel = currentStockLevel - 1

      const confirmed = window.confirm(
        `Mark SKU ${sku} as ON LOAN by ${staff.name}?\n\nThis will deduct 1 from ${sourceLocation} / ${sourceBin}.\n\nTotal stock will change from ${currentStockLevel} to ${newTotalStockLevel}.`
      )

      if (!confirmed) {
        setMessage('Cancelled.')
        return
      }

      const now = new Date().toISOString()

      await updateExistingStockRow(sourceRow.id, newSourceStock, 'loan_out')
      const summary = await updateItemStockSummary(itemRow.id)

      const loanNotes = JSON.stringify({
        loaned_from_location: sourceLocation,
        loaned_from_bin: sourceBin,
        loaned_at: now,
        loaned_by: staff.name,
      })

      const { error: updateError } = await supabase
        .from('items')
        .update({
          loan_status: 'on_loan',
          loaned_at: now,
          loan_returned_at: null,
          loaned_by: staff.id,
          loan_notes: loanNotes,
          current_location: summary.stock_level > 0 ? summary.current_location : 'ON_LOAN',
          current_bin: summary.stock_level > 0 ? summary.current_bin : 'ON_LOAN',
          linnworks_location_sync_status: 'pending',
          updated_at: now,
        })
        .eq('id', itemRow.id)

      if (updateError) throw new Error(updateError.message)

      const { error: loanError } = await supabase.from('item_loans').insert({
        item_id: itemRow.id,
        sku: itemRow.sku,
        status: 'on_loan',
        loaned_at: now,
        loaned_by: staff.id,
      })

      if (loanError) throw new Error(loanError.message)

      const { error: queueError } = await supabase
        .from('linnworks_sync_queue')
        .insert({
          item_id: itemRow.id,
          sku: itemRow.sku,
          action: 'adjust_stock',
          payload: {
            sku: itemRow.sku,
            delta: -1,
            quantity: 1,
            location: sourceLocation,
            bin: sourceBin,
            strict_location: true,
            reason: 'loan_out',
            source: 'dohpe_app',
            loaned_at: now,
            loaned_by: staff.name,
          },
          status: 'pending',
        })

      if (queueError) throw new Error(queueError.message)

      setMessage(
        `${sku} marked as on loan by ${staff.name}. Deducted from ${sourceLocation} / ${sourceBin}. Stock ${currentStockLevel} → ${newTotalStockLevel}.`
      )
      await fetchLoans()
    } catch (error: any) {
      setMessage(error.message || 'Could not loan item out.')
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

    const destination = getReturnDestination(target)

    setMessage(
      `Scan SKU ${item.sku} now to confirm return to ${destination.location} / ${destination.bin}.`
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

    const destination = getReturnDestination(target)
    const currentStockLevel = getCurrentStockLevel(item.stock_level)
    const newStockLevel = currentStockLevel + 1

    const confirmed = window.confirm(
      `Return SKU ${item.sku} to ${destination.location} / ${destination.bin} by ${staff.name}?\n\nStock level will change from ${currentStockLevel} to ${newStockLevel}.`
    )

    if (!confirmed) return

    setBusy(true)
    setMessage('Returning item...')

    try {
      const now = new Date().toISOString()

      await upsertStockLocation({
        itemId: item.id,
        sku: item.sku,
        locationName: destination.location,
        binCode: destination.bin,
        delta: 1,
        source: destination.reason,
      })

      await updateItemStockSummary(item.id)

      const { error: updateError } = await supabase
        .from('items')
        .update({
          loan_status: 'not_on_loan',
          loan_returned_at: now,
          loan_notes: null,
          returned_by: staff.id,
          current_location: destination.location,
          current_bin: destination.bin,
          location_status: 'available',
          linnworks_location_sync_status: 'pending',
          updated_at: now,
        })
        .eq('id', item.id)

      if (updateError) throw new Error(updateError.message)

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

      if (loanUpdateError) throw new Error(loanUpdateError.message)

      const { error: queueError } = await supabase
        .from('linnworks_sync_queue')
        .insert({
          item_id: item.id,
          sku: item.sku,
          action: 'adjust_stock',
          payload: {
            sku: item.sku,
            delta: 1,
            quantity: 1,
            location: destination.location,
            bin: destination.bin,
            reason: destination.reason,
            source: 'dohpe_app',
            returned_at: now,
            returned_by: staff.name,
          },
          status: 'pending',
        })

      if (queueError) throw new Error(queueError.message)

      setPendingReturn(null)
      setSelectedItems((prev) => prev.filter((id) => id !== item.id))
      setMessage(
        `${item.sku} returned to ${destination.location} / ${destination.bin} by ${staff.name}. Stock ${currentStockLevel} → ${newStockLevel}.`
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
                  Scan SKU before removing the tag. Loan-out deducts from the current app stock location/bin. Return items here to put stock back live.
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
                    {getReturnDestination(pendingReturn.target).location} /{' '}
                    {getReturnDestination(pendingReturn.target).bin}.
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

                          <p className="mt-1 text-xs text-neutral-500">
                            Current app location:{' '}
                            {item.current_location || 'No location'} /{' '}
                            {item.current_bin || 'No bin'}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 sm:flex">
                        <button
                          onClick={() => startReturn(item, 'shop')}
                          disabled={busy || !staff}
                          className="rounded-xl bg-green-600 px-4 py-3 text-sm font-black text-white hover:bg-green-500 disabled:opacity-40"
                        >
                          RETURN TO SHOP STOCK
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
    </StaffPermissionGate>
  )
}

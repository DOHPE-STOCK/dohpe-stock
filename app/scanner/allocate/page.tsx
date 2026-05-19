'use client'

import { useEffect, useRef, useState } from 'react'
import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { useStaff } from '@/app/context/StaffContext'
import { supabase } from '@/lib/supabase'

type ScanMode = 'bin' | 'items'
type SkuType = 'single_use' | 'reusable' | string

type WarehouseBin = {
  id: string
  bin_code: string
  label: string | null
  is_active: boolean
}

type PendingItem = {
  id: string
  sku: string
  barcode_number: string | null
  sku_type: SkuType | null
  current_location: string | null
  current_bin: string | null
  location_status: string | null
  quantity: number
}

const WAREHOUSE_LOCATION = 'WAREHOUSE'
const WAREHOUSE_LINNWORKS_LOCATION = 'Default'
const DEFAULT_BIN = 'Default'

function cleanScanValue(value: string) {
  return value.trim().replace(/\s+/g, '').toUpperCase()
}

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function isReusable(item: Pick<PendingItem, 'sku_type'>) {
  return text(item.sku_type).toLowerCase() === 'reusable'
}

function stockLocationName(appLocation: string) {
  const value = text(appLocation).toUpperCase()
  if (!value || value === WAREHOUSE_LOCATION) return WAREHOUSE_LINNWORKS_LOCATION
  return value
}

export default function AllocatePage() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { staff } = useStaff()

  const [scanValue, setScanValue] = useState('')
  const [mode, setMode] = useState<ScanMode>('bin')
  const [activeBin, setActiveBin] = useState<WarehouseBin | null>(null)
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const binFromUrl = params.get('bin')

    if (binFromUrl) {
      scanBin(cleanScanValue(binFromUrl))
    }

    focusInput()
  }, [])

  function focusInput() {
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function isValidScan(value: string) {
    return /^[A-Z0-9\-_]+$/.test(value)
  }

  async function handleScan() {
    const value = cleanScanValue(scanValue)

    if (!value || busy) return

    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    setScanValue('')
    setMessage('')

    if (mode === 'bin') {
      await scanBin(value)
      focusInput()
      return
    }

    await scanItem(value)
    focusInput()
  }

  async function scanBin(binCode: string) {
    if (!binCode) return

    setBusy(true)

    const { data, error } = await supabase
      .from('warehouse_bins')
      .select('id, bin_code, label, is_active')
      .eq('bin_code', binCode)
      .maybeSingle()

    setBusy(false)

    if (error) {
      setMessage(error.message)
      return
    }

    if (!data) {
      setMessage(`Bin not found: ${binCode}`)
      return
    }

    if (!data.is_active) {
      setMessage(`Bin inactive: ${binCode}`)
      return
    }

    setActiveBin(data as WarehouseBin)
    setMode('items')
    setPendingItems([])
    setMessage(`Bin selected: ${data.bin_code}. Scan item SKUs now.`)
    focusInput()
  }

  async function scanItem(scannedValue: string) {
    if (!activeBin) {
      setMode('bin')
      setMessage('Scan a bin first.')
      return
    }

    if (!isValidScan(scannedValue)) {
      setMessage(`Invalid scan: ${scannedValue}`)
      return
    }

    setBusy(true)

    const { data, error } = await supabase
      .from('items')
      .select('id, sku, barcode_number, sku_type, current_location, current_bin, location_status')
      .or(`sku.eq.${scannedValue},barcode_number.eq.${scannedValue}`)
      .maybeSingle()

    setBusy(false)

    if (error) {
      setMessage(error.message)
      return
    }

    if (!data) {
      setMessage(`Item not found: ${scannedValue}`)
      return
    }

    const item = data as PendingItem
    const itemIsReusable = isReusable(item)

    setPendingItems((current) => {
      const existing = current.find((row) => row.id === item.id)

      if (existing && itemIsReusable) {
        return current.map((row) =>
          row.id === item.id ? { ...row, quantity: row.quantity + 1 } : row
        )
      }

      if (existing) return current

      return [
        {
          ...item,
          quantity: 1,
        },
        ...current,
      ]
    })

    setMessage(
      itemIsReusable
        ? `Added reusable ${item.sku} x1. Scan again to allocate another.`
        : `Added ${item.sku}`
    )
  }

  function removeItem(sku: string) {
    setPendingItems((prev) => prev.filter((item) => item.sku !== sku))
    focusInput()
  }

  function reduceReusableQuantity(sku: string) {
    setPendingItems((current) =>
      current
        .map((item) =>
          item.sku === sku && isReusable(item)
            ? { ...item, quantity: Math.max(0, item.quantity - 1) }
            : item
        )
        .filter((item) => item.quantity > 0)
    )
    focusInput()
  }

  function resetBin() {
    setActiveBin(null)
    setMode('bin')
    setPendingItems([])
    setMessage('Scan bin.')
    focusInput()
  }

  async function adjustLocalStockLocation(params: {
    item: PendingItem
    location: string
    bin: string
    delta: number
  }) {
    const locationName = stockLocationName(params.location)
    const binCode = text(params.bin) || DEFAULT_BIN
    const now = new Date().toISOString()

    const { data, error } = await supabase
      .from('item_stock_locations')
      .select('id, stock_level')
      .eq('item_id', params.item.id)
      .eq('location_name', locationName)
      .eq('bin_code', binCode)
      .limit(1)

    if (error) throw new Error(error.message)

    const existing = data?.[0]
    const currentStock = Number(existing?.stock_level || 0)
    const nextStock = currentStock + params.delta

    if (nextStock < 0) {
      throw new Error(
        `${params.item.sku} does not have enough stock in ${params.location} / ${binCode}. Current: ${currentStock}, trying to move: ${Math.abs(params.delta)}.`
      )
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from('item_stock_locations')
        .update({
          stock_level: nextStock,
          source: 'app_allocate',
          updated_at: now,
        })
        .eq('id', existing.id)

      if (updateError) throw new Error(updateError.message)
      return
    }

    const { error: insertError } = await supabase
      .from('item_stock_locations')
      .insert({
        item_id: params.item.id,
        sku: params.item.sku,
        location_name: locationName,
        location_id: null,
        bin_code: binCode,
        stock_level: nextStock,
        source: 'app_allocate',
        synced_at: null,
        updated_at: now,
      })

    if (insertError) throw new Error(insertError.message)
  }

  async function allocateItems() {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    if (!activeBin) {
      setMessage('Scan a bin first.')
      return
    }

    if (pendingItems.length === 0) {
      setMessage('Scan at least one item.')
      return
    }

    const totalQty = pendingItems.reduce((sum, item) => sum + item.quantity, 0)

    const confirmed = window.confirm(
      `Allocate ${totalQty} unit(s) to ${activeBin.bin_code} by ${staff.name}?\n\nReusable SKUs move quantity from WAREHOUSE / Default to WAREHOUSE / ${activeBin.bin_code}. Single-use SKUs move the item row.`
    )

    if (!confirmed) return

    setBusy(true)
    setMessage('Allocating...')

    const now = new Date().toISOString()
    const singleUseItems = pendingItems.filter((item) => !isReusable(item))
    const reusableItems = pendingItems.filter((item) => isReusable(item))

    try {
      if (singleUseItems.length > 0) {
        const itemIds = singleUseItems.map((item) => item.id)

        const { error: updateError } = await supabase
          .from('items')
          .update({
            current_location: WAREHOUSE_LOCATION,
            current_bin: activeBin.bin_code,
            location_status: 'stored',
            allocated_at: now,
            allocated_by: staff.id,
            linnworks_location_sync_status: 'pending',
            updated_at: now,
          })
          .in('id', itemIds)

        if (updateError) throw new Error(updateError.message)

        const { error: movementError } = await supabase
          .from('item_location_movements')
          .insert(
            singleUseItems.map((item) => ({
              item_id: item.id,
              sku: item.sku,
              from_location: item.current_location,
              from_bin: item.current_bin,
              to_location: WAREHOUSE_LOCATION,
              to_bin: activeBin.bin_code,
              movement_type: 'allocate',
              moved_by: staff.id,
            }))
          )

        if (movementError) throw new Error(movementError.message)

        const { error: queueError } = await supabase
          .from('linnworks_sync_queue')
          .insert(
            singleUseItems.map((item) => ({
              item_id: item.id,
              sku: item.sku,
              action: 'update_location',
              payload: {
                sku: item.sku,
                location: WAREHOUSE_LOCATION,
                bin: activeBin.bin_code,
                movement_type: 'allocate',
                allocated_at: now,
                allocated_by: staff.name,
              },
              status: 'pending',
            }))
          )

        if (queueError) throw new Error(queueError.message)
      }

      for (const item of reusableItems) {
        await adjustLocalStockLocation({
          item,
          location: WAREHOUSE_LOCATION,
          bin: DEFAULT_BIN,
          delta: -item.quantity,
        })

        await adjustLocalStockLocation({
          item,
          location: WAREHOUSE_LOCATION,
          bin: activeBin.bin_code,
          delta: item.quantity,
        })
      }

      if (reusableItems.length > 0) {
        const queueRows = reusableItems.flatMap((item) => [
          {
            item_id: item.id,
            sku: item.sku,
            action: 'adjust_stock',
            payload: {
              sku: item.sku,
              delta: -item.quantity,
              quantity: item.quantity,
              location: WAREHOUSE_LINNWORKS_LOCATION,
              bin: DEFAULT_BIN,
              strict_location: true,
              reason: 'allocate_reusable_from_warehouse_default',
              allocated_at: now,
              allocated_by: staff.name,
            },
            status: 'pending',
          },
          {
            item_id: item.id,
            sku: item.sku,
            action: 'adjust_stock',
            payload: {
              sku: item.sku,
              delta: item.quantity,
              quantity: item.quantity,
              location: WAREHOUSE_LINNWORKS_LOCATION,
              bin: activeBin.bin_code,
              reason: 'allocate_reusable_to_bin',
              allocated_at: now,
              allocated_by: staff.name,
            },
            status: 'pending',
          },
        ])

        const { error: reusableQueueError } = await supabase
          .from('linnworks_sync_queue')
          .insert(queueRows)

        if (reusableQueueError) throw new Error(reusableQueueError.message)
      }

      setMessage(`Allocated ${totalQty} unit(s) to ${activeBin.bin_code} by ${staff.name}`)
      setPendingItems([])
    } catch (error: any) {
      setMessage(error.message || 'Allocation failed.')
    } finally {
      setBusy(false)
      focusInput()
    }
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
                <h1 className="text-2xl font-bold sm:text-3xl">Allocate</h1>
                <p className="text-sm text-neutral-400">
                  Scan a bin QR to open this page with the bin already selected.
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

              <AppNav current="allocate" />
            </div>
          </header>

          <section
            className={`rounded-2xl border p-4 ${
              mode === 'bin'
                ? 'border-yellow-700 bg-yellow-950/30'
                : 'border-green-700 bg-green-950/30'
            }`}
          >
            <p className="text-xs font-bold uppercase tracking-wide text-neutral-400">
              Current step
            </p>

            <h2 className="mt-1 text-3xl font-black">
              {mode === 'bin' ? 'SCAN BIN' : 'SCAN ITEMS'}
            </h2>

            <div className="mt-4 rounded-xl bg-neutral-950 p-4">
              <p className="text-sm text-neutral-400">Active bin</p>

              <p className="mt-1 break-all font-mono text-4xl font-black">
                {activeBin?.bin_code || 'NONE'}
              </p>

              {activeBin?.label && (
                <p className="mt-1 text-sm text-neutral-400">{activeBin.label}</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            <input
              ref={inputRef}
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleScan()
              }}
              placeholder={
                !staff
                  ? 'Go to staff PIN screen first'
                  : mode === 'bin'
                    ? 'Scan bin barcode'
                    : 'Scan item SKU or reusable barcode'
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
              {busy ? 'PROCESSING...' : mode === 'bin' ? 'SET BIN' : 'ADD ITEM'}
            </button>
          </section>

          {message && (
            <section className="rounded-2xl border border-neutral-700 bg-neutral-900 p-4">
              <p className="text-xl font-bold">{message}</p>
            </section>
          )}

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-2xl font-black">Items to Allocate</h2>
                <p className="text-sm text-neutral-400">
                  {pendingItems.reduce((sum, item) => sum + item.quantity, 0)} unit(s) scanned
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:flex">
                <button
                  onClick={resetBin}
                  className="rounded-xl border border-neutral-700 px-4 py-4 text-sm font-black"
                >
                  CHANGE BIN
                </button>

                <button
                  onClick={allocateItems}
                  disabled={busy || !staff || !activeBin || pendingItems.length === 0}
                  className="rounded-xl bg-green-600 px-4 py-4 text-sm font-black text-white hover:bg-green-500 disabled:opacity-40"
                >
                  ALLOCATE
                </button>
              </div>
            </div>

            {pendingItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-neutral-800 p-8 text-center text-neutral-500">
                No items scanned yet.
              </div>
            ) : (
              <div className="space-y-2">
                {pendingItems.map((item) => {
                  const alreadyInBin =
                    !isReusable(item) &&
                    item.current_location === WAREHOUSE_LOCATION &&
                    item.current_bin === activeBin?.bin_code

                  return (
                    <div
                      key={item.sku}
                      className="flex items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-lg font-black">
                          {item.sku}{isReusable(item) ? ` x${item.quantity}` : ''}
                        </p>
                        <p className="text-sm text-neutral-400">
                          {isReusable(item)
                            ? `Reusable: ${WAREHOUSE_LOCATION} / ${DEFAULT_BIN} → ${WAREHOUSE_LOCATION} / ${activeBin?.bin_code || '-'}`
                            : `Current: ${item.current_location || '-'} / ${item.current_bin || '-'}`}
                        </p>

                        {alreadyInBin && (
                          <p className="mt-1 text-xs font-bold text-yellow-300">
                            Already in this bin
                          </p>
                        )}
                      </div>

                      <div className="flex gap-2">
                        {isReusable(item) && item.quantity > 1 && (
                          <button
                            onClick={() => reduceReusableQuantity(item.sku)}
                            className="rounded-lg bg-neutral-800 px-3 py-2 text-sm font-black text-neutral-100"
                          >
                            -1
                          </button>
                        )}

                        <button
                          onClick={() => removeItem(item.sku)}
                          className="rounded-lg bg-red-900 px-3 py-2 text-sm font-black text-red-100"
                        >
                          REMOVE
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </StaffPermissionGate>
  )
}

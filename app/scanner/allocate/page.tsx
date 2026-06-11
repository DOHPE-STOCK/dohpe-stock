'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { useStaff } from '@/app/context/StaffContext'
import { useCompany } from '@/app/context/CompanyContext'
import { supabase } from '@/lib/supabase'

type ScanMode = 'bin' | 'items'
type ItemScanMode = 'sku' | 'rfid'
type SkuType = 'single_use' | 'reusable' | string

type WarehouseBin = {
  id: string
  bin_code: string
  location_name: string | null
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

type LocationConfig = {
  name: string
  label: string | null
  is_active: boolean
  bin_mode: 'basic' | 'range' | null
  basic_bins: string[] | null
}

const WAREHOUSE_LOCATION = 'LOCATION-1'
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

function canonicalLocationKey(location: string | null | undefined) {
  return text(location).toUpperCase().replace(/[\s_]+/g, '-')
}

function stockLocationName(appLocation: string) {
  const value = canonicalLocationKey(appLocation)
  if (!value) return WAREHOUSE_LOCATION
  if (value === 'WAREHOUSE' || value === 'DEFAULT') return WAREHOUSE_LOCATION

  const shopMatch = value.match(/^SHOP-(\d+)$/)
  if (shopMatch) return `LOCATION-${Number(shopMatch[1]) + 1}`

  return value
}

function parseBinScan(value: string) {
  const raw = text(value)
  const queryMatch = raw.match(/[?&]bin=([^&#]+)/i)
  const locationMatch = raw.match(/[?&]location=([^&#]+)/i)

  if (queryMatch?.[1]) {
    return {
      location: locationMatch?.[1]
        ? decodeURIComponent(locationMatch[1]).trim().toUpperCase()
        : '',
      bin: decodeURIComponent(queryMatch[1]).trim().toUpperCase(),
    }
  }

  return { location: '', bin: cleanScanValue(raw) }
}

function configuredLocationRows(rows: LocationConfig[]) {
  const configured = rows.filter((row) => text(row.label) || /^LOCATION-\d+$/i.test(text(row.name)))
  return configured.length > 0 ? configured : rows
}

export default function AllocatePage() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { staff } = useStaff()
  const { activeCompanyId, schemaReady } = useCompany()

  const [scanValue, setScanValue] = useState('')
  const [mode, setMode] = useState<ScanMode>('bin')
  const [activeBin, setActiveBin] = useState<WarehouseBin | null>(null)
  const [itemScanMode, setItemScanMode] = useState<ItemScanMode>('sku')
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([])
  const [locationConfigs, setLocationConfigs] = useState<LocationConfig[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [allocating, setAllocating] = useState(false)
  const [prefillContext, setPrefillContext] = useState<{
    receiveTransferId?: string
    transferNumber?: string
    destinationLocation?: string
    sourceLocation?: string
    sourceBin?: string
  } | null>(null)

  useEffect(() => {
    fetchLocationConfigs()

    const params = new URLSearchParams(window.location.search)
    const binFromUrl = params.get('bin')
    const locationFromUrl = params.get('location')
    const itemsFromUrl = params.get('items')
    const receiveTransferId = params.get('receive_transfer_id') || ''
    const transferNumber = params.get('transfer_number') || ''
    const destinationLocation = stockLocationName(
      locationFromUrl || params.get('destination_location') || WAREHOUSE_LOCATION
    )
    const sourceLocation = stockLocationName(params.get('source_location') || WAREHOUSE_LOCATION)
    const sourceBin = params.get('source_bin') || DEFAULT_BIN

    if (receiveTransferId || itemsFromUrl || destinationLocation) {
      setPrefillContext({
        receiveTransferId,
        transferNumber,
        destinationLocation,
        sourceLocation,
        sourceBin,
      })
    }

    if (itemsFromUrl) {
      preloadItemsFromUrl(itemsFromUrl, sourceLocation, sourceBin, transferNumber)
    }

    if (binFromUrl) {
      scanBin(cleanScanValue(binFromUrl), cleanScanValue(destinationLocation))
    }

    focusInput()
  }, [activeCompanyId, schemaReady])

  async function fetchLocationConfigs() {
    let query = supabase
      .from('locations')
      .select('name, label, is_active, bin_mode, basic_bins')
      .eq('is_active', true)

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data, error } = await query

    if (!error) {
      setLocationConfigs(configuredLocationRows((data || []) as LocationConfig[]))
    }
  }

  function getLocationConfig(location: string) {
    const value = stockLocationName(location)

    return locationConfigs.find((config) => {
      return (
        stockLocationName(config.name) === value ||
        canonicalLocationKey(config.label) === value
      )
    })
  }

  function displayLocation(location: string | null | undefined) {
    const storage = stockLocationName(location || WAREHOUSE_LOCATION)
    const config = getLocationConfig(storage)

    if (text(config?.label)) return text(config?.label)
    if (storage === 'LOCATION-1') return 'WAREHOUSE'

    const match = storage.match(/^LOCATION-(\d+)$/)
    if (match && Number(match[1]) >= 2) return `SHOP-${Number(match[1]) - 1}`

    return storage
  }

  function getActiveLocation(bin: WarehouseBin | null) {
    return stockLocationName(bin?.location_name || WAREHOUSE_LOCATION)
  }

  function getActiveDisplayLocation(bin: WarehouseBin | null) {
    return displayLocation(getActiveLocation(bin))
  }

  function getActiveBinCode(bin: WarehouseBin | null) {
    return text(bin?.bin_code) || DEFAULT_BIN
  }

  function focusInput() {
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function isValidScan(value: string) {
    return /^[A-Z0-9\-_]+$/.test(value)
  }

  function parsePrefillItems(value: string) {
    return value
      .split(',')
      .map((part) => {
        const [skuRaw, quantityRaw, sourceBinRaw] = part.split(':')
        const sku = cleanScanValue(decodeURIComponent(skuRaw || ''))
        const quantity = Math.max(1, Number(quantityRaw || 1))
        const sourceBin = sourceBinRaw ? cleanScanValue(decodeURIComponent(sourceBinRaw)) : ''
        return sku ? { sku, quantity, sourceBin } : null
      })
      .filter(Boolean) as { sku: string; quantity: number; sourceBin: string }[]
  }

  async function preloadItemsFromUrl(
    value: string,
    sourceLocation: string,
    sourceBin: string,
    transferNumber = ''
  ) {
    const parsed = parsePrefillItems(value)
    const skus = parsed.map((item) => item.sku)

    if (skus.length === 0) return

    setBusy(true)
    setMessage('Loading transfer items for allocation...')

    let itemQuery = supabase
      .from('items')
      .select('id, sku, barcode_number, sku_type, current_location, current_bin, location_status')
      .in('sku', skus)

    if (schemaReady) itemQuery = itemQuery.eq('company_id', activeCompanyId)

    const { data, error } = await itemQuery

    setBusy(false)

    if (error) {
      setMessage(error.message)
      return
    }

    const bySku = new Map((data || []).map((item: any) => [cleanScanValue(item.sku), item as PendingItem]))
    const rows: PendingItem[] = []

    for (const prefill of parsed) {
      const item = bySku.get(prefill.sku)
      if (!item) continue

      rows.push({
        ...item,
        current_location: stockLocationName(sourceLocation || item.current_location || WAREHOUSE_LOCATION),
        current_bin: text(prefill.sourceBin || sourceBin || item.current_bin) || DEFAULT_BIN,
        quantity: prefill.quantity,
      })
    }

    setPendingItems(rows)
    setMode('bin')
    setMessage(
      rows.length > 0
        ? `Loaded ${rows.reduce((sum, item) => sum + item.quantity, 0)} unit(s)${transferNumber ? ` from transfer #${transferNumber}` : ''}. Scan or type destination bin now.`
        : 'No matching transfer items found to allocate.'
    )
  }

  async function handleScan() {
    const value = cleanScanValue(scanValue)

    if (!value || busy || allocating) return

    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    setScanValue('')
    setMessage('')

    if (mode === 'bin') {
      const parsedBin = parseBinScan(value)
      await scanBin(parsedBin.bin, parsedBin.location)
      focusInput()
      return
    }

    await scanItem(value)
    focusInput()
  }

  async function scanBin(binCode: string, locationName = '') {
    if (!binCode) return

    const cleanBin = cleanScanValue(binCode)
    const fallbackLocation = prefillContext?.destinationLocation || WAREHOUSE_LOCATION
    const cleanLocation = locationName ? stockLocationName(locationName) : stockLocationName(fallbackLocation)

    setBusy(true)

    let query = supabase
      .from('warehouse_bins')
      .select('id, bin_code, location_name, label, is_active')
      .eq('bin_code', cleanBin)

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    if (cleanLocation) {
      query = query.eq('location_name', cleanLocation)
    }

    const { data, error } = await query.limit(2)

    setBusy(false)

    if (error) {
      setMessage(error.message)
      return
    }

    if (!data || data.length === 0) {
      const { data: created, error: createError } = await supabase
        .from('warehouse_bins')
        .upsert(
          {
            ...(schemaReady ? { company_id: activeCompanyId } : {}),
            bin_code: cleanBin,
            label: cleanBin,
            location_name: cleanLocation,
            is_active: true,
          },
          { onConflict: schemaReady ? 'company_id,location_name,bin_code' : 'bin_code,location_name' }
        )
        .select('id, bin_code, location_name, label, is_active')
        .single()

      if (createError) {
        setMessage(createError.message)
        return
      }

      const selectedBin = created as WarehouseBin
      setActiveBin(selectedBin)
      setMode('items')
      setMessage(
        `Bin auto-created and selected: ${getActiveDisplayLocation(selectedBin)} / ${selectedBin.bin_code}. ${
          pendingItems.length > 0 ? 'Preloaded items are ready to allocate.' : 'Scan item SKUs now.'
        }`
      )
      focusInput()
      return
    }

    if (!cleanLocation && data.length > 1) {
      setMessage(`Multiple locations use bin ${cleanBin}. Scan the QR label with location, or open Allocate from the bin label.`)
      return
    }

    const selectedBin = data[0] as WarehouseBin

    if (!selectedBin.is_active) {
      setMessage(`Bin inactive: ${getActiveDisplayLocation(selectedBin)} / ${selectedBin.bin_code}`)
      return
    }

    setActiveBin(selectedBin)
    setMode('items')
    setMessage(
      `Bin selected: ${getActiveDisplayLocation(selectedBin)} / ${selectedBin.bin_code}. ${
        pendingItems.length > 0 ? 'Preloaded items are ready to allocate.' : 'Scan item SKUs now.'
      }`
    )
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

    let data: PendingItem | null = null
    let error: { message: string } | null = null

    if (itemScanMode === 'rfid') {
      const normalizedIdentifier = cleanScanValue(scannedValue)

      let identifierQuery = supabase
        .from('item_identifiers')
        .select('item_id')
        .eq('identifier_type', 'rfid')
        .eq('identifier_value_normalized', normalizedIdentifier)
        .eq('is_active', true)

      if (schemaReady) identifierQuery = identifierQuery.eq('company_id', activeCompanyId)

      const identifierResult = await identifierQuery.maybeSingle()

      if (identifierResult.error) {
        error = identifierResult.error
      } else if (identifierResult.data?.item_id) {
        let itemQuery = supabase
          .from('items')
          .select('id, sku, barcode_number, sku_type, current_location, current_bin, location_status')
          .eq('id', identifierResult.data.item_id)

        if (schemaReady) itemQuery = itemQuery.eq('company_id', activeCompanyId)

        const itemResult = await itemQuery.maybeSingle()

        data = itemResult.data as PendingItem | null
        error = itemResult.error
      }
    } else {
      let itemQuery = supabase
        .from('items')
        .select('id, sku, barcode_number, sku_type, current_location, current_bin, location_status')
        .or(`sku.eq.${scannedValue},barcode_number.eq.${scannedValue}`)

      if (schemaReady) itemQuery = itemQuery.eq('company_id', activeCompanyId)

      const itemResult = await itemQuery.maybeSingle()

      data = itemResult.data as PendingItem | null
      error = itemResult.error
    }

    setBusy(false)

    if (error) {
      setMessage(error.message)
      return
    }

    if (!data) {
      setMessage(`${itemScanMode === 'rfid' ? 'RFID' : 'Item'} not found: ${scannedValue}`)
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

    const response = await fetch('/api/items/stock-location/adjust', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        item_id: params.item.id,
        sku: params.item.sku,
        location_name: locationName,
        bin_code: binCode,
        delta: params.delta,
        source: 'app_allocate',
        company_id: schemaReady ? activeCompanyId : null,
      }),
    })

    const result = await response.json().catch(() => null)

    if (!response.ok || result?.ok === false) {
      if (result?.error === 'insufficient_stock') {
        throw new Error(
          `${params.item.sku} does not have enough stock in ${displayLocation(locationName)} / ${binCode}. Current: ${Number(
            result.current_stock || 0
          )}, trying to move: ${Math.abs(Number(result.attempted_delta || params.delta))}.`
        )
      }

      throw new Error(result?.error || 'Stock location adjustment failed.')
    }
  }

  async function allocateItems() {
    if (!staff || allocating) return

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
      `Allocate ${totalQty} unit(s) to ${getActiveDisplayLocation(activeBin)} / ${getActiveBinCode(activeBin)} by ${staff.name}?`
    )

    if (!confirmed) return

    setAllocating(true)
    setBusy(true)
    setMessage('Allocating...')

    const now = new Date().toISOString()
    const singleUseItems = pendingItems.filter((item) => !isReusable(item))
    const reusableItems = pendingItems.filter((item) => isReusable(item))

    try {
      if (singleUseItems.length > 0) {
        const itemIds = singleUseItems.map((item) => item.id)

        let updateQuery = supabase
          .from('items')
          .update({
            current_location: getActiveLocation(activeBin),
            current_bin: getActiveBinCode(activeBin),
            location_status: 'stored',
            allocated_at: now,
            allocated_by: staff.id,
            linnworks_location_sync_status: 'pending',
            updated_at: now,
          })
          .in('id', itemIds)

        if (schemaReady) updateQuery = updateQuery.eq('company_id', activeCompanyId)

        const { error: updateError } = await updateQuery

        if (updateError) throw new Error(updateError.message)

        const { error: movementError } = await supabase
          .from('item_location_movements')
          .insert(
            singleUseItems.map((item) => ({
              ...(schemaReady ? { company_id: activeCompanyId } : {}),
              item_id: item.id,
              sku: item.sku,
              from_location: stockLocationName(item.current_location || WAREHOUSE_LOCATION),
              from_bin: item.current_bin,
              to_location: getActiveLocation(activeBin),
              to_bin: getActiveBinCode(activeBin),
              movement_type: 'allocate',
              moved_by: staff.id,
            }))
          )

        if (movementError) throw new Error(movementError.message)

        const { error: queueError } = await supabase
          .from('linnworks_sync_queue')
          .insert(
            singleUseItems.map((item) => ({
              ...(schemaReady ? { company_id: activeCompanyId } : {}),
              item_id: item.id,
              sku: item.sku,
              action: 'update_location',
              payload: {
                sku: item.sku,
                location: getActiveLocation(activeBin),
                bin: getActiveBinCode(activeBin),
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
          location: stockLocationName(item.current_location || WAREHOUSE_LOCATION),
          bin: text(item.current_bin) || DEFAULT_BIN,
          delta: -item.quantity,
        })

        await adjustLocalStockLocation({
          item,
          location: getActiveLocation(activeBin),
          bin: getActiveBinCode(activeBin),
          delta: item.quantity,
        })
      }

      if (reusableItems.length > 0) {
        const queueRows = reusableItems.flatMap((item) => [
          {
            ...(schemaReady ? { company_id: activeCompanyId } : {}),
            item_id: item.id,
            sku: item.sku,
            action: 'adjust_stock',
            payload: {
              sku: item.sku,
              delta: -item.quantity,
              quantity: item.quantity,
              location: stockLocationName(item.current_location || WAREHOUSE_LOCATION),
              bin: text(item.current_bin) || DEFAULT_BIN,
              strict_location: true,
              reason: 'allocate_reusable_from_source_bin',
              allocated_at: now,
              allocated_by: staff.name,
            },
            status: 'pending',
          },
          {
            ...(schemaReady ? { company_id: activeCompanyId } : {}),
            item_id: item.id,
            sku: item.sku,
            action: 'adjust_stock',
            payload: {
              sku: item.sku,
              delta: item.quantity,
              quantity: item.quantity,
              location: getActiveLocation(activeBin),
              bin: getActiveBinCode(activeBin),
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

      if (prefillContext?.receiveTransferId) {
        let transferItemsQuery = supabase
          .from('stock_transfer_items')
          .update({
            status: 'received',
            received_at: now,
          })
          .eq('transfer_id', prefillContext.receiveTransferId)
          .eq('status', 'in_transfer')

        if (schemaReady) transferItemsQuery = transferItemsQuery.eq('company_id', activeCompanyId)

        const { error: transferItemsError } = await transferItemsQuery

        if (transferItemsError) throw new Error(transferItemsError.message)

        let transferQuery = supabase
          .from('stock_transfers')
          .update({
            status: 'received',
            received_at: now,
            received_by: staff.id,
            to_location: getActiveLocation(activeBin),
          })
          .eq('id', prefillContext.receiveTransferId)
          .neq('status', 'received')

        if (schemaReady) transferQuery = transferQuery.eq('company_id', activeCompanyId)

        const { error: transferError } = await transferQuery

        if (transferError) throw new Error(transferError.message)
      }

      setMessage(
        `Allocated ${totalQty} unit(s) to ${getActiveDisplayLocation(activeBin)} / ${getActiveBinCode(activeBin)} by ${staff.name}${
          prefillContext?.transferNumber ? ` from transfer #${prefillContext.transferNumber}` : ''
        }`
      )
      setPendingItems([])
    } catch (error: any) {
      setAllocating(false)
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
          <header className="app-header rounded-3xl bg-black p-4 text-white shadow-2xl sm:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h1 className="text-2xl font-black tracking-normal sm:text-3xl">Allocate</h1>
                <p className="text-sm text-neutral-300">
                  Scan a bin QR, or open from Mark as Received with items preloaded then scan/type the destination bin.
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

              <Link
                href="/scanner/create-bin"
                onClick={(event) => event.stopPropagation()}
                className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-500"
              >
                Create Bin
              </Link>
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

              {activeBin && (
                <p className="mt-1 text-sm text-neutral-400">
                  {getActiveDisplayLocation(activeBin)} / {getActiveBinCode(activeBin)}
                </p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            {mode === 'items' && (
              <div className="mb-3 grid grid-cols-2 gap-2 sm:flex">
                <button
                  type="button"
                  onClick={() => setItemScanMode('sku')}
                  className={`rounded-xl px-4 py-3 text-sm font-black ${
                    itemScanMode === 'sku'
                      ? 'bg-white text-black'
                      : 'border border-neutral-700 bg-neutral-950 text-white'
                  }`}
                >
                  SKU / BARCODE
                </button>

                <button
                  type="button"
                  onClick={() => setItemScanMode('rfid')}
                  className={`rounded-xl px-4 py-3 text-sm font-black ${
                    itemScanMode === 'rfid'
                      ? 'bg-white text-black'
                      : 'border border-neutral-700 bg-neutral-950 text-white'
                  }`}
                >
                  RFID
                </button>
              </div>
            )}

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
                    : itemScanMode === 'rfid'
                      ? 'Scan item RFID'
                      : 'Scan item SKU or reusable barcode'
              }
              disabled={busy || allocating || !staff}
              inputMode="none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-5 font-mono text-2xl font-bold outline-none focus:border-white disabled:opacity-50"
              autoFocus
            />

            <button
              onClick={handleScan}
              disabled={busy || allocating || !scanValue.trim() || !staff}
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
                  disabled={busy || allocating}
                  className="rounded-xl border border-neutral-700 px-4 py-4 text-sm font-black disabled:opacity-40"
                >
                  CHANGE BIN
                </button>

                <button
                  onClick={allocateItems}
                  disabled={busy || allocating || !staff || !activeBin || pendingItems.length === 0}
                  className="rounded-xl bg-green-600 px-4 py-4 text-sm font-black text-white hover:bg-green-500 disabled:opacity-40"
                >
                  {allocating ? 'ALLOCATING...' : 'ALLOCATE'}
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
                  const sourceLocation = stockLocationName(item.current_location || WAREHOUSE_LOCATION)
                  const destinationLocation = getActiveLocation(activeBin)

                  const alreadyInBin =
                    !isReusable(item) &&
                    sourceLocation === destinationLocation &&
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
                            ? `Reusable: ${displayLocation(sourceLocation)} / ${item.current_bin || DEFAULT_BIN} → ${displayLocation(destinationLocation)} / ${activeBin?.bin_code || '-'}`
                            : `Current: ${displayLocation(sourceLocation)} / ${item.current_bin || '-'}`}
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
                            disabled={busy || allocating}
                            className="rounded-lg bg-neutral-800 px-3 py-2 text-sm font-black text-neutral-100 disabled:opacity-40"
                          >
                            -1
                          </button>
                        )}

                        <button
                          onClick={() => removeItem(item.sku)}
                          disabled={busy || allocating}
                          className="rounded-lg bg-red-900 px-3 py-2 text-sm font-black text-red-100 disabled:opacity-40"
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

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { useStaff } from '@/app/context/StaffContext'

type TransferItem = {
  id: string
  item_id: string | null
  sku: string
  source_bin?: string | null
  status: string
}

type Transfer = {
  id: string
  transfer_number: number
  from_location: string
  to_location: string
  status: string
  created_at: string
  sent_at: string | null
  received_at: string | null
  stock_transfer_items?: TransferItem[]
}

type TimePeriod = '7days' | 'month' | 'year'

type LocationConfig = {
  name: string
  label: string | null
  is_active: boolean
  bin_mode: 'basic' | 'range' | null
  basic_bins: string[] | null
}

type StockItemRow = {
  id: string
  sku: string
  sku_type: string | null
  current_location: string | null
  current_bin: string | null
}

type ReceiveModalState = {
  transfer: Transfer
  selectedLocation: string
}

const DEFAULT_BIN = 'Default'
const WAREHOUSE_LOCATION = 'LOCATION-1'

const LOCATION_DISPLAY_ORDER = [
  'LOCATION-1',
  'LOCATION-2',
  'LOCATION-3',
  'LOCATION-4',
  'LOCATION-5',
]

const FALLBACK_LOCATIONS: LocationConfig[] = [
  { name: 'LOCATION-1', label: 'WAREHOUSE', is_active: true, bin_mode: 'range', basic_bins: [DEFAULT_BIN] },
  { name: 'LOCATION-2', label: 'SHOP-1', is_active: true, bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
  { name: 'LOCATION-3', label: 'SHOP-2', is_active: true, bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
  { name: 'LOCATION-4', label: 'SHOP-3', is_active: true, bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
  { name: 'LOCATION-5', label: 'SHOP-4', is_active: true, bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
]

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function canonicalLocationKey(location: string | null | undefined) {
  return text(location).toUpperCase().replace(/[\s_]+/g, '-')
}

function formatTransferNumber(value: number) {
  return String(value).padStart(7, '0')
}

function isReusableStockItem(item: StockItemRow | undefined) {
  return text(item?.sku_type).toLowerCase() === 'reusable'
}

function configuredLocationRows(rows: LocationConfig[]) {
  const configured = rows.filter((row) => text(row.label) || /^LOCATION-\d+$/i.test(text(row.name)))
  return configured.length > 0 ? configured : rows
}

function groupBySkuAndSourceBin(items: TransferItem[]) {
  const groups = new Map<string, { sku: string; sourceBin: string; quantity: number }>()

  for (const item of items) {
    const sku = text(item.sku).toUpperCase()
    if (!sku) continue

    const sourceBin = text(item.source_bin) || DEFAULT_BIN
    const key = `${sku}::${sourceBin}`
    const existing = groups.get(key)

    groups.set(key, {
      sku,
      sourceBin,
      quantity: (existing?.quantity || 0) + 1,
    })
  }

  return groups
}

export default function TransfersPage() {
  const { staff } = useStaff()

  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [locationConfigs, setLocationConfigs] = useState<LocationConfig[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('month')
  const [receiveModal, setReceiveModal] = useState<ReceiveModalState | null>(null)

  useEffect(() => {
    fetchTransfers(timePeriod)
    fetchLocationConfigs()
  }, [timePeriod])

  async function fetchLocationConfigs() {
    const { data, error } = await supabase
      .from('locations')
      .select('name, label, is_active, bin_mode, basic_bins')
      .eq('is_active', true)

    if (error) {
      setLocationConfigs(FALLBACK_LOCATIONS)
      return
    }

    const rows = configuredLocationRows((data || []) as LocationConfig[])
    setLocationConfigs(rows.length > 0 ? rows : FALLBACK_LOCATIONS)
  }

  function getLocationConfig(location: string) {
    const value = canonicalLocationKey(location)

    return locationConfigs.find((config) => {
      return (
        canonicalLocationKey(config.name) === value ||
        canonicalLocationKey(config.label) === value
      )
    })
  }

  function resolveLocationName(location: string) {
    const clean = canonicalLocationKey(location)
    const config = getLocationConfig(clean)

    if (config?.name) return canonicalLocationKey(config.name)

    if (clean === 'WAREHOUSE' || clean === 'DEFAULT') return 'LOCATION-1'

    const shopMatch = clean.match(/^SHOP-(\d+)$/)
    if (shopMatch) return `LOCATION-${Number(shopMatch[1]) + 1}`

    return clean || WAREHOUSE_LOCATION
  }

  function displayLocation(location: string) {
    const name = resolveLocationName(location)
    const config = getLocationConfig(name)

    if (text(config?.label)) return text(config?.label)

    if (name === 'LOCATION-1') return 'WAREHOUSE'

    const match = name.match(/^LOCATION-(\d+)$/)
    if (match && Number(match[1]) >= 2) return `SHOP-${Number(match[1]) - 1}`

    return name || '-'
  }

  function getOrderedLocationOptions() {
    const available = locationConfigs.length > 0 ? locationConfigs : FALLBACK_LOCATIONS
    const byName = new Map<string, LocationConfig>()

    for (const location of available) {
      const name = resolveLocationName(location.name)
      byName.set(name, { ...location, name })
    }

    const ordered = LOCATION_DISPLAY_ORDER
      .map((name) => byName.get(name) || FALLBACK_LOCATIONS.find((row) => row.name === name))
      .filter(Boolean) as LocationConfig[]

    const extras = available
      .map((row) => ({ ...row, name: resolveLocationName(row.name) }))
      .filter((row) => !LOCATION_DISPLAY_ORDER.includes(row.name))

    return [...ordered, ...extras].map((location) => ({
      name: resolveLocationName(location.name),
      label: displayLocation(location.name),
    }))
  }

  function getDefaultReceiveBin(location: string) {
    const config = getLocationConfig(location)

    if (config?.bin_mode === 'basic') {
      const bins = (config.basic_bins || [])
        .map((bin) => text(bin).toUpperCase())
        .filter(Boolean)

      return bins[0] || DEFAULT_BIN
    }

    return DEFAULT_BIN
  }

  function getStartDate(period: TimePeriod) {
    const date = new Date()

    if (period === '7days') date.setDate(date.getDate() - 7)
    if (period === 'month') date.setMonth(date.getMonth() - 1)
    if (period === 'year') date.setFullYear(date.getFullYear() - 1)

    return date.toISOString()
  }

  function getPeriodLabel(period: TimePeriod) {
    if (period === '7days') return 'last 7 days'
    if (period === 'month') return 'last month'
    return 'last year'
  }

  async function fetchTransfers(period: TimePeriod = timePeriod) {
    setLoading(true)
    setMessage('')

    const { data, error } = await supabase
      .from('stock_transfers')
      .select(`
        id,
        transfer_number,
        from_location,
        to_location,
        status,
        created_at,
        sent_at,
        received_at,
        stock_transfer_items (
          id,
          item_id,
          sku,
          source_bin,
          status
        )
      `)
      .gte('created_at', getStartDate(period))
      .order('created_at', { ascending: false })

    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setTransfers((data || []) as Transfer[])
  }

  function getCounts(transfer: Transfer) {
    const items = transfer.stock_transfer_items || []

    return {
      total: items.length,
      received: items.filter((item) => item.status === 'received').length,
      missing: items.filter((item) => item.status === 'missing').length,
      inTransfer: items.filter((item) => item.status === 'in_transfer').length,
    }
  }

  function statusClass(status: string) {
    if (status === 'received') return 'bg-green-950 text-green-300 border-green-800'
    if (status === 'part_received') return 'bg-yellow-950 text-yellow-300 border-yellow-800'
    if (status === 'cancelled') return 'bg-red-950 text-red-300 border-red-800'
    return 'bg-blue-950 text-blue-300 border-blue-800'
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

  function printManifest(transfer: Transfer) {
    window.open(`/transfers/${transfer.id}/manifest`, '_blank')
  }

  async function loadItemsBySku(skus: string[]) {
    const uniqueSkus = Array.from(new Set(skus.map((sku) => text(sku).toUpperCase()).filter(Boolean)))

    if (uniqueSkus.length === 0) return new Map<string, StockItemRow>()

    const { data, error } = await supabase
      .from('items')
      .select('id, sku, sku_type, current_location, current_bin')
      .in('sku', uniqueSkus)

    if (error) throw new Error(error.message)

    return new Map(
      (data || []).map((item: any) => [text(item.sku).toUpperCase(), item as StockItemRow])
    )
  }

  async function adjustLocalStockLocation(params: {
    item: StockItemRow
    location: string
    bin: string
    delta: number
    allowMissingSource?: boolean
  }) {
    const locationName = resolveLocationName(params.location)
    const binCode = text(params.bin) || DEFAULT_BIN

    const response = await fetch('/api/items/stock-location/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item_id: params.item.id,
        sku: params.item.sku,
        location_name: locationName,
        bin_code: binCode,
        delta: params.delta,
        allow_missing_source: params.allowMissingSource,
        source: 'app_transfer',
      }),
    })

    const result = await response.json().catch(() => null)

    if (!response.ok || result?.ok === false) {
      if (result?.error === 'insufficient_stock') {
        const currentStock = Number(result.current_stock || 0)
        const attemptedDelta = Number(result.attempted_delta || params.delta)
        const readableLocation = displayLocation(result.location_name || locationName)
        const readableBin = text(result.bin_code) || binCode

        throw new Error(
          `${params.item.sku} does not have enough stock in ${readableLocation} / ${readableBin}. Current: ${currentStock}, trying to move: ${Math.abs(attemptedDelta)}.`
        )
      }

      throw new Error(
        result?.error || `Could not adjust stock for ${params.item.sku} in ${displayLocation(locationName)} / ${binCode}.`
      )
    }

    return result
  }

  async function moveReusableTransferStock(params: {
    transfer: Transfer
    receivableItems: TransferItem[]
    itemMap: Map<string, StockItemRow>
    movedAt: string
    destinationBin: string
    destinationLocation: string
  }) {
    const grouped = groupBySkuAndSourceBin(params.receivableItems)
    const queueRows: any[] = []

    for (const { sku, sourceBin, quantity } of grouped.values()) {
      const item = params.itemMap.get(sku)
      if (!item) continue

      const sourceResult = await adjustLocalStockLocation({
        item,
        location: params.transfer.from_location,
        bin: sourceBin,
        delta: -quantity,
        allowMissingSource: !isReusableStockItem(item),
      })

      if (sourceResult?.skipped) continue

      await adjustLocalStockLocation({
        item,
        location: params.destinationLocation,
        bin: params.destinationBin,
        delta: quantity,
      })

      queueRows.push(
        {
          item_id: item.id,
          sku,
          action: 'adjust_stock',
          payload: {
            sku,
            delta: -quantity,
            quantity,
            location: resolveLocationName(params.transfer.from_location),
            bin: sourceBin,
            strict_location: true,
            reason: 'transfer_reusable_from_source',
            transfer_id: params.transfer.id,
            transfer_number: params.transfer.transfer_number,
            moved_at: params.movedAt,
            moved_by: staff?.name || null,
          },
          status: 'pending',
        },
        {
          item_id: item.id,
          sku,
          action: 'adjust_stock',
          payload: {
            sku,
            delta: quantity,
            quantity,
            location: resolveLocationName(params.destinationLocation),
            bin: params.destinationBin,
            reason: 'transfer_reusable_to_destination',
            transfer_id: params.transfer.id,
            transfer_number: params.transfer.transfer_number,
            moved_at: params.movedAt,
            moved_by: staff?.name || null,
          },
          status: 'pending',
        }
      )
    }

    if (queueRows.length > 0) {
      const { error } = await supabase.from('linnworks_sync_queue').insert(queueRows)
      if (error) throw new Error(error.message)
    }
  }

  function openReceiveModal(transfer: Transfer) {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    const counts = getCounts(transfer)
    if (counts.inTransfer === 0) {
      setMessage('No in-transfer items to receive.')
      return
    }

    setMessage('')
    setReceiveModal({
      transfer,
      selectedLocation: resolveLocationName(transfer.to_location || WAREHOUSE_LOCATION),
    })
  }

  function closeReceiveModal() {
    if (loading) return
    setReceiveModal(null)
  }

  function getReceivableItems(transfer: Transfer) {
    return (transfer.stock_transfer_items || []).filter((item) => item.status === 'in_transfer')
  }

  function buildAllocateItemsParam(receivableItems: TransferItem[]) {
    const grouped = groupBySkuAndSourceBin(receivableItems)

    return Array.from(grouped.values())
      .map(({ sku, sourceBin, quantity }) => {
        return `${encodeURIComponent(sku)}:${quantity}:${encodeURIComponent(sourceBin)}`
      })
      .join(',')
  }

  function openAllocateForTransfer() {
    if (!receiveModal || loading) return

    const transfer = receiveModal.transfer
    const receivableItems = getReceivableItems(transfer)

    if (receivableItems.length === 0) {
      setMessage('No in-transfer items to allocate.')
      setReceiveModal(null)
      return
    }

    const destinationLocation = resolveLocationName(receiveModal.selectedLocation)
    const sourceLocation = resolveLocationName(transfer.from_location)
    const transferNo = formatTransferNumber(transfer.transfer_number)
    const items = buildAllocateItemsParam(receivableItems)

    const params = new URLSearchParams()
    params.set('receive_transfer_id', transfer.id)
    params.set('transfer_number', transferNo)
    params.set('destination_location', destinationLocation)
    params.set('location', destinationLocation)
    params.set('source_location', sourceLocation)
    params.set('items', items)

    setReceiveModal(null)
    window.location.href = `/scanner/allocate?${params.toString()}`
  }

  async function receiveToDefault() {
    if (!receiveModal || !staff || loading) return

    const transfer = receiveModal.transfer
    const receivableItems = getReceivableItems(transfer)

    if (receivableItems.length === 0) {
      setMessage('No in-transfer items to receive.')
      setReceiveModal(null)
      return
    }

    const destinationLocation = resolveLocationName(receiveModal.selectedLocation)
    const destinationBin = getDefaultReceiveBin(destinationLocation)
    const transferNo = formatTransferNumber(transfer.transfer_number)

    const confirmed = window.confirm(
      `Accept transfer #${transferNo} by ${staff.name}?\n\nThis will mark ${receivableItems.length} unit(s) as received into ${displayLocation(destinationLocation)} / ${destinationBin}.`
    )

    if (!confirmed) return

    setLoading(true)
    setMessage('Receiving transfer...')

    const receivedAt = new Date().toISOString()

    try {
      const itemMap = await loadItemsBySku(receivableItems.map((item) => item.sku))
      const reusableSkus = new Set(
        Array.from(itemMap.values())
          .filter(isReusableStockItem)
          .map((item) => text(item.sku).toUpperCase())
      )

      const singleUseItemIds = receivableItems
        .filter((item) => !reusableSkus.has(text(item.sku).toUpperCase()))
        .map((item) => item.item_id)
        .filter(Boolean) as string[]

      const transferItemIds = receivableItems.map((item) => item.id)

      await moveReusableTransferStock({
        transfer,
        receivableItems,
        itemMap,
        movedAt: receivedAt,
        destinationBin,
        destinationLocation,
      })

      const { error: transferItemsError } = await supabase
        .from('stock_transfer_items')
        .update({
          status: 'received',
          received_at: receivedAt,
        })
        .in('id', transferItemIds)
        .eq('status', 'in_transfer')

      if (transferItemsError) throw new Error(transferItemsError.message)

      if (singleUseItemIds.length > 0) {
        const { error: itemsError } = await supabase
          .from('items')
          .update({
            location_status: 'received',
            current_location: destinationLocation,
            current_bin: destinationBin,
            last_saved_by: staff.id,
            linnworks_location_sync_status: 'pending',
            updated_at: receivedAt,
          })
          .in('id', singleUseItemIds)

        if (itemsError) throw new Error(itemsError.message)

        const queueRows = receivableItems
          .filter((item) => item.item_id && !reusableSkus.has(text(item.sku).toUpperCase()))
          .map((item) => ({
            item_id: item.item_id,
            sku: item.sku,
            action: 'update_location',
            payload: {
              sku: item.sku,
              location: destinationLocation,
              bin: destinationBin,
              movement_type: 'transfer_receive',
              transfer_id: transfer.id,
              transfer_number: transfer.transfer_number,
              received_at: receivedAt,
              received_by: staff.name,
            },
            status: 'pending',
          }))

        if (queueRows.length > 0) {
          const { error: queueError } = await supabase
            .from('linnworks_sync_queue')
            .insert(queueRows)

          if (queueError) throw new Error(queueError.message)
        }
      }

      const { error: transferError } = await supabase
        .from('stock_transfers')
        .update({
          status: 'received',
          received_at: receivedAt,
          received_by: staff.id,
          to_location: destinationLocation,
        })
        .eq('id', transfer.id)
        .neq('status', 'received')

      if (transferError) throw new Error(transferError.message)

      setReceiveModal(null)
      setMessage(`Transfer #${transferNo} received into ${displayLocation(destinationLocation)} / ${destinationBin} by ${staff.name}.`)
      await fetchTransfers()
    } catch (error: any) {
      setMessage(error.message || 'Transfer receive failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <StaffPermissionGate permission="scanner">
      <main className="min-h-screen bg-neutral-950 p-5 text-white">
        <div className="app-header mb-5 flex flex-wrap items-start justify-between gap-4 rounded-3xl bg-black p-4 text-white shadow-2xl sm:p-5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
            <div>
              <h1 className="text-2xl font-black tracking-normal">Stock Transfers</h1>

              <p className="text-sm text-neutral-300">
                View and receive warehouse/shop stock transfers.
              </p>

              {staff ? (
                <p className="mt-1 text-sm font-bold text-green-300">
                  Active staff: {staff.name}
                </p>
              ) : (
                <p className="mt-1 text-sm font-bold text-yellow-300">
                  No active staff selected
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {message && (
              <span className="rounded-lg border border-yellow-800 bg-yellow-950 px-4 py-2 text-sm font-bold text-yellow-300">
                {message}
              </span>
            )}

            <select
              value={timePeriod}
              onChange={(e) => setTimePeriod(e.target.value as TimePeriod)}
              className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-white"
            >
              <option value="7days">Last 7 days</option>
              <option value="month">Last month</option>
              <option value="year">Last year</option>
            </select>

            <button
              onClick={() => fetchTransfers()}
              disabled={loading}
              className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        <section className="mb-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="text-lg font-semibold">Transfer History</h2>
          <p className="text-sm text-neutral-400">
            Showing transfers from the {getPeriodLabel(timePeriod)}.
          </p>
        </section>

        {transfers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-900 p-8 text-center text-neutral-500">
            No stock transfers found for the {getPeriodLabel(timePeriod)}.
          </div>
        ) : (
          <div className="space-y-3">
            {transfers.map((transfer) => {
              const counts = getCounts(transfer)
              const isReceived = transfer.status === 'received'
              const transferNo = formatTransferNumber(transfer.transfer_number)

              return (
                <section
                  key={transfer.id}
                  className="w-full rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
                >
                  <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
                    <div>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-bold">
                          Transfer #{transferNo}
                        </h2>

                        <span
                          className={`rounded-full border px-2 py-1 text-xs font-bold uppercase ${statusClass(
                            transfer.status
                          )}`}
                        >
                          {transfer.status.replace('_', ' ')}
                        </span>
                      </div>

                      <div className="grid gap-2 text-sm text-neutral-300 sm:grid-cols-2">
                        <p>
                          <strong className="text-neutral-500">From:</strong>{' '}
                          {displayLocation(transfer.from_location)}
                        </p>

                        <p>
                          <strong className="text-neutral-500">To:</strong>{' '}
                          {displayLocation(transfer.to_location)}
                        </p>

                        <p>
                          <strong className="text-neutral-500">Created:</strong>{' '}
                          {formatDate(transfer.created_at)}
                        </p>

                        <p>
                          <strong className="text-neutral-500">Received:</strong>{' '}
                          {formatDate(transfer.received_at)}
                        </p>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-neutral-950 px-3 py-1 text-neutral-300">
                          Total: {counts.total}
                        </span>

                        <span className="rounded-full bg-blue-950 px-3 py-1 text-blue-300">
                          In transfer: {counts.inTransfer}
                        </span>

                        <span className="rounded-full bg-green-950 px-3 py-1 text-green-300">
                          Received: {counts.received}
                        </span>

                        {counts.missing > 0 && (
                          <span className="rounded-full bg-red-950 px-3 py-1 text-red-300">
                            Missing: {counts.missing}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col justify-center gap-2">
                      <Link
                        href={`/transfers/${transfer.id}`}
                        className="rounded-xl bg-white px-4 py-2 text-center text-sm font-bold text-black"
                      >
                        Open Transfer
                      </Link>

                      <button
                        type="button"
                        onClick={() => printManifest(transfer)}
                        className="rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm font-bold text-white hover:bg-neutral-700"
                      >
                        Print Manifest
                      </button>

                      <button
                        type="button"
                        onClick={() => openReceiveModal(transfer)}
                        disabled={loading || !staff || isReceived || counts.inTransfer === 0}
                        className="rounded-xl bg-green-600 px-4 py-2.5 text-sm font-black text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
                      >
                        Mark as Received
                      </button>
                    </div>
                  </div>
                </section>
              )
            })}
          </div>
        )}

        {receiveModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <section className="w-full max-w-5xl rounded-3xl border border-green-900 bg-neutral-950 p-6 shadow-2xl">
              <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="mb-1 text-sm font-black uppercase text-neutral-500">
                    To: {displayLocation(receiveModal.selectedLocation)}
                  </p>

                  <h2 className="text-3xl font-black">
                    Receive transfer #{formatTransferNumber(receiveModal.transfer.transfer_number)}
                  </h2>

                  <p className="mt-1 text-sm text-neutral-400">
                    Choose destination, then choose how to receive it.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeReceiveModal}
                  disabled={loading}
                  className="rounded-xl border border-neutral-800 px-5 py-3 text-sm font-black text-neutral-300 hover:border-white disabled:opacity-40"
                >
                  Cancel
                </button>
              </div>

              <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {getOrderedLocationOptions().map((location) => {
                  const selected = resolveLocationName(receiveModal.selectedLocation) === location.name

                  return (
                    <button
                      key={location.name}
                      type="button"
                      disabled={loading}
                      onClick={() =>
                        setReceiveModal((current) =>
                          current
                            ? {
                                ...current,
                                selectedLocation: location.name,
                              }
                            : current
                        )
                      }
                      className={`rounded-xl border px-4 py-5 text-lg font-black disabled:opacity-40 ${
                        selected
                          ? 'border-white bg-white text-black'
                          : 'border-neutral-800 bg-neutral-950 text-white hover:border-white'
                      }`}
                    >
                      {location.label}
                    </button>
                  )
                })}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={receiveToDefault}
                  disabled={loading}
                  className="rounded-xl bg-green-700 px-5 py-6 text-xl font-black text-white hover:bg-green-600 disabled:opacity-40"
                >
                  Default
                </button>

                <button
                  type="button"
                  onClick={openAllocateForTransfer}
                  disabled={loading}
                  className="rounded-xl bg-blue-700 px-5 py-6 text-xl font-black text-white hover:bg-blue-600 disabled:opacity-40"
                >
                  Allocate
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    </StaffPermissionGate>
  )
}

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { useStaff } from '@/app/context/StaffContext'
import { useCompany } from '@/app/context/CompanyContext'

const DEFAULT_BIN = 'Default'
type ReceiveChoice = {
  location: string
  bin: string
  allocateIndividual?: boolean
}

type LocationConfig = {
  name: string
  label: string | null
  is_active: boolean
  bin_mode: 'basic' | 'range' | null
  basic_bins: string[] | null
}

function configuredLocationRows(rows: LocationConfig[]) {
  const configured = rows.filter((row) => text(row.label) || /^LOCATION-\d+$/i.test(text(row.name)))
  return configured.length > 0 ? configured : rows
}

type LinkedItem = {
  id: string
  sku: string
  sku_type?: string | null
  brand: string | null
  reporting_category: string | null
  colour_primary: string | null
  colour_secondary: string | null
  tagged_size: string | null
  waist_in: string | number | null
  ai_title: string | null
  basic_title: string | null
  item_images?: {
    processed_url: string | null
    original_url: string | null
    image_order: number | null
  }[]
}

type StockItemRow = {
  id: string
  sku: string
  sku_type: string | null
  current_location: string | null
  current_bin: string | null
}

type TransferItem = {
  id: string
  item_id: string | null
  sku: string
  source_bin?: string | null
  status: string
  received_at: string | null
  items?: LinkedItem[] | LinkedItem | null
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
  stock_transfer_items: TransferItem[]
}

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function isReusableStockItem(item: StockItemRow | LinkedItem | null | undefined) {
  return text(item?.sku_type).toLowerCase() === 'reusable'
}

function canonicalLocationKey(location: string | null | undefined) {
  return text(location).toUpperCase().replace(/[\s_]+/g, '-')
}

function groupBySkuAndSourceBin(rows: TransferItem[]) {
  const grouped = new Map<string, { sku: string; sourceBin: string; quantity: number }>()

  rows.forEach((row) => {
    const sku = text(row.sku).toUpperCase()
    if (!sku) return
    const sourceBin = text(row.source_bin) || DEFAULT_BIN
    const key = `${sku}::${sourceBin}`
    const existing = grouped.get(key)
    grouped.set(key, {
      sku,
      sourceBin,
      quantity: (existing?.quantity || 0) + 1,
    })
  })

  return grouped
}

function getSizeText(item: LinkedItem | null | undefined) {
  if (!item) return ''

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

function getThumbnail(item?: LinkedItem | null) {
  if (!item?.item_images || item.item_images.length === 0) return null

  const sorted = [...item.item_images].sort(
    (a, b) => (a.image_order ?? 0) - (b.image_order ?? 0)
  )

  return sorted[0]?.processed_url || sorted[0]?.original_url || null
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

function statusClass(status: string) {
  if (status === 'received') {
    return 'bg-green-950 text-green-300 border-green-800'
  }

  if (status === 'missing') {
    return 'bg-red-950 text-red-300 border-red-800'
  }

  if (status === 'part_received') {
    return 'bg-yellow-950 text-yellow-300 border-yellow-800'
  }

  return 'bg-blue-950 text-blue-300 border-blue-800'
}

export default function TransferDetailPage() {
  const params = useParams()
  const id = params.id as string
  const { staff } = useStaff()
  const { activeCompanyId, schemaReady } = useCompany()

  const [transfer, setTransfer] = useState<Transfer | null>(null)
  const [locationConfigs, setLocationConfigs] = useState<LocationConfig[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [receivePanelOpen, setReceivePanelOpen] = useState(false)
  const [receiveLocation, setReceiveLocation] = useState('')

  useEffect(() => {
    fetchTransfer()
    fetchLocationConfigs()
  }, [id, activeCompanyId, schemaReady])

  useEffect(() => {
    if (!transfer || receiveLocation) return
    setReceiveLocation(resolveLocationName(transfer.to_location))
  }, [transfer, locationConfigs, receiveLocation])

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
    const value = canonicalLocationKey(location)
    return locationConfigs.find((config) => {
      return (
        canonicalLocationKey(config.name) === value ||
        canonicalLocationKey(config.label) === value
      )
    })
  }

  function resolveLocationName(location: string) {
    const config = getLocationConfig(location)
    return text(config?.name) || canonicalLocationKey(location) || 'LOCATION-1'
  }

  function displayLocation(location: string) {
    const name = resolveLocationName(location)
    const config = getLocationConfig(name)
    return text(config?.label) || name || '-'
  }

  function getReceiveBins(location: string) {
    const config = getLocationConfig(location)

    if (config?.bin_mode === 'basic') {
      const bins = (config.basic_bins || [])
        .map((bin) => text(bin).toUpperCase())
        .filter(Boolean)
        .slice(0, 3)

      return bins.length > 0 ? bins : [DEFAULT_BIN]
    }

    return []
  }

  function isRangeLocation(location: string) {
    return getLocationConfig(location)?.bin_mode === 'range'
  }

  function receiveLocationOptions() {
    return locationOptionsForPrompt()
  }

  function buildAllocateUrl(currentTransfer: Transfer, location: string, receivableItems: TransferItem[]) {
    const grouped = groupBySkuAndSourceBin(receivableItems)
    const items = Array.from(grouped.values())
      .map((row) => `${encodeURIComponent(row.sku)}:${row.quantity}`)
      .join(',')

    const params = new URLSearchParams()
    params.set('location', resolveLocationName(location))
    params.set('source_location', resolveLocationName(location))
    params.set('source_bin', DEFAULT_BIN)
    params.set('receive_transfer_id', currentTransfer.id)
    params.set('transfer_number', String(currentTransfer.transfer_number))
    params.set('items', items)

    return `/scanner/allocate?${params.toString()}`
  }

  function locationOptionsForPrompt() {
    const configured = locationConfigs.length > 0
      ? locationConfigs
      : [{ name: 'LOCATION-1', label: 'WAREHOUSE', is_active: true, bin_mode: 'range', basic_bins: [DEFAULT_BIN] } as LocationConfig]

    return configured.map((location) => ({
      name: resolveLocationName(location.name),
      label: displayLocation(location.name),
    }))
  }

  function askReceiveLocation(currentTransfer: Transfer) {
    const options = locationOptionsForPrompt()
    const suggestedName = resolveLocationName(currentTransfer.to_location)
    const suggested = displayLocation(suggestedName)
    const answer = window.prompt(
      `Receive this transfer into which location?\n\n${options
        .map((location, index) => `${index + 1}. ${location.label}`)
        .join('\n')}\n\nCurrent destination: ${suggested}`,
      suggested
    )

    if (answer === null) return null

    const clean = text(answer)
    const index = Number(clean)
    const selected = Number.isInteger(index) && index >= 1 && index <= options.length
      ? options[index - 1]
      : options.find((location) => location.label.toUpperCase() === clean.toUpperCase())

    if (!selected) {
      window.alert(`Choose one of: ${options.map((location) => location.label).join(', ')}`)
      return null
    }

    return selected.name
  }

  function askReceiveChoice(currentTransfer: Transfer): ReceiveChoice | null {
    const destinationLocation = askReceiveLocation(currentTransfer)

    if (!destinationLocation) return null

    const bins = getReceiveBins(destinationLocation)

    if (bins.length > 0) {
      const answer = window.prompt(
        `Receive into which bin at ${displayLocation(destinationLocation)}?\n\n${bins
          .map((bin, index) => `${index + 1}. ${bin}`)
          .join('\n')}`,
        bins[0]
      )

      if (answer === null) return null

      const clean = text(answer).toUpperCase()
      const index = Number(clean)
      const selectedBin = Number.isInteger(index) && index >= 1 && index <= bins.length
        ? bins[index - 1]
        : clean

      if (!selectedBin || !bins.includes(selectedBin)) {
        window.alert(`Choose one of: ${bins.join(', ')}`)
        return null
      }

      return { location: destinationLocation, bin: selectedBin }
    }

    const answer = window.prompt(
      `Receive into ${displayLocation(destinationLocation)}.\n\nType DEFAULT to receive everything into Default, or ALLOCATE to open Allocate Individual.`,
      'DEFAULT'
    )

    if (answer === null) return null

    const choice = text(answer).toUpperCase()

    if (choice === 'ALLOCATE') {
      return { location: destinationLocation, bin: DEFAULT_BIN, allocateIndividual: true }
    }

    if (choice && choice !== 'DEFAULT') {
      window.alert('Type DEFAULT or ALLOCATE.')
      return null
    }

    return { location: destinationLocation, bin: DEFAULT_BIN }
  }

  async function fetchTransfer() {
    setLoading(true)
    setMessage('')

    let query = supabase
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
          status,
          received_at,
          items (
            id,
            sku,
            sku_type,
            brand,
            reporting_category,
            colour_primary,
            colour_secondary,
            tagged_size,
            waist_in,
            ai_title,
            basic_title,
            item_images (
              processed_url,
              original_url,
              image_order
            )
          )
        )
      `)
      .eq('id', id)

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data, error } = await query.single()

    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setTransfer(data as unknown as Transfer)
  }

  function counts() {
    const items = transfer?.stock_transfer_items || []

    return {
      total: items.length,
      expected: items.filter((item) => item.status === 'in_transfer').length,
      received: items.filter((item) => item.status === 'received').length,
      missing: items.filter((item) => item.status === 'missing').length,
    }
  }

  async function loadItemsBySku(skus: string[]) {
    const uniqueSkus = Array.from(
      new Set(skus.map((sku) => text(sku).toUpperCase()).filter(Boolean))
    )

    if (uniqueSkus.length === 0) return new Map<string, StockItemRow>()

    let query = supabase
      .from('items')
      .select('id, sku, sku_type, current_location, current_bin')
      .in('sku', uniqueSkus)

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data, error } = await query

    if (error) throw new Error(error.message)

    return new Map(
      (data || []).map((item: any) => [
        text(item.sku).toUpperCase(),
        item as StockItemRow,
      ])
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
        company_id: schemaReady ? activeCompanyId : null,
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
          ...(schemaReady ? { company_id: activeCompanyId } : {}),
          item_id: item.id,
          sku,
          action: 'adjust_stock',
          payload: {
            sku,
            delta: -quantity,
            quantity,
            location: params.transfer.from_location,
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
          ...(schemaReady ? { company_id: activeCompanyId } : {}),
          item_id: item.id,
          sku,
          action: 'adjust_stock',
          payload: {
            sku,
            delta: quantity,
            quantity,
            location: params.destinationLocation,
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

  async function markTransferReceived(receiveChoice: ReceiveChoice) {
    if (!transfer) return

    if (!staff) {
      setMessage('No active staff selected.')
      return
    }

    const receivableItems = transfer.stock_transfer_items.filter(
      (item) => item.status === 'in_transfer'
    )

    if (receivableItems.length === 0) {
      setMessage('No in-transfer items to receive.')
      return
    }

    const confirmed = window.confirm(
      `Receive transfer #${transfer.transfer_number} by ${staff.name}?\n\nExpected quantity: ${receivableItems.length}\nDestination: ${displayLocation(receiveChoice.location)} / ${receiveChoice.bin}`
    )

    if (!confirmed) return

    setLoading(true)
    setMessage('Receiving transfer...')

    const now = new Date().toISOString()

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
        movedAt: now,
        destinationBin: receiveChoice.bin,
        destinationLocation: receiveChoice.location,
      })

      let transferItemsQuery = supabase
        .from('stock_transfer_items')
        .update({
          status: 'received',
          received_at: now,
        })
        .in('id', transferItemIds)

      if (schemaReady) transferItemsQuery = transferItemsQuery.eq('company_id', activeCompanyId)

      const { error: transferItemsError } = await transferItemsQuery

      if (transferItemsError) throw new Error(transferItemsError.message)

      if (singleUseItemIds.length > 0) {
        let itemsQuery = supabase
          .from('items')
          .update({
            location_status: 'received',
            current_location: receiveChoice.location,
            current_bin: receiveChoice.bin,
            last_saved_by: staff.id,
            linnworks_location_sync_status: 'pending',
            updated_at: now,
          })
          .in('id', singleUseItemIds)

        if (schemaReady) itemsQuery = itemsQuery.eq('company_id', activeCompanyId)

        const { error: itemsError } = await itemsQuery

        if (itemsError) throw new Error(itemsError.message)

        const queueRows = receivableItems
          .filter((item) => item.item_id && !reusableSkus.has(text(item.sku).toUpperCase()))
          .map((item) => ({
            ...(schemaReady ? { company_id: activeCompanyId } : {}),
            item_id: item.item_id,
            sku: item.sku,
            action: 'update_location',
            payload: {
              sku: item.sku,
              location: receiveChoice.location,
              bin: receiveChoice.bin,
              movement_type: 'transfer_receive',
              transfer_id: transfer.id,
              transfer_number: transfer.transfer_number,
              received_at: now,
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

      let transferQuery = supabase
        .from('stock_transfers')
        .update({
          status: 'received',
          received_at: now,
          received_by: staff.id,
          to_location: receiveChoice.location,
        })
        .eq('id', transfer.id)

      if (schemaReady) transferQuery = transferQuery.eq('company_id', activeCompanyId)

      const { error: transferError } = await transferQuery

      if (transferError) throw new Error(transferError.message)

      setMessage(`Transfer #${transfer.transfer_number} received into ${displayLocation(receiveChoice.location)} / ${receiveChoice.bin}.`)
      await fetchTransfer()

      if (receiveChoice.allocateIndividual) {
        window.location.href = buildAllocateUrl(transfer, receiveChoice.location, receivableItems)
      }
    } catch (error: any) {
      setMessage(error.message || 'Transfer receive failed.')
    } finally {
      setLoading(false)
    }
  }

  if (!transfer) {
    return (
      <StaffPermissionGate permission="scanner">
        <main className="min-h-screen bg-neutral-950 p-5 text-white">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            {loading ? 'Loading transfer...' : message || 'Transfer not found.'}
          </div>
        </main>
      </StaffPermissionGate>
    )
  }

  const c = counts()
  const isReceived = transfer.status === 'received'

  return (
    <StaffPermissionGate permission="scanner">
      <main className="min-h-screen bg-neutral-950 p-5 text-white">
        <div className="app-header mb-5 flex flex-wrap items-start justify-between gap-4 rounded-3xl bg-black p-4 text-white shadow-2xl sm:p-5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
            <div>
              <h1 className="text-2xl font-black tracking-normal">
                Transfer #{transfer.transfer_number}
              </h1>

              <p className="text-sm text-neutral-300">
                {displayLocation(transfer.from_location)} → {displayLocation(transfer.to_location)}
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

            <Link
              href="/transfers"
              className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-black text-white hover:bg-white/20"
            >
              Back
            </Link>

            <button
              onClick={fetchTransfer}
              disabled={loading}
              className="rounded-xl bg-white px-4 py-2 text-sm font-black text-black disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        </div>

        <section className="mb-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl bg-neutral-950 p-4">
              <p className="text-xs uppercase text-neutral-500">Status</p>

              <span
                className={`mt-2 inline-block rounded-full border px-3 py-1 text-xs font-black uppercase ${statusClass(
                  transfer.status
                )}`}
              >
                {transfer.status.replace('_', ' ')}
              </span>
            </div>

            <div className="rounded-xl bg-neutral-950 p-4">
              <p className="text-xs uppercase text-neutral-500">
                Expected Qty
              </p>

              <p className="mt-1 text-3xl font-black">{c.total}</p>
            </div>

            <div className="rounded-xl bg-neutral-950 p-4">
              <p className="text-xs uppercase text-neutral-500">Received</p>

              <p className="mt-1 text-3xl font-black text-green-300">
                {c.received}
              </p>
            </div>

            <div className="rounded-xl bg-neutral-950 p-4">
              <p className="text-xs uppercase text-neutral-500">
                Still Expected
              </p>

              <p className="mt-1 text-3xl font-black text-blue-300">
                {c.expected}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-2 text-sm text-neutral-300 md:grid-cols-3">
            <p>
              <strong className="text-neutral-500">Created:</strong>{' '}
              {formatDate(transfer.created_at)}
            </p>

            <p>
              <strong className="text-neutral-500">Sent:</strong>{' '}
              {formatDate(transfer.sent_at)}
            </p>

            <p>
              <strong className="text-neutral-500">Received:</strong>{' '}
              {formatDate(transfer.received_at)}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setReceivePanelOpen(true)}
            disabled={loading || !staff || isReceived || c.expected === 0}
            className="mt-4 rounded-xl bg-green-600 px-5 py-3 text-base font-black text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
          >
            Mark as Received
          </button>


          {receivePanelOpen && transfer && (
            <div className="mt-4 rounded-2xl border border-emerald-800 bg-emerald-950/30 p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-black text-emerald-100">Receive transfer</h3>
                  <p className="text-sm font-bold text-emerald-200">
                    Choose Default for warehouse holding stock, or Allocate to receive into Default first and then send the items to the Allocate screen with the items preloaded.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReceivePanelOpen(false)}
                  className="rounded-xl border border-emerald-700 px-3 py-2 text-xs font-black text-emerald-100"
                >
                  Cancel
                </button>
              </div>

              <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {receiveLocationOptions().map((location) => {
                  const selected = resolveLocationName(receiveLocation || transfer.to_location) === location.name
                  return (
                    <button
                      key={location.name}
                      type="button"
                      onClick={() => setReceiveLocation(location.name)}
                      className={`rounded-xl px-3 py-3 text-sm font-black ${
                        selected ? 'bg-white text-black' : 'border border-emerald-800 bg-neutral-950 text-white'
                      }`}
                    >
                      {location.label}
                    </button>
                  )
                })}
              </div>

              {(() => {
                const selectedLocation = resolveLocationName(receiveLocation || transfer.to_location)
                const bins = getReceiveBins(selectedLocation)
                const receivableItems = transfer.stock_transfer_items.filter((item) => item.status === 'in_transfer')

                if (bins.length > 0 && !isRangeLocation(selectedLocation)) {
                  return (
                    <div className="grid gap-2 sm:grid-cols-3">
                      {bins.map((bin) => (
                        <button
                          key={bin}
                          type="button"
                          disabled={loading}
                          onClick={() => markTransferReceived({ location: selectedLocation, bin })}
                          className="rounded-xl bg-green-600 px-4 py-4 text-sm font-black text-white hover:bg-green-500 disabled:opacity-50"
                        >
                          Receive to {bin}
                        </button>
                      ))}
                    </div>
                  )
                }

                return (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => markTransferReceived({ location: selectedLocation, bin: DEFAULT_BIN })}
                      className="rounded-xl bg-green-600 px-4 py-4 text-sm font-black text-white hover:bg-green-500 disabled:opacity-50"
                    >
                      Receive to Default
                    </button>

                    <button
                      type="button"
                      disabled={loading || receivableItems.length === 0}
                      onClick={() => markTransferReceived({ location: selectedLocation, bin: DEFAULT_BIN, allocateIndividual: true })}
                      className="rounded-xl bg-blue-600 px-4 py-4 text-sm font-black text-white hover:bg-blue-500 disabled:opacity-50"
                    >
                      Receive then Allocate to Bin
                    </button>
                  </div>
                )
              })()}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-4 text-xl font-black">Transfer Items</h2>

          {transfer.stock_transfer_items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-800 p-8 text-center text-neutral-500">
              No items in this transfer.
            </div>
          ) : (
            <div className="space-y-2">
              {transfer.stock_transfer_items.map((transferItem: TransferItem) => {
                const linkedItem = Array.isArray(transferItem.items)
                  ? transferItem.items[0] || null
                  : transferItem.items

                const imageUrl = getThumbnail(linkedItem)

                return (
                  <div
                    key={transferItem.id}
                    className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3"
                  >
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-neutral-900">
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] text-neutral-500">
                          No image
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm text-neutral-500">
                        {transferItem.sku}
                      </p>

                      <h3 className="truncate text-sm font-bold text-white">
                        {linkedItem?.ai_title ||
                          linkedItem?.basic_title ||
                          'Untitled item'}
                      </h3>

                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-neutral-400">
                        <span>{linkedItem?.brand || 'No brand'}</span>
                        <span>·</span>
                        <span>{linkedItem?.reporting_category || 'No category'}</span>
                        <span>·</span>
                        <span>{linkedItem?.colour_primary || 'No colour'}</span>

                        {linkedItem?.colour_secondary && (
                          <>
                            <span>·</span>
                            <span>{linkedItem.colour_secondary}</span>
                          </>
                        )}

                        {getSizeText(linkedItem) && (
                          <>
                            <span>·</span>
                            <span>{getSizeText(linkedItem)}</span>
                          </>
                        )}

                        {isReusableStockItem(linkedItem) && (
                          <>
                            <span>·</span>
                            <span className="font-bold text-yellow-300">Reusable qty unit</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-black uppercase ${statusClass(
                          transferItem.status
                        )}`}
                      >
                        {transferItem.status.replace('_', ' ')}
                      </span>

                      <p className="text-[11px] text-neutral-500">
                        {formatDate(transferItem.received_at)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </main>
    </StaffPermissionGate>
  )
}


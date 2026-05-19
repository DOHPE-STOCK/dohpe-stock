'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { useStaff } from '@/app/context/StaffContext'

const DEFAULT_BIN = 'Default'

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

function groupBySku(rows: TransferItem[]) {
  const grouped = new Map<string, number>()

  rows.forEach((row) => {
    const sku = text(row.sku).toUpperCase()
    if (!sku) return
    grouped.set(sku, (grouped.get(sku) || 0) + 1)
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

  const [transfer, setTransfer] = useState<Transfer | null>(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchTransfer()
  }, [id])

  async function fetchTransfer() {
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
      .single()

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

    const { data, error } = await supabase
      .from('items')
      .select('id, sku, sku_type, current_location, current_bin')
      .in('sku', uniqueSkus)

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
  }) {
    const locationName = text(params.location) || 'WAREHOUSE'
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
        `${params.item.sku} does not have enough stock in ${locationName} / ${binCode}. Current: ${currentStock}, trying to move: ${Math.abs(params.delta)}.`
      )
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from('item_stock_locations')
        .update({
          stock_level: nextStock,
          source: 'app_transfer',
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
        source: 'app_transfer',
        synced_at: null,
        updated_at: now,
      })

    if (insertError) throw new Error(insertError.message)
  }

  async function moveReusableTransferStock(params: {
    transfer: Transfer
    receivableItems: TransferItem[]
    itemMap: Map<string, StockItemRow>
    movedAt: string
  }) {
    const reusableRows = params.receivableItems.filter((row) =>
      isReusableStockItem(params.itemMap.get(text(row.sku).toUpperCase()))
    )

    if (reusableRows.length === 0) return

    const grouped = groupBySku(reusableRows)
    const queueRows: any[] = []

    for (const [sku, quantity] of grouped) {
      const item = params.itemMap.get(sku)
      if (!item) continue

      await adjustLocalStockLocation({
        item,
        location: params.transfer.from_location,
        bin: DEFAULT_BIN,
        delta: -quantity,
      })

      await adjustLocalStockLocation({
        item,
        location: params.transfer.to_location,
        bin: DEFAULT_BIN,
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
            location: params.transfer.from_location,
            bin: DEFAULT_BIN,
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
            location: params.transfer.to_location,
            bin: DEFAULT_BIN,
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

  async function markTransferReceived() {
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
      `Receive transfer #${transfer.transfer_number} by ${staff.name}?\n\nExpected quantity: ${receivableItems.length}`
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
      })

      const { error: transferItemsError } = await supabase
        .from('stock_transfer_items')
        .update({
          status: 'received',
          received_at: now,
        })
        .in('id', transferItemIds)

      if (transferItemsError) throw new Error(transferItemsError.message)

      if (singleUseItemIds.length > 0) {
        const { error: itemsError } = await supabase
          .from('items')
          .update({
            location_status: 'received',
            current_location: transfer.to_location,
            current_bin: DEFAULT_BIN,
            last_saved_by: staff.id,
            linnworks_location_sync_status: 'pending',
            updated_at: now,
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
              location: transfer.to_location,
              bin: DEFAULT_BIN,
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

      const { error: transferError } = await supabase
        .from('stock_transfers')
        .update({
          status: 'received',
          received_at: now,
          received_by: staff.id,
        })
        .eq('id', transfer.id)

      if (transferError) throw new Error(transferError.message)

      setMessage(`Transfer #${transfer.transfer_number} received.`)
      await fetchTransfer()
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
        <div className="mb-5 flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold">
                Transfer #{transfer.transfer_number}
              </h1>

              <p className="text-sm text-neutral-400">
                {transfer.from_location} → {transfer.to_location}
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

            <AppNav current="transfers" />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {message && (
              <span className="rounded-lg border border-yellow-800 bg-yellow-950 px-4 py-2 text-sm font-bold text-yellow-300">
                {message}
              </span>
            )}

            <Link
              href="/transfers"
              className="rounded-xl border border-neutral-700 px-4 py-2 text-sm font-bold"
            >
              Back
            </Link>

            <button
              onClick={fetchTransfer}
              disabled={loading}
              className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
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
            onClick={markTransferReceived}
            disabled={loading || !staff || isReceived || c.expected === 0}
            className="mt-4 w-full rounded-xl bg-green-600 px-5 py-4 text-lg font-black text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
          >
            MARK TRANSFER AS RECEIVED
          </button>
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

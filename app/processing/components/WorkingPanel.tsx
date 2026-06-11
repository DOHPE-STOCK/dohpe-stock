'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useStaff } from '@/app/context/StaffContext'
import { supabase } from '@/lib/supabase'

type WorkingItem = {
  id: string
  sku: string
  status?: string | null
  brand: string | null
  reporting_category: string | null
  basic_title: string | null
  ai_title: string | null
  sent_to_review_at?: string | null
  current_location?: string | null
  current_bin?: string | null
  inbound_batch_id?: string | null
  inbound_batch_code?: string | null
  rfid_tid?: string | null
}

type BatchStats = {
  total: number
  sentToReview: number
  quarantine: number
}

type WorkingPanelProps = {
  activeCompanyId?: string
  schemaReady?: boolean
  embedded?: boolean
  onChanged?: () => void
}

export default function WorkingPanel({
  activeCompanyId = '',
  schemaReady = false,
  embedded = false,
  onChanged,
}: WorkingPanelProps) {
  const router = useRouter()
  const { staff } = useStaff()

  const [items, setItems] = useState<WorkingItem[]>([])
  const [imagesByItem, setImagesByItem] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [sku, setSku] = useState('')
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [openBatches, setOpenBatches] = useState<Record<string, boolean>>({})
  const [batchStatsById, setBatchStatsById] = useState<Record<string, BatchStats>>({})

  useEffect(() => {
    fetchWorkingItems()
  }, [activeCompanyId, schemaReady])

  async function fetchWorkingItems() {
    let query = supabase
      .from('items')
      .select('*')
      .eq('status', 'working')
      .order('created_at', { ascending: false })

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data, error } = await query

    if (error) {
      setMessage(error.message)
      return
    }

    const workingItems = (data || []) as WorkingItem[]
    setItems(workingItems)
    fetchThumbnails(workingItems)
    fetchBatchStats(workingItems)
  }

  async function fetchBatchStats(workingItems: WorkingItem[]) {
    const batchIds = Array.from(
      new Set(
        workingItems
          .map((item) => item.inbound_batch_id)
          .filter((batchId): batchId is string => Boolean(batchId))
      )
    )

    if (batchIds.length === 0) {
      setBatchStatsById({})
      return
    }

    let query = supabase
      .from('items')
      .select('id,inbound_batch_id,status,sent_to_review_at,current_location,current_bin')
      .in('inbound_batch_id', batchIds)

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data, error } = await query

    if (error) {
      setMessage(error.message)
      return
    }

    const stats = (data || []).reduce<Record<string, BatchStats>>((acc, item) => {
      const batchId = item.inbound_batch_id as string | null
      if (!batchId) return acc

      if (!acc[batchId]) acc[batchId] = { total: 0, sentToReview: 0, quarantine: 0 }

      const status = String(item.status || '').toLowerCase()
      const quarantineText = `${item.current_location || ''} ${item.current_bin || ''}`.toLowerCase()

      acc[batchId].total += 1
      if (item.sent_to_review_at || status === 'review' || status === 'finalised') {
        acc[batchId].sentToReview += 1
      }
      if (quarantineText.includes('qtine') || quarantineText.includes('quarantine')) {
        acc[batchId].quarantine += 1
      }

      return acc
    }, {})

    setBatchStatsById(stats)
  }

  async function fetchThumbnails(workingItems: WorkingItem[]) {
    const imageMap: Record<string, string> = {}

    for (const item of workingItems) {
      const { data } = await supabase
        .from('item_images')
        .select('*')
        .eq('item_id', item.id)
        .order('image_order', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (data) imageMap[item.id] = data.processed_url || data.original_url
    }

    setImagesByItem(imageMap)
  }

  async function searchSku() {
    setMessage('')
    setSearched(false)

    const cleanSku = sku.trim()
    if (!cleanSku) return

    setLoading(true)

    let query = supabase
      .from('items')
      .select('*')
      .eq('sku', cleanSku)

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data, error } = await query.maybeSingle()

    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    if (data) {
      router.push(`/items/${data.id}`)
      return
    }

    setSearched(true)
  }

  async function createItem() {
    const cleanSku = sku.trim()
    if (!cleanSku) return

    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    setLoading(true)
    setMessage('Creating item...')

    const { data, error } = await supabase
      .from('items')
      .insert({
        ...(schemaReady ? { company_id: activeCompanyId } : {}),
        sku: cleanSku,
        status: 'working',
        last_saved_by: staff.id,
      })
      .select()
      .single()

    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    router.push(`/items/${data.id}`)
  }

  async function deleteWorkingItem(item: WorkingItem) {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    const confirmed = window.confirm(
      `Delete working item ${item.sku}?\n\nThis removes the item record and any linked image rows. This cannot be undone.`
    )

    if (!confirmed) return

    setLoading(true)
    setMessage(`Deleting ${item.sku}...`)

    let imageDelete = supabase
      .from('item_images')
      .delete()
      .eq('item_id', item.id)
    if (schemaReady) imageDelete = imageDelete.eq('company_id', activeCompanyId)

    const { error: imageError } = await imageDelete

    if (imageError) {
      setLoading(false)
      setMessage(imageError.message)
      return
    }

    let identifierDelete = supabase.from('item_identifiers').delete().eq('item_id', item.id)
    if (schemaReady) identifierDelete = identifierDelete.eq('company_id', activeCompanyId)
    await identifierDelete

    let stockDelete = supabase.from('item_stock_locations').delete().eq('item_id', item.id)
    if (schemaReady) stockDelete = stockDelete.eq('company_id', activeCompanyId)
    await stockDelete

    let rfidUpdate = supabase
      .from('inbound_batch_rfids')
      .update({ item_id: null, status: 'void' })
      .eq('item_id', item.id)
    if (schemaReady) rfidUpdate = rfidUpdate.eq('company_id', activeCompanyId)
    await rfidUpdate

    let itemDelete = supabase
      .from('items')
      .delete()
      .eq('id', item.id)
      .eq('status', 'working')
    if (schemaReady) itemDelete = itemDelete.eq('company_id', activeCompanyId)

    const { error } = await itemDelete

    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    if (item.inbound_batch_id) {
      let remainingItemsQuery = supabase
        .from('items')
        .select('id', { count: 'exact', head: true })
        .eq('inbound_batch_id', item.inbound_batch_id)
        .eq('status', 'working')
      if (schemaReady) remainingItemsQuery = remainingItemsQuery.eq('company_id', activeCompanyId)

      const { count } = await remainingItemsQuery

      if ((count || 0) === 0) {
        let batchUpdate = supabase
          .from('inbound_batches')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('id', item.inbound_batch_id)
        if (schemaReady) batchUpdate = batchUpdate.eq('company_id', activeCompanyId)
        await batchUpdate
      }
    }

    setMessage(`${item.sku} deleted`)
    await fetchWorkingItems()
    onChanged?.()
  }

  async function deleteWorkingBatch(group: { key: string; label: string; items: WorkingItem[] }) {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    const confirmed = window.confirm(
      `Delete working batch ${group.label}?\n\nThis removes ${group.items.length} working item(s) and any linked image rows. This cannot be undone.`
    )

    if (!confirmed) return

    const itemIds = group.items.map((item) => item.id)
    const batchId = group.items.find((item) => item.inbound_batch_id)?.inbound_batch_id || null

    setLoading(true)
    setMessage(`Deleting ${group.label}...`)

    let imageDelete = supabase
      .from('item_images')
      .delete()
      .in('item_id', itemIds)
    if (schemaReady) imageDelete = imageDelete.eq('company_id', activeCompanyId)

    const { error: imageError } = await imageDelete

    if (imageError) {
      setLoading(false)
      setMessage(imageError.message)
      return
    }

    let identifierDelete = supabase.from('item_identifiers').delete().in('item_id', itemIds)
    if (schemaReady) identifierDelete = identifierDelete.eq('company_id', activeCompanyId)
    await identifierDelete

    let stockDelete = supabase.from('item_stock_locations').delete().in('item_id', itemIds)
    if (schemaReady) stockDelete = stockDelete.eq('company_id', activeCompanyId)
    await stockDelete

    let rfidUpdate = supabase
      .from('inbound_batch_rfids')
      .update({ item_id: null, status: 'void' })
      .in('item_id', itemIds)
    if (schemaReady) rfidUpdate = rfidUpdate.eq('company_id', activeCompanyId)
    await rfidUpdate

    let itemDelete = supabase
      .from('items')
      .delete()
      .in('id', itemIds)
      .eq('status', 'working')
    if (schemaReady) itemDelete = itemDelete.eq('company_id', activeCompanyId)

    const { error } = await itemDelete

    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    if (batchId) {
      let batchUpdate = supabase
        .from('inbound_batches')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', batchId)
      if (schemaReady) batchUpdate = batchUpdate.eq('company_id', activeCompanyId)
      await batchUpdate
    }

    setMessage(`${group.label} deleted`)
    await fetchWorkingItems()
    onChanged?.()
  }

  function batchKey(item: WorkingItem) {
    return item.inbound_batch_id || item.inbound_batch_code || `single-${item.id}`
  }

  function batchLabel(item: WorkingItem) {
    return item.inbound_batch_code || 'Unbatched working items'
  }

  const groupedItems = items.reduce<Array<{ key: string; label: string; items: WorkingItem[] }>>(
    (groups, item) => {
      const key = batchKey(item)
      const existing = groups.find((group) => group.key === key)

      if (existing) {
        existing.items.push(item)
        return groups
      }

      groups.push({
        key,
        label: batchLabel(item),
        items: [item],
      })

      return groups
    },
    []
  )

  return (
    <div className={embedded ? 'space-y-4' : ''}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black tracking-normal">Working Items</h2>
          <p className="text-sm text-zinc-300">{items.length} item(s) not yet sent to review</p>
          {staff && <p className="mt-1 text-xs font-bold text-green-300">Active staff: {staff.name}</p>}
        </div>

        <button
          onClick={fetchWorkingItems}
          className="rounded-xl bg-white px-5 py-2 text-sm font-black text-black hover:bg-zinc-200"
        >
          Refresh
        </button>
      </div>

      {message && (
        <div className="mb-4 rounded-lg border border-yellow-700 bg-yellow-950 p-3 text-sm text-yellow-300">
          {message}
        </div>
      )}

      <section className="mb-5 max-w-xl rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <label className="block">
          <span className="mb-2 block text-sm font-bold text-zinc-300">Scan or Enter SKU</span>
          <input
            autoFocus={!embedded}
            value={sku}
            onChange={(event) => {
              setSku(event.target.value)
              setSearched(false)
              setMessage('')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') searchSku()
            }}
            placeholder="Scan or enter SKU"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-4 text-xl text-white outline-none focus:border-white"
          />
        </label>

        <div className="mt-4 flex gap-3">
          <button
            onClick={searchSku}
            disabled={loading}
            className="rounded-lg bg-white px-5 py-3 text-sm font-bold text-black disabled:opacity-50"
          >
            {loading ? 'Searching...' : 'Search SKU'}
          </button>

          <button
            onClick={() => {
              setSku('')
              setSearched(false)
              setMessage('')
            }}
            className="rounded-lg bg-zinc-800 px-5 py-3 text-sm font-bold text-white hover:bg-zinc-700"
          >
            Clear
          </button>
        </div>

        {searched && (
          <div className="mt-5 rounded-lg border border-zinc-700 bg-zinc-950 p-4">
            <p className="text-sm text-zinc-300">No item found for:</p>
            <p className="mt-1 text-xl font-bold">{sku.trim()}</p>
            <button
              onClick={createItem}
              disabled={loading || !staff}
              className="mt-4 rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-500 disabled:opacity-50"
            >
              Create New Item
            </button>
          </div>
        )}
      </section>

      {items.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-400">
          No items in working queue.
        </div>
      ) : (
        <div className="space-y-4">
          {groupedItems.map((group) => {
            const open = openBatches[group.key] ?? true
            const firstItem = group.items[0]
            const batchDefaults = [firstItem.brand, firstItem.reporting_category].filter(Boolean).join(' · ')
            const batchStats = firstItem.inbound_batch_id ? batchStatsById[firstItem.inbound_batch_id] : null

            return (
              <section key={group.key} className="rounded-xl border border-zinc-800 bg-zinc-950">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-xl bg-zinc-900 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setOpenBatches((current) => ({ ...current, [group.key]: !open }))}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block text-sm font-black text-white">{group.label}</span>
                    <span className="mt-1 block text-xs font-bold text-zinc-400">
                      {group.items.length} item(s){batchDefaults ? ` · ${batchDefaults}` : ''}
                    </span>
                    {batchStats && (
                      <span className="mt-1 block text-xs font-bold text-zinc-400">
                        Batch progress: {batchStats.sentToReview} sent to review · {batchStats.quarantine} quarantine
                        {batchStats.total !== group.items.length ? ` · ${batchStats.total} total` : ''}
                      </span>
                    )}
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setOpenBatches((current) => ({ ...current, [group.key]: !open }))}
                      className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white hover:bg-zinc-700"
                    >
                      {open ? 'Hide' : 'Open'}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteWorkingBatch(group)}
                      disabled={loading || !staff}
                      className="rounded-lg bg-red-900 px-3 py-2 text-xs font-black text-red-100 hover:bg-red-800 disabled:opacity-40"
                    >
                      Delete Batch
                    </button>
                  </div>
                </div>

                {open && (
                  <div className="space-y-3 p-3">
                    {group.items.map((item) => {
                      const thumbnailUrl = imagesByItem[item.id]

                      return (
                        <section key={item.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
                          <div className="grid gap-4 md:grid-cols-[72px_1fr_180px] md:items-center">
                            <div className="h-16 w-16 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950">
                              {thumbnailUrl ? (
                                <img
                                  src={thumbnailUrl}
                                  alt="Item thumbnail"
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="flex h-full items-center justify-center text-[10px] text-zinc-500">
                                  No image
                                </div>
                              )}
                            </div>

                            <div>
                              <h2 className="text-base font-bold">{item.sku}</h2>
                              <p className="text-sm text-zinc-400">
                                {item.brand || 'No brand'} · {item.reporting_category || 'No category'}
                              </p>
                              <p className="mt-1 line-clamp-1 text-sm text-zinc-500">
                                {item.basic_title || item.ai_title || item.rfid_tid || '-'}
                              </p>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <Link
                                href={`/items/${item.id}`}
                                className="rounded-lg bg-zinc-800 px-3 py-2 text-center text-xs font-bold text-white hover:bg-zinc-700"
                              >
                                Open
                              </Link>

                              <button
                                type="button"
                                onClick={() => deleteWorkingItem(item)}
                                disabled={loading || !staff}
                                className="rounded-lg bg-red-900 px-3 py-2 text-center text-xs font-bold text-red-100 hover:bg-red-800 disabled:opacity-40"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </section>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

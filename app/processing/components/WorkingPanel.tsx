'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useStaff } from '@/app/context/StaffContext'
import { supabase } from '@/lib/supabase'

type WorkingItem = {
  id: string
  sku: string
  brand: string | null
  reporting_category: string | null
  basic_title: string | null
  ai_title: string | null
}

type WorkingPanelProps = {
  embedded?: boolean
}

export default function WorkingPanel({ embedded = false }: WorkingPanelProps) {
  const router = useRouter()
  const { staff } = useStaff()

  const [items, setItems] = useState<WorkingItem[]>([])
  const [imagesByItem, setImagesByItem] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [sku, setSku] = useState('')
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchWorkingItems()
  }, [])

  async function fetchWorkingItems() {
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('status', 'working')
      .order('created_at', { ascending: false })

    if (error) {
      setMessage(error.message)
      return
    }

    const workingItems = data || []
    setItems(workingItems)
    fetchThumbnails(workingItems)
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

    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('sku', cleanSku)
      .maybeSingle()

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

    const { error: imageError } = await supabase
      .from('item_images')
      .delete()
      .eq('item_id', item.id)

    if (imageError) {
      setLoading(false)
      setMessage(imageError.message)
      return
    }

    const { error } = await supabase
      .from('items')
      .delete()
      .eq('id', item.id)
      .eq('status', 'working')

    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage(`${item.sku} deleted`)
    fetchWorkingItems()
  }

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
            onChange={(e) => {
              setSku(e.target.value)
              setSearched(false)
              setMessage('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') searchSku()
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
        <div className="space-y-3">
          {items.map((item) => {
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
                      {item.basic_title || item.ai_title || '-'}
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
    </div>
  )
}

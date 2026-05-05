// Working Page
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import AppNav from '@/app/components/AppNav'

export default function WorkingPage() {
  const router = useRouter()

  const [items, setItems] = useState<any[]>([])
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

  async function fetchThumbnails(workingItems: any[]) {
    const imageMap: Record<string, string> = {}

    for (const item of workingItems) {
      const { data } = await supabase
        .from('item_images')
        .select('*')
        .eq('item_id', item.id)
        .order('image_order', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (data) {
        imageMap[item.id] = data.processed_url || data.original_url
      }
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

    setLoading(true)
    setMessage('Creating item...')

    const { data, error } = await supabase
      .from('items')
      .insert({
        sku: cleanSku,
        status: 'working',
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

  return (
    <main className="min-h-screen bg-zinc-950 p-5 text-white">
      <div className="mb-5 flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">
              Working Items
            </h1>

            <p className="text-sm text-zinc-400">
              {items.length} item(s) not yet sent to review
            </p>
          </div>

          <AppNav current="working" />
        </div>

        <button
          onClick={fetchWorkingItems}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold hover:bg-blue-500"
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
          <span className="mb-2 block text-sm font-bold text-zinc-300">
            Scan or Enter SKU
          </span>

          <input
            autoFocus
            value={sku}
            onChange={(e) => {
              setSku(e.target.value)
              setSearched(false)
              setMessage('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                searchSku()
              }
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
            className="rounded-lg bg-zinc-800 px-5 py-3 text-sm font-bold hover:bg-zinc-700"
          >
            Clear
          </button>
        </div>

        {searched && (
          <div className="mt-5 rounded-lg border border-zinc-700 bg-zinc-950 p-4">
            <p className="text-sm text-zinc-300">
              No item found for:
            </p>

            <p className="mt-1 text-xl font-bold">
              {sku.trim()}
            </p>

            <button
              onClick={createItem}
              disabled={loading}
              className="mt-4 rounded-lg bg-green-600 px-4 py-2 text-sm font-bold hover:bg-green-500 disabled:opacity-50"
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
              <section
                key={item.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900 p-3"
              >
                <div className="grid grid-cols-[72px_1fr_120px] items-center gap-4">
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
                    <h2 className="text-base font-bold">
                      {item.sku}
                    </h2>

                    <p className="text-sm text-zinc-400">
                      {item.brand || 'No brand'} ·{' '}
                      {item.reporting_category || 'No category'}
                    </p>

                    <p className="mt-1 line-clamp-1 text-sm text-zinc-500">
                      {item.basic_title || item.ai_title || '-'}
                    </p>
                  </div>

                  <Link
                    href={`/items/${item.id}`}
                    className="rounded-lg bg-zinc-800 px-3 py-2 text-center text-xs font-bold hover:bg-zinc-700"
                  >
                    Open
                  </Link>
                </div>
              </section>
            )
          })}
        </div>
      )}
    </main>
  )
}
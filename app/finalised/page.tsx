'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import AppNav from '@/app/components/AppNav'

export default function FinalisedPage() {
  const [items, setItems] = useState<any[]>([])
  const [imagesByItem, setImagesByItem] = useState<Record<string, string>>({})
  const [selectedItems, setSelectedItems] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchFinalisedItems()
  }, [])

  async function fetchFinalisedItems() {
    setLoading(true)
    setMessage('')

    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('status', 'finalised')
      .order('created_at', { ascending: false })

    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    const finalisedItems = data || []

    setItems(finalisedItems)
    setSelectedItems([])
    fetchThumbnails(finalisedItems)
  }

  async function fetchThumbnails(finalisedItems: any[]) {
    const imageMap: Record<string, string> = {}

    for (const item of finalisedItems) {
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

  function toggleItem(itemId: string) {
    setSelectedItems((prev) =>
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId]
    )
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedItems([])
    } else {
      setSelectedItems(items.map((item) => item.id))
    }
  }

  const allSelected =
    items.length > 0 && selectedItems.length === items.length

  return (
    <main className="min-h-screen bg-zinc-950 p-5 text-white">
      {/* HEADER */}
      <div className="mb-5 flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">Finalised Items</h1>

            <p className="text-sm text-zinc-400">
              {items.length} item(s) · {selectedItems.length} selected
            </p>
          </div>

          <AppNav current="finalised" />
        </div>

        <div className="flex items-center gap-3">
          {message && (
            <span className="rounded-lg border border-yellow-700 bg-yellow-950 px-4 py-2 text-sm font-bold text-yellow-300">
              {message}
            </span>
          )}

          <button
            onClick={fetchFinalisedItems}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* SELECT ALL ROW */}
      {items.length > 0 && (
        <div className="mb-2 flex items-center gap-3 px-2">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="h-5 w-5"
          />

          <span className="text-sm text-zinc-400">
            Select All
          </span>
        </div>
      )}

      {/* CONTENT */}
      {items.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-400">
          No finalised items.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const thumbnailUrl = imagesByItem[item.id]
            const selected = selectedItems.includes(item.id)

            return (
              <section
                key={item.id}
                className={`w-full rounded-xl border p-3 transition ${
                  selected
                    ? 'border-green-500 bg-green-950/20'
                    : 'border-zinc-800 bg-zinc-900'
                }`}
              >
                <div className="grid grid-cols-[40px_80px_1fr_120px] items-center gap-4">
                  {/* CHECKBOX */}
                  <div className="flex justify-center">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleItem(item.id)}
                      className="h-5 w-5"
                    />
                  </div>

                  {/* IMAGE */}
                  <div className="h-16 w-16 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950">
                    {thumbnailUrl ? (
                      <img
                        src={thumbnailUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[10px] text-zinc-500">
                        No image
                      </div>
                    )}
                  </div>

                  {/* INFO */}
                  <div>
                    <h2 className="text-base font-bold">{item.sku}</h2>

                    <p className="text-sm text-zinc-400">
                      {item.brand || 'No brand'} ·{' '}
                      {item.reporting_category || 'No category'}
                    </p>

                    <p className="mt-1 line-clamp-1 text-sm text-zinc-500">
                      {item.ai_title || item.basic_title || '-'}
                    </p>
                  </div>

                  {/* ACTION */}
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
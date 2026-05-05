'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import AppNav from '@/app/components/AppNav'

export default function ReviewPage() {
  const [items, setItems] = useState<any[]>([])
  const [imagesByItem, setImagesByItem] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetchReviewItems()
  }, [])

  async function fetchReviewItems() {
    setMessage('')

    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('status', 'review')
      .order('created_at', { ascending: false })

    if (error) {
      setMessage(error.message)
      return
    }

    const reviewItems = data || []
    setItems(reviewItems)
    fetchThumbnails(reviewItems)
  }

  async function fetchThumbnails(reviewItems: any[]) {
    const imageMap: Record<string, string> = {}

    for (const item of reviewItems) {
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

  function missingFields(item: any) {
    const required = [
      ['reporting_category', 'Category'],
      ['cost_price', 'Cost Price'],
      ['selling_price', 'Sale Price'],
      ['brand', 'Brand'],
      ['ai_title', 'AI Marketplace Title'],
      ['ai_description', 'AI Description'],
      ['website_title', 'Website Title'],
    ]

    const missing = required
      .filter(([key]) => !item[key])
      .map(([_, label]) => label)

    if (!imagesByItem[item.id]) {
      missing.push('Image')
    }

    return missing
  }

  async function finaliseItem(item: any) {
    const missing = missingFields(item)

    if (missing.length > 0) {
      window.alert(
        `Cannot finalise SKU ${item.sku}. Missing: ${missing.join(', ')}`
      )
      return
    }

    const confirmed = window.confirm(`Finalise SKU ${item.sku}?`)
    if (!confirmed) return

    const { error } = await supabase
      .from('items')
      .update({ status: 'finalised' })
      .eq('id', item.id)

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage(`SKU ${item.sku} finalised`)
    fetchReviewItems()
  }

  return (
    <main className="min-h-screen bg-zinc-950 p-5 text-white">
      <div className="mb-5 flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">Review Queue</h1>

            <p className="text-sm text-zinc-400">
              {items.length} item(s) waiting for review
            </p>
          </div>

          <AppNav current="review" />
        </div>

        <div className="flex items-center gap-3">
          {message && (
            <span className="rounded-lg border border-yellow-700 bg-yellow-950 px-4 py-2 text-sm font-bold text-yellow-300">
              {message}
            </span>
          )}

          <button
            onClick={fetchReviewItems}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold hover:bg-blue-500"
          >
            Refresh
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-400">
          No items currently in review.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const missing = missingFields(item)
            const thumbnailUrl = imagesByItem[item.id]

            return (
              <section
                key={item.id}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-4"
              >
                <div className="grid gap-4 xl:grid-cols-[110px_1fr_1.3fr_220px]">
                  <div className="h-28 w-28 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950">
                    {thumbnailUrl ? (
                      <img
                        src={thumbnailUrl}
                        alt="Item thumbnail"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-zinc-500">
                        No image
                      </div>
                    )}
                  </div>

                  <div>
                    <h2 className="text-xl font-bold">SKU: {item.sku}</h2>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-zinc-400">
                      <p>
                        <strong>Brand:</strong> {item.brand || '-'}
                      </p>

                      <p>
                        <strong>Category:</strong>{' '}
                        {item.reporting_category || '-'}
                      </p>

                      <p>
                        <strong>Basic Title:</strong>{' '}
                        {item.basic_title || '-'}
                      </p>

                      <p>
                        <strong>Sale Price:</strong>{' '}
                        {item.selling_price ? `£${item.selling_price}` : '-'}
                      </p>

                      <p className="col-span-2 line-clamp-2">
                        <strong>Staff Notes:</strong>{' '}
                        {item.staff_notes || '-'}
                      </p>
                    </div>

                    <div className="mt-3">
                      <h3 className="mb-1 text-xs font-bold uppercase text-zinc-500">
                        Missing
                      </h3>

                      {missing.length === 0 ? (
                        <p className="text-sm text-green-400">
                          Nothing required missing.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {missing.map((field) => (
                            <span
                              key={field}
                              className="rounded bg-red-950 px-2 py-1 text-xs font-bold text-red-300"
                            >
                              {field}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <h3 className="mb-2 text-xs font-bold uppercase text-zinc-500">
                      Generated Copy
                    </h3>

                    <p className="mb-2 text-sm text-zinc-300">
                      <strong>AI Title:</strong> {item.ai_title || '-'}
                    </p>

                    <p className="mb-2 text-sm text-zinc-300">
                      <strong>Website Title:</strong>{' '}
                      {item.website_title || '-'}
                    </p>

                    <p className="line-clamp-6 whitespace-pre-wrap text-sm text-zinc-400">
                      {item.ai_description || 'No AI description'}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Link
                      href={`/items/${item.id}`}
                      className="rounded-lg bg-zinc-800 px-4 py-2 text-center text-sm font-bold hover:bg-zinc-700"
                    >
                      Edit / Check SKU
                    </Link>

                    <button
                      onClick={() => finaliseItem(item)}
                      disabled={missing.length > 0}
                      className="rounded-lg bg-green-600 px-4 py-2 text-sm font-bold hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
                    >
                      Approve / Finalise
                    </button>
                  </div>
                </div>
              </section>
            )
          })}
        </div>
      )}
    </main>
  )
}
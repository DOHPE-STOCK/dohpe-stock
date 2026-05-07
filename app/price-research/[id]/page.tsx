'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import AppNav from '@/app/components/AppNav'
import { useStaff } from '@/app/context/StaffContext'
import { supabase } from '@/lib/supabase'

type ItemImage = {
  processed_url: string | null
  original_url: string | null
  image_order: number | null
}

type Item = {
  id: string
  sku: string
  brand: string | null
  reporting_category: string | null
  colour_primary: string | null
  colour_secondary: string | null
  tagged_size: string | null
  waist_in: number | string | null
  ai_title: string | null
  basic_title: string | null
  selling_price: number | null
  status: string | null
  ebay_status: string | null
  shopify_status: string | null
  vinted_status: string | null
  depop_status: string | null
  tiktok_shop_status: string | null
  item_images?: ItemImage[]
}

type CompStats = {
  count: number
  average: number | null
  low: number | null
  high: number | null
}

function money(value: number | null | undefined) {
  if (typeof value !== 'number') return '-'
  return `£${value.toFixed(2)}`
}

function cleanText(value?: string | null) {
  return (value || '').trim()
}

function buildSearchQuery(item: Item | null) {
  if (!item) return ''

  return [
    cleanText(item.brand),
    cleanText(item.reporting_category),
    cleanText(item.colour_primary),
    cleanText(item.colour_secondary),
    cleanText(item.tagged_size),
    cleanText(item.basic_title || item.ai_title),
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getBestImage(item: Item | null) {
  const images = item?.item_images || []

  const sorted = [...images]
    .filter((img) => img.processed_url || img.original_url)
    .sort((a, b) => (a.image_order ?? 0) - (b.image_order ?? 0))

  return sorted[0]?.processed_url || sorted[0]?.original_url || null
}

function encodeQuery(query: string) {
  return encodeURIComponent(query)
}

function getEbaySoldUrl(query: string) {
  return `https://www.ebay.co.uk/sch/i.html?_nkw=${encodeQuery(
    query
  )}&LH_Sold=1&LH_Complete=1`
}

function getEbayLiveUrl(query: string) {
  return `https://www.ebay.co.uk/sch/i.html?_nkw=${encodeQuery(query)}`
}

function getVintedUrl(query: string) {
  return `https://www.vinted.co.uk/catalog?search_text=${encodeQuery(query)}`
}

function getDepopUrl(query: string) {
  return `https://www.depop.com/search/?q=${encodeQuery(query)}`
}

function getGrailedUrl(query: string) {
  return `https://www.grailed.com/shop/${encodeQuery(query)}`
}

function getRockitUrl(query: string) {
  return `https://www.rokit.co.uk/search?q=${encodeQuery(query)}`
}

function getGoogleSearchUrl(query: string) {
  return `https://www.google.com/search?q=${encodeQuery(query)}`
}

function getLensUrl(imageUrl: string) {
  return `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(
    imageUrl
  )}`
}

function isLiveItem(item: Item) {
  return [
    item.ebay_status,
    item.shopify_status,
    item.vinted_status,
    item.depop_status,
    item.tiktok_shop_status,
  ].some((status) =>
    ['listed', 'active', 'synced', 'live'].includes(String(status || ''))
  )
}

function isSoldItem(item: Item) {
  return [
    item.status,
    item.ebay_status,
    item.shopify_status,
    item.vinted_status,
    item.depop_status,
    item.tiktok_shop_status,
  ].some((status) => ['sold', 'ended', 'completed'].includes(String(status || '')))
}

function getStats(items: Item[]): CompStats {
  const prices = items
    .map((item) => item.selling_price)
    .filter((value): value is number => typeof value === 'number')

  if (prices.length === 0) {
    return { count: items.length, average: null, low: null, high: null }
  }

  return {
    count: items.length,
    average: prices.reduce((sum, value) => sum + value, 0) / prices.length,
    low: Math.min(...prices),
    high: Math.max(...prices),
  }
}

export default function PriceResearchPage() {
  const params = useParams()
  const router = useRouter()
  const { staff } = useStaff()

  const itemId = String(params.id)

  const [item, setItem] = useState<Item | null>(null)
  const [internalComps, setInternalComps] = useState<Item[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [suggestedPrice, setSuggestedPrice] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchItem()
  }, [itemId])

  async function fetchItem() {
    setLoading(true)
    setMessage('')

    const { data, error } = await supabase
      .from('items')
      .select(`
        id,
        sku,
        brand,
        reporting_category,
        colour_primary,
        colour_secondary,
        tagged_size,
        waist_in,
        ai_title,
        basic_title,
        selling_price,
        status,
        ebay_status,
        shopify_status,
        vinted_status,
        depop_status,
        tiktok_shop_status,
        item_images (
          processed_url,
          original_url,
          image_order
        )
      `)
      .eq('id', itemId)
      .single()

    if (error || !data) {
      setLoading(false)
      setMessage(error?.message || 'Item not found.')
      return
    }

    const loadedItem = data as Item
    setItem(loadedItem)

    const query = buildSearchQuery(loadedItem)
    setSearchQuery(query)
    setSuggestedPrice(
      typeof loadedItem.selling_price === 'number'
        ? loadedItem.selling_price.toFixed(2)
        : ''
    )

    await fetchInternalComps(loadedItem)

    setLoading(false)
  }

  async function fetchInternalComps(baseItem: Item) {
    if (!baseItem.brand || !baseItem.reporting_category) {
      setInternalComps([])
      return
    }

    const { data, error } = await supabase
      .from('items')
      .select(`
        id,
        sku,
        brand,
        reporting_category,
        colour_primary,
        colour_secondary,
        tagged_size,
        waist_in,
        ai_title,
        basic_title,
        selling_price,
        status,
        ebay_status,
        shopify_status,
        vinted_status,
        depop_status,
        tiktok_shop_status,
        item_images (
          processed_url,
          original_url,
          image_order
        )
      `)
      .neq('id', baseItem.id)
      .eq('brand', baseItem.brand)
      .eq('reporting_category', baseItem.reporting_category)
      .not('selling_price', 'is', null)
      .limit(30)

    if (error) {
      setMessage(error.message)
      setInternalComps([])
      return
    }

    setInternalComps((data || []) as Item[])
  }

  async function applyPrice() {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    const price = Number(suggestedPrice)

    if (!price || price <= 0) {
      setMessage('Enter a valid price first.')
      return
    }

    setSaving(true)
    setMessage('Saving price...')

    const now = new Date().toISOString()

    const { error } = await supabase
      .from('items')
      .update({
        selling_price: price,
        last_saved_by: staff.id,
        updated_at: now,
      })
      .eq('id', itemId)

    setSaving(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage(`Applied sale price: £${price.toFixed(2)}`)
    setItem((prev) => (prev ? { ...prev, selling_price: price } : prev))
  }

  const bestImage = getBestImage(item)

  const liveComps = useMemo(
    () => internalComps.filter(isLiveItem),
    [internalComps]
  )

  const soldComps = useMemo(
    () => internalComps.filter(isSoldItem),
    [internalComps]
  )

  const liveStats = useMemo(() => getStats(liveComps), [liveComps])
  const soldStats = useMemo(() => getStats(soldComps), [soldComps])
  const allStats = useMemo(() => getStats(internalComps), [internalComps])

  if (loading) {
    return (
      <main className="min-h-screen bg-neutral-950 p-5 text-white">
        <p className="text-neutral-400">Loading price research...</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-neutral-950 p-5 text-white">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div>
          <h1 className="text-2xl font-bold">Price Research</h1>

          <p className="text-sm text-neutral-400">
            Use internal comps, Google Lens, marketplace searches, and Rockit.
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

        <AppNav />
      </div>

      {message && (
        <div className="mb-5 rounded-xl border border-yellow-800 bg-yellow-950 p-4 text-sm font-bold text-yellow-300">
          {message}
        </div>
      )}

      {!item ? (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center text-neutral-500">
          Item not found.
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
          <section className="space-y-5">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
              <div className="mb-4 aspect-square overflow-hidden rounded-xl bg-neutral-950">
                {bestImage ? (
                  <img
                    src={bestImage}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-neutral-500">
                    No image
                  </div>
                )}
              </div>

              <p className="font-mono text-xs text-neutral-500">{item.sku}</p>

              <h2 className="text-xl font-black">
                {item.ai_title || item.basic_title || 'Untitled item'}
              </h2>

              <div className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-300">
                <span className="rounded-full bg-neutral-950 px-2 py-1">
                  {item.brand || 'No brand'}
                </span>
                <span className="rounded-full bg-neutral-950 px-2 py-1">
                  {item.reporting_category || 'No category'}
                </span>
                <span className="rounded-full bg-neutral-950 px-2 py-1">
                  {item.colour_primary || 'No colour'}
                </span>
                <span className="rounded-full bg-neutral-950 px-2 py-1">
                  {item.tagged_size || 'No size'}
                </span>
              </div>

              <div className="mt-4 rounded-xl bg-neutral-950 p-4">
                <p className="text-sm text-neutral-400">Current sale price</p>
                <p className="text-4xl font-black">
                  {money(item.selling_price)}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
              <h2 className="mb-3 text-lg font-black">Apply Price</h2>

              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.01"
                  value={suggestedPrice}
                  onChange={(e) => setSuggestedPrice(e.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-xl font-black outline-none focus:border-white"
                  placeholder="39.99"
                />

                <button
                  onClick={applyPrice}
                  disabled={saving || !staff}
                  className="rounded-xl bg-white px-4 py-3 text-sm font-black text-black disabled:opacity-40"
                >
                  Apply Sale Price
                </button>
              </div>
            </div>
          </section>

          <section className="space-y-5">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
              <h2 className="mb-3 text-lg font-black">Search Phrase</h2>

              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm outline-none focus:border-white"
              />

              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {bestImage && (
                  <a
                    href={getLensUrl(bestImage)}
                    target="_blank"
                    className="rounded-xl bg-white px-4 py-3 text-center text-sm font-black text-black"
                  >
                    Google Lens Image
                  </a>
                )}

                <a
                  href={getEbaySoldUrl(searchQuery)}
                  target="_blank"
                  className="rounded-xl border border-neutral-700 px-4 py-3 text-center text-sm font-black"
                >
                  eBay Sold
                </a>

                <a
                  href={getEbayLiveUrl(searchQuery)}
                  target="_blank"
                  className="rounded-xl border border-neutral-700 px-4 py-3 text-center text-sm font-black"
                >
                  eBay Live
                </a>

                <a
                  href={getVintedUrl(searchQuery)}
                  target="_blank"
                  className="rounded-xl border border-neutral-700 px-4 py-3 text-center text-sm font-black"
                >
                  Vinted
                </a>

                <a
                  href={getDepopUrl(searchQuery)}
                  target="_blank"
                  className="rounded-xl border border-neutral-700 px-4 py-3 text-center text-sm font-black"
                >
                  Depop
                </a>

                <a
                  href={getGrailedUrl(searchQuery)}
                  target="_blank"
                  className="rounded-xl border border-neutral-700 px-4 py-3 text-center text-sm font-black"
                >
                  Grailed
                </a>

                <a
                  href={getRockitUrl(searchQuery)}
                  target="_blank"
                  className="rounded-xl border border-neutral-700 px-4 py-3 text-center text-sm font-black"
                >
                  Rockit
                </a>

                <a
                  href={getGoogleSearchUrl(`${searchQuery} sold vintage`)}
                  target="_blank"
                  className="rounded-xl border border-neutral-700 px-4 py-3 text-center text-sm font-black"
                >
                  Google Search
                </a>
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
              <h2 className="mb-3 text-lg font-black">Internal Comps</h2>

              <div className="grid gap-3 md:grid-cols-3">
                <StatCard title="All Matches" stats={allStats} />
                <StatCard title="Live / Listed" stats={liveStats} />
                <StatCard title="Sold / Ended" stats={soldStats} />
              </div>

              <div className="mt-4 space-y-2">
                {internalComps.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-neutral-800 p-6 text-center text-neutral-500">
                    No internal comps found for same brand + category.
                  </div>
                ) : (
                  internalComps.map((comp) => (
                    <div
                      key={comp.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-xs text-neutral-500">
                          {comp.sku}
                        </p>

                        <p className="truncate text-sm font-bold">
                          {comp.ai_title || comp.basic_title || 'Untitled'}
                        </p>

                        <p className="text-xs text-neutral-400">
                          {comp.status || 'No status'} · eBay:{' '}
                          {comp.ebay_status || '-'} · Vinted:{' '}
                          {comp.vinted_status || '-'} · Depop:{' '}
                          {comp.depop_status || '-'}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="text-lg font-black">
                          {money(comp.selling_price)}
                        </p>

                        <button
                          onClick={() =>
                            setSuggestedPrice(
                              typeof comp.selling_price === 'number'
                                ? comp.selling_price.toFixed(2)
                                : ''
                            )
                          }
                          className="mt-1 rounded-lg border border-neutral-700 px-3 py-1 text-xs font-bold"
                        >
                          Use
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

function StatCard({ title, stats }: { title: string; stats: CompStats }) {
  return (
    <div className="rounded-xl bg-neutral-950 p-4">
      <p className="text-sm font-bold text-neutral-400">{title}</p>

      <p className="mt-1 text-3xl font-black">{stats.count}</p>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="text-neutral-500">Avg</p>
          <p className="font-bold">{money(stats.average)}</p>
        </div>

        <div>
          <p className="text-neutral-500">Low</p>
          <p className="font-bold">{money(stats.low)}</p>
        </div>

        <div>
          <p className="text-neutral-500">High</p>
          <p className="font-bold">{money(stats.high)}</p>
        </div>
      </div>
    </div>
  )
}
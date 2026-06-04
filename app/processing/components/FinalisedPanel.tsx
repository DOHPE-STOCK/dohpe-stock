'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useStaff } from '@/app/context/StaffContext'
import { supabase } from '@/lib/supabase'

const CHANNEL_ICONS = [
  { key: 'ebay_status', name: 'eBay', src: 'https://www.google.com/s2/favicons?domain=ebay.co.uk&sz=64' },
  { key: 'linnworks_status', name: 'Linnworks', src: 'https://www.google.com/s2/favicons?domain=linnworks.com&sz=64' },
  { key: 'shopify_status', name: 'Shopify', src: 'https://www.google.com/s2/favicons?domain=shopify.com&sz=64' },
  { key: 'square_status', name: 'Square', src: 'https://www.google.com/s2/favicons?domain=squareup.com&sz=64' },
  { key: 'loyverse_status', name: 'Loyverse', src: 'https://www.google.com/s2/favicons?domain=loyverse.com&sz=64' },
  { key: 'vinted_status', name: 'Vinted', src: 'https://www.google.com/s2/favicons?domain=vinted.co.uk&sz=64' },
  { key: 'depop_status', name: 'Depop', src: 'https://www.google.com/s2/favicons?domain=depop.com&sz=64' },
  { key: 'tiktok_shop_status', name: 'TikTok Shop', src: 'https://www.google.com/s2/favicons?domain=tiktok.com&sz=64' },
] as const

const MEASUREMENT_FIELDS = [
  'pit_to_pit_in',
  'collar_to_hem_in',
  'pit_to_cuff_in',
  'sleeve_in',
  'waist_in',
  'inside_leg_in',
  'rise_in',
  'hem_width_in',
]

type FinalisedPanelProps = {
  embedded?: boolean
}

function channelOpacity(status?: string | null) {
  if (!status || status === 'not_listed' || status === 'not_synced') return 'opacity-25 grayscale'
  if (status === 'listed' || status === 'synced' || status === 'active') return 'opacity-100'
  if (status === 'error' || status === 'failed') return 'opacity-80 grayscale ring-1 ring-red-500'
  if (status === 'queued' || status === 'pending' || status === 'syncing') return 'animate-pulse opacity-60 grayscale'
  return 'opacity-40 grayscale'
}

function getExportTitle(item: any) {
  return item.final_title || item.ai_title || item.basic_title || item.website_title || item.sku
}

function getExportDescription(item: any) {
  return item.final_description || item.ai_description || item.basic_description || ''
}

function buildLinnworksPayload(item: any, processedImageUrls: string[]) {
  const payload: any = {
    id: item.id,
    sku: item.sku,
    linnworks_item_id: item.linnworks_item_id,
    title: getExportTitle(item),
    final_title: item.final_title,
    ai_title: item.ai_title,
    basic_title: item.basic_title,
    website_title: item.website_title,
    final_description: item.final_description,
    ai_description: item.ai_description,
    basic_description: item.basic_description,
    description: getExportDescription(item),
    brand: item.brand,
    reporting_category: item.reporting_category,
    sub_category: item.sub_category,
    sub_type: item.sub_category || item.sub_type,
    tagged_size: item.tagged_size,
    size_label: item.size_label,
    condition: item.condition,
    material: item.material,
    colour: item.colour,
    color: item.color,
    colour_primary: item.colour_primary,
    primary_colour: item.primary_colour,
    style: item.style,
    era: item.era,
    gender: item.gender,
    flaws: item.flaws,
    selling_price: item.selling_price,
    cost_price: item.cost_price,
    stock_level: item.stock_level ?? 1,
    weight_grams: item.weight_grams,
    current_location: item.current_location,
    default_location: item.default_location,
    current_bin: item.current_bin,
    default_binrack: item.default_binrack,
    processed_image_urls: processedImageUrls,
  }

  for (const field of MEASUREMENT_FIELDS) {
    if (item[field] !== null && item[field] !== undefined && String(item[field]).trim() !== '') {
      payload[field] = item[field]
    }
  }

  if (item.measurements) payload.measurements = item.measurements
  return payload
}

export default function FinalisedPanel({ embedded = false }: FinalisedPanelProps) {
  const { staff } = useStaff()

  const [items, setItems] = useState<any[]>([])
  const [imagesByItem, setImagesByItem] = useState<Record<string, string>>({})
  const [processedImagesByItem, setProcessedImagesByItem] = useState<Record<string, string[]>>({})
  const [selectedItems, setSelectedItems] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [publishingEbay, setPublishingEbay] = useState(false)

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
    fetchImages(finalisedItems)
  }

  async function fetchImages(finalisedItems: any[]) {
    const thumbnailMap: Record<string, string> = {}
    const processedMap: Record<string, string[]> = {}

    for (const item of finalisedItems) {
      const { data } = await supabase
        .from('item_images')
        .select('*')
        .eq('item_id', item.id)
        .order('image_order', { ascending: true })

      const rows = data || []
      const firstImage = rows[0]
      if (firstImage) thumbnailMap[item.id] = firstImage.processed_url || firstImage.original_url
      processedMap[item.id] = rows.map((row) => row.processed_url).filter((url) => url && String(url).trim() !== '')
    }

    setImagesByItem(thumbnailMap)
    setProcessedImagesByItem(processedMap)
  }

  function toggleItem(itemId: string) {
    setSelectedItems((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    )
  }

  function toggleAll() {
    setSelectedItems(allSelected ? [] : items.map((item) => item.id))
  }

  function saveExportSelection() {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    const selected = items.filter((item) => selectedItems.includes(item.id))
    if (selected.length === 0) {
      setMessage('Select at least one item.')
      return
    }

    const exportDraft = {
      created_at: new Date().toISOString(),
      created_by: staff,
      item_count: selected.length,
      items: selected.map((item) => ({
        id: item.id,
        sku: item.sku,
        brand: item.brand,
        reporting_category: item.reporting_category,
        ai_title: item.ai_title,
        selling_price: item.selling_price,
      })),
    }

    window.localStorage.setItem('finalised_export_selection', JSON.stringify(exportDraft))
    setMessage(`Saved export selection for ${selected.length} item(s) by ${staff.name}.`)
  }

  async function exportSelectedToLinnworks() {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    const selected = items.filter((item) => selectedItems.includes(item.id))
    if (selected.length === 0) {
      setMessage('Select at least one item.')
      return
    }

    const confirmed = window.confirm(`Export ${selected.length} item(s) to Linnworks inventory?`)
    if (!confirmed) return

    setExporting(true)
    setMessage(`Exporting ${selected.length} item(s) to Linnworks...`)

    let successCount = 0
    let failCount = 0

    for (const item of selected) {
      setItems((current) =>
        current.map((row) => (row.id === item.id ? { ...row, linnworks_status: 'pending' } : row))
      )

      await supabase
        .from('items')
        .update({
          linnworks_status: 'pending',
          linnworks_sync_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id)

      try {
        const processedImageUrls = processedImagesByItem[item.id] || []
        const response = await fetch('/api/integrations/linnworks/export-item', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildLinnworksPayload(item, processedImageUrls)),
        })
        const data = await response.json()

        if (!response.ok || !data.ok) throw new Error(data.message || 'Linnworks export failed.')

        await supabase
          .from('items')
          .update({
            linnworks_status: 'synced',
            linnworks_managed: true,
            linnworks_item_id: data.linnworks_item_id,
            linnworks_item_number: data.linnworks_item_number,
            linnworks_synced_at: new Date().toISOString(),
            linnworks_sync_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id)

        setItems((current) =>
          current.map((row) =>
            row.id === item.id
              ? {
                  ...row,
                  linnworks_status: 'synced',
                  linnworks_managed: true,
                  linnworks_item_id: data.linnworks_item_id,
                  linnworks_item_number: data.linnworks_item_number,
                  linnworks_synced_at: new Date().toISOString(),
                  linnworks_sync_error: null,
                }
              : row
          )
        )

        successCount++
      } catch (error: any) {
        failCount++

        await supabase
          .from('items')
          .update({
            linnworks_status: 'failed',
            linnworks_sync_error: error.message || 'Unknown export error.',
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id)

        setItems((current) =>
          current.map((row) =>
            row.id === item.id
              ? { ...row, linnworks_status: 'failed', linnworks_sync_error: error.message || 'Unknown export error.' }
              : row
          )
        )
      }
    }

    setExporting(false)

    if (failCount > 0) {
      setMessage(`Linnworks export finished: ${successCount} succeeded, ${failCount} failed.`)
      window.alert(`Linnworks export finished: ${successCount} succeeded, ${failCount} failed.`)
      return
    }

    setMessage(`Linnworks inventory export complete for ${successCount} item(s).`)
    window.alert(`Linnworks inventory export complete for ${successCount} item(s).`)
  }

  async function publishSelectedToEbay() {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    const selected = items.filter((item) => selectedItems.includes(item.id))
    if (selected.length === 0) {
      setMessage('Select at least one item.')
      return
    }

    const confirmed = window.confirm(
      `Publish ${selected.length} item(s) directly to eBay?\n\nThis can create live eBay listings if eBay settings are set to Production and Direct Publish.`
    )
    if (!confirmed) return

    setPublishingEbay(true)
    setMessage(`Publishing ${selected.length} item(s) to eBay...`)

    let successCount = 0
    let failCount = 0
    const failures: string[] = []

    for (const item of selected) {
      try {
        setItems((current) =>
          current.map((row) => (row.id === item.id ? { ...row, ebay_status: 'pending' } : row))
        )

        const readinessResponse = await fetch(
          `/api/integrations/ebay/listing-readiness?sku=${encodeURIComponent(item.sku)}`
        )
        const readiness = await readinessResponse.json()
        if (!readinessResponse.ok || !readiness?.ok) {
          throw new Error(readiness?.message || 'eBay readiness check failed.')
        }
        if (!readiness.ready) {
          const missing = Array.isArray(readiness.missing)
            ? readiness.missing.map((check: any) => check.label || check.key).filter(Boolean).join(', ')
            : ''
          throw new Error(missing ? `Missing eBay requirements: ${missing}` : 'Item is not eBay ready.')
        }

        const draftResponse = await fetch('/api/integrations/ebay/shadow-draft', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ readiness }),
        })
        const draft = await draftResponse.json()
        if (!draftResponse.ok || !draft?.ok) {
          throw new Error(draft?.message || 'Could not save eBay shadow draft.')
        }

        const publishResponse = await fetch('/api/integrations/ebay/publish', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sku: item.sku }),
        })
        const published = await publishResponse.json()
        if (!publishResponse.ok || !published?.ok) {
          throw new Error(published?.message || 'Could not publish eBay listing.')
        }

        setItems((current) =>
          current.map((row) =>
            row.id === item.id
              ? {
                  ...row,
                  ebay_status: 'listed',
                  ebay_listing_id: published.listing_id,
                  ebay_offer_id: published.offer_id,
                  ebay_sync_error: null,
                }
              : row
          )
        )

        successCount++
      } catch (error: any) {
        failCount++
        failures.push(`${item.sku}: ${error.message || 'Unknown eBay publish error.'}`)

        await supabase
          .from('items')
          .update({
            ebay_status: 'failed',
            ebay_sync_error: error.message || 'Unknown eBay publish error.',
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id)

        setItems((current) =>
          current.map((row) =>
            row.id === item.id
              ? { ...row, ebay_status: 'failed', ebay_sync_error: error.message || 'Unknown eBay publish error.' }
              : row
          )
        )
      }
    }

    setPublishingEbay(false)

    if (failCount > 0) {
      setMessage(`eBay publish finished: ${successCount} succeeded, ${failCount} failed.`)
      window.alert(`eBay publish finished:\n\n${successCount} succeeded\n${failCount} failed\n\n${failures.slice(0, 8).join('\n')}`)
      return
    }

    setMessage(`eBay publish complete for ${successCount} item(s).`)
    window.alert(`eBay publish complete for ${successCount} item(s).`)
  }

  const allSelected = items.length > 0 && selectedItems.length === items.length

  return (
    <div className={embedded ? 'space-y-4' : ''}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black tracking-normal">Finalised Items</h2>
          <p className="text-sm text-zinc-300">{items.length} item(s) · {selectedItems.length} selected</p>
          {staff ? (
            <p className="mt-1 text-sm font-bold text-green-300">Active staff: {staff.name}</p>
          ) : (
            <p className="mt-1 text-sm font-bold text-yellow-300">No active staff selected</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {message && (
            <span className="rounded-lg border border-yellow-700 bg-yellow-950 px-4 py-2 text-sm font-bold text-yellow-300">
              {message}
            </span>
          )}

          <button
            onClick={exportSelectedToLinnworks}
            disabled={!staff || selectedItems.length === 0 || exporting || publishingEbay}
            className="rounded-xl bg-white px-5 py-2 text-sm font-black text-black hover:bg-zinc-200 disabled:opacity-50"
          >
            {exporting ? 'Exporting...' : 'Export to Linnworks'}
          </button>

          <button
            onClick={publishSelectedToEbay}
            disabled={!staff || selectedItems.length === 0 || exporting || publishingEbay}
            className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-black text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {publishingEbay ? 'Publishing...' : 'Publish to eBay'}
          </button>

          <button
            onClick={saveExportSelection}
            disabled={!staff || selectedItems.length === 0 || publishingEbay}
            className="rounded-lg bg-green-600 px-5 py-2 text-sm font-bold text-white hover:bg-green-500 disabled:opacity-50"
          >
            Save Export Selection
          </button>

          <button
            onClick={fetchFinalisedItems}
            disabled={loading || exporting || publishingEbay}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {items.length > 0 && (
        <div className="mb-2 flex items-center gap-3 px-2">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-5 w-5" />
          <span className="text-sm text-zinc-400">Select All</span>
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-400">
          No finalised items.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const thumbnailUrl = imagesByItem[item.id]
            const selected = selectedItems.includes(item.id)
            const processedCount = processedImagesByItem[item.id]?.length || 0

            return (
              <section
                key={item.id}
                className={`w-full rounded-xl border p-3 transition ${
                  selected ? 'border-green-500 bg-green-950/20' : 'border-zinc-800 bg-zinc-900'
                }`}
              >
                <div className="grid gap-3 md:grid-cols-[40px_64px_1fr_56px_90px] md:items-center">
                  <div className="flex justify-center">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleItem(item.id)}
                      className="h-5 w-5"
                    />
                  </div>

                  <div className="h-14 w-14 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950">
                    {thumbnailUrl ? (
                      <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[10px] text-zinc-500">
                        No image
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-bold">{item.sku}</h2>
                    <p className="truncate text-xs text-zinc-400">
                      {item.brand || 'No brand'} · {item.reporting_category || 'No category'} · £
                      {item.selling_price ?? '-'} · {processedCount} processed image(s)
                    </p>
                    <p className="mt-1 truncate text-xs text-zinc-500">{getExportTitle(item)}</p>
                    {item.linnworks_sync_error && (
                      <p className="mt-1 truncate text-xs font-bold text-red-300">
                        {item.linnworks_sync_error}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-1 rounded-lg bg-zinc-950 p-1">
                    {[0, 2, 4, 6].map((start) => (
                      <div key={start} className="flex gap-1">
                        {CHANNEL_ICONS.slice(start, start + 2).map((icon) => (
                          <img
                            key={icon.name}
                            src={icon.src}
                            title={`${icon.name}: ${String(item[icon.key] || 'not_synced')}`}
                            className={`h-4 w-4 rounded-sm ${channelOpacity(item[icon.key])}`}
                            alt=""
                          />
                        ))}
                      </div>
                    ))}
                  </div>

                  <Link
                    href={`/items/${item.id}`}
                    className="rounded-lg bg-zinc-800 px-3 py-2 text-center text-xs font-bold text-white hover:bg-zinc-700"
                  >
                    Open
                  </Link>
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

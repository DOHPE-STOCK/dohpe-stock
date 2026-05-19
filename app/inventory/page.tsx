'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'

type InventoryItem = {
  id: string
  sku: string
  barcode_number: string | null
  sku_type: string | null
  brand: string | null
  reporting_category: string | null
  sub_type: string | null
  colour_primary: string | null
  tagged_size: string | null
  waist_in: number | null
  selling_price: number | null
  stock_level: number | null
  shop_floor_stock: number | null
  warehouse_stock: number | null
  current_location: string | null
  current_bin: string | null
  linnworks_managed: boolean | null
  linnworks_status: string | null
  updated_at: string | null
}

type StockLocationRow = {
  id: string
  item_id: string
  sku: string
  location_name: string
  bin_code: string
  stock_level: number
  synced_at: string | null
}

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function currency(value: number | null | undefined) {
  const amount = Number(value || 0)
  return `£${amount.toFixed(2)}`
}

function formatDate(value: string | null) {
  if (!value) return '-'

  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getSize(item: InventoryItem) {
  if (item.waist_in) {
    return `W${item.waist_in}`
  }

  return item.tagged_size || ''
}

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [locations, setLocations] = useState<StockLocationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [locationFilter, setLocationFilter] = useState('ALL')
  const [skuTypeFilter, setSkuTypeFilter] = useState('ALL')
  const [stockFilter, setStockFilter] = useState('ALL')
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetchInventory()
  }, [])

  async function fetchInventory() {
    setLoading(true)
    setMessage('')

    const [itemsResult, locationsResult] = await Promise.all([
      supabase
        .from('items')
        .select(`
          id,
          sku,
          barcode_number,
          sku_type,
          brand,
          reporting_category,
          sub_type,
          colour_primary,
          tagged_size,
          waist_in,
          selling_price,
          stock_level,
          shop_floor_stock,
          warehouse_stock,
          current_location,
          current_bin,
          linnworks_managed,
          linnworks_status,
          updated_at
        `)
        .order('updated_at', { ascending: false })
        .limit(2000),

      supabase
        .from('item_stock_locations')
        .select(`
          id,
          item_id,
          sku,
          location_name,
          bin_code,
          stock_level,
          synced_at
        `),
    ])

    if (itemsResult.error) {
      setMessage(itemsResult.error.message)
      setLoading(false)
      return
    }

    if (locationsResult.error) {
      setMessage(locationsResult.error.message)
      setLoading(false)
      return
    }

    setItems((itemsResult.data || []) as InventoryItem[])
    setLocations((locationsResult.data || []) as StockLocationRow[])
    setLoading(false)
  }

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const q = search.toLowerCase().trim()

      const matchesSearch =
        !q ||
        text(item.sku).toLowerCase().includes(q) ||
        text(item.barcode_number).toLowerCase().includes(q) ||
        text(item.brand).toLowerCase().includes(q) ||
        text(item.reporting_category).toLowerCase().includes(q)

      const matchesSkuType =
        skuTypeFilter === 'ALL' ||
        text(item.sku_type).toLowerCase() === skuTypeFilter.toLowerCase()

      const matchesLocation =
        locationFilter === 'ALL' ||
        text(item.current_location).toLowerCase() ===
          locationFilter.toLowerCase()

      const stock = Number(item.stock_level || 0)

      const matchesStock =
        stockFilter === 'ALL' ||
        (stockFilter === 'IN_STOCK' && stock > 0) ||
        (stockFilter === 'OUT_OF_STOCK' && stock <= 0)

      return (
        matchesSearch &&
        matchesSkuType &&
        matchesLocation &&
        matchesStock
      )
    })
  }, [items, search, skuTypeFilter, locationFilter, stockFilter])

  function getLocationRows(sku: string) {
    return locations.filter((row) => row.sku === sku)
  }

  return (
    <StaffPermissionGate permission="inventory">
      <main className="min-h-screen bg-neutral-950 p-4 text-white">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <h1 className="text-2xl font-black">Inventory</h1>

              <p className="text-sm text-neutral-400">
                Compact multi-location stock view
              </p>
            </div>

            <AppNav current="inventory" />
          </div>
        </div>

        <section className="mb-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search SKU / barcode / brand"
              className="rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm outline-none"
            />

            <select
              value={skuTypeFilter}
              onChange={(e) => setSkuTypeFilter(e.target.value)}
              className="rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm outline-none"
            >
              <option value="ALL">All SKU Types</option>
              <option value="single_use">Single Use</option>
              <option value="reusable">Reusable</option>
            </select>

            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm outline-none"
            >
              <option value="ALL">All Locations</option>
              <option value="WAREHOUSE">WAREHOUSE</option>
              <option value="SHOP-1">SHOP-1</option>
              <option value="SHOP-2">SHOP-2</option>
              <option value="SHOP-3">SHOP-3</option>
            </select>

            <select
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value)}
              className="rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm outline-none"
            >
              <option value="ALL">All Stock</option>
              <option value="IN_STOCK">In Stock</option>
              <option value="OUT_OF_STOCK">Out Of Stock</option>
            </select>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
          <div className="grid grid-cols-[150px_130px_120px_1fr_100px_100px_180px_120px_110px] gap-2 border-b border-neutral-800 bg-black/40 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-neutral-400">
            <div>SKU</div>
            <div>Barcode</div>
            <div>Type</div>
            <div>Item</div>
            <div>Stock</div>
            <div>Price</div>
            <div>Location Split</div>
            <div>Linnworks</div>
            <div>Actions</div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-neutral-500">
              Loading inventory...
            </div>
          ) : (
            <div className="divide-y divide-neutral-800">
              {filteredItems.map((item) => {
                const locationRows = getLocationRows(item.sku)

                return (
                  <div
                    key={item.id}
                    className="grid grid-cols-[150px_130px_120px_1fr_100px_100px_180px_120px_110px] gap-2 px-3 py-2 text-xs"
                  >
                    <div className="truncate font-mono">
                      {item.sku}
                    </div>

                    <div className="truncate font-mono text-neutral-400">
                      {item.barcode_number || '-'}
                    </div>

                    <div>
                      <span className="rounded-full bg-neutral-800 px-2 py-1 text-[10px] font-black uppercase">
                        {item.sku_type || 'single_use'}
                      </span>
                    </div>

                    <div className="truncate">
                      <span className="font-bold">
                        {item.brand || 'No brand'}
                      </span>

                      <span className="mx-1 text-neutral-600">·</span>

                      <span className="text-neutral-300">
                        {item.reporting_category || 'No category'}
                      </span>

                      {getSize(item) && (
                        <>
                          <span className="mx-1 text-neutral-600">·</span>

                          <span className="text-neutral-500">
                            {getSize(item)}
                          </span>
                        </>
                      )}
                    </div>

                    <div className="font-black">
                      {Number(item.stock_level || 0)}
                    </div>

                    <div className="font-bold text-green-300">
                      {currency(item.selling_price)}
                    </div>

                    <div className="space-y-1 text-[10px] text-neutral-400">
                      {locationRows.map((row) => (
                        <div key={row.id}>
                          {row.location_name} / {row.bin_code}:{' '}
                          <span className="font-black text-white">
                            {row.stock_level}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="text-[10px]">
                      {item.linnworks_status || '-'}
                    </div>

                    <div>
                      <Link
                        href={`/working/items/${item.id}`}
                        className="rounded-lg bg-white px-3 py-1 text-[11px] font-black text-black"
                      >
                        Edit
                      </Link>
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


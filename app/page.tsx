'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import AppNav from '@/app/components/AppNav'
import { useStaff } from '@/app/context/StaffContext'

type ItemImage = {
  processed_url: string | null
  original_url: string | null
  image_order: number | null
}

type ScannedItem = {
  id: string | null
  sku: string
  exists: boolean
  selected: boolean
  image_url?: string | null
  ai_title?: string | null
  basic_title?: string | null
  brand?: string | null
  reporting_category?: string | null
  tagged_size?: string | null
  waist_in?: string | number | null
  condition?: string | null
  selling_price?: number | null
  stock_level?: number | null
  location_status?: string | null
  current_location?: string | null
  current_bin?: string | null
  ebay_status?: string | null
  linnworks_status?: string | null
  shopify_status?: string | null
  square_status?: string | null
  loyverse_status?: string | null
  vinted_status?: string | null
  depop_status?: string | null
  tiktok_shop_status?: string | null
}

type PreviewLabelItem = {
  sku: string
  sizeText?: string | null
  price?: number | null
}

const CHANNEL_ICONS = [
  { key: 'ebay_status', name: 'eBay', src: 'https://www.ebay.co.uk/favicon.ico' },
  { key: 'linnworks_status', name: 'Linnworks', src: 'https://www.linnworks.com/favicon.ico' },
  { key: 'shopify_status', name: 'Shopify', src: 'https://www.shopify.com/favicon.ico' },
  { key: 'square_status', name: 'Square', src: 'https://squareup.com/favicon.ico' },
  { key: 'loyverse_status', name: 'Loyverse', src: 'https://loyverse.com/favicon.ico' },
  { key: 'vinted_status', name: 'Vinted', src: 'https://www.vinted.co.uk/favicon.ico' },
  { key: 'depop_status', name: 'Depop', src: 'https://www.depop.com/favicon.ico' },
  { key: 'tiktok_shop_status', name: 'TikTok Shop', src: 'https://shop.tiktok.com/favicon.ico' },
] as const

function getYearPrefix() {
  return new Date().getFullYear().toString().slice(-2)
}

function luhnCheckDigit(input: string) {
  let sum = 0
  let shouldDouble = true

  for (let i = input.length - 1; i >= 0; i--) {
    let digit = Number(input[i])

    if (shouldDouble) {
      digit *= 2
      if (digit > 9) digit -= 9
    }

    sum += digit
    shouldDouble = !shouldDouble
  }

  return String((10 - (sum % 10)) % 10)
}

function isValidSku(sku: string) {
  if (!/^\d{10}$/.test(sku)) return false

  const body = sku.slice(0, -1)
  const checkDigit = sku.slice(-1)

  return luhnCheckDigit(body) === checkDigit
}

function extractTransferIdFromScan(value: string) {
  const cleaned = value.trim()
  const match = cleaned.match(/\/transfers\/([^/?#]+)/)

  if (match?.[1]) return match[1]

  return null
}

function randomSequenceNumber() {
  return Math.floor(Math.random() * 10000000)
}

function getSizeText(item: ScannedItem) {
  if (
    item.waist_in !== null &&
    item.waist_in !== undefined &&
    item.waist_in !== ''
  ) {
    return `W${item.waist_in}"`
  }

  if (item.tagged_size) return item.tagged_size

  return ''
}

function openLabelPreview(items: PreviewLabelItem[]) {
  window.localStorage.setItem('label_preview_items', JSON.stringify(items))
  window.open('/labels/preview', '_blank')
}

export default function SkuSearchPage() {
  const router = useRouter()
  const scanInputRef = useRef<HTMLInputElement | null>(null)
  const { staff } = useStaff()

  const [scanValue, setScanValue] = useState('')
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([])
  const [printQty, setPrintQty] = useState(10)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const selectedItems = useMemo(
    () => scannedItems.filter((item) => item.selected),
    [scannedItems]
  )

  const selectedCount = selectedItems.length

  const allSelected =
    scannedItems.length > 0 && scannedItems.every((item) => item.selected)

  const showTransferToShop =
    selectedCount > 0 &&
    selectedItems.some((item) => item.current_location !== 'SHOP-1')

  const showTransferToWarehouse =
    selectedCount > 0 &&
    selectedItems.some((item) => item.current_location !== 'WAREHOUSE')

  async function createItemFromSku(sku: string) {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return null
    }

    const now = new Date().toISOString()

    const { data, error } = await supabase
      .from('items')
      .insert({
        sku,
        status: 'working',
        stock_level: 1,
        location_status: 'unknown',
        current_location: null,
        current_bin: null,
        ebay_status: 'not_listed',
        linnworks_status: 'not_synced',
        shopify_status: 'not_listed',
        square_status: 'not_listed',
        loyverse_status: 'not_listed',
        vinted_status: 'not_listed',
        depop_status: 'not_listed',
        tiktok_shop_status: 'not_listed',
        last_saved_by: staff.id,
        updated_at: now,
      })
      .select('*')
      .single()

    if (error) {
      setMessage(error.message)
      return null
    }

    return data
  }

  async function handleScan() {
    const rawSku = scanValue.trim()

    if (!rawSku) return

    const transferId = extractTransferIdFromScan(rawSku)

    if (transferId) {
      setScanValue('')
      router.push(`/transfers/${transferId}`)
      return
    }

    setMessage('')

    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    if (!isValidSku(rawSku)) {
      setMessage(`Invalid SKU/check digit: ${rawSku}`)
      setScanValue('')
      return
    }

    const existingScanned = scannedItems.find((item) => item.sku === rawSku)

    if (existingScanned) {
      if (!existingScanned.exists) {
        const confirmed = window.confirm(
          `SKU ${rawSku} is not in the app yet. Create item now?`
        )

        if (!confirmed) {
          setMessage(`Already scanned: ${rawSku}`)
          setScanValue('')
          return
        }

        setBusy(true)
        const createdItem = await createItemFromSku(rawSku)
        setBusy(false)

        if (!createdItem) {
          setScanValue('')
          return
        }

        setScannedItems((prev) =>
          prev.map((item) =>
            item.sku === rawSku
              ? {
                  ...item,
                  id: createdItem.id,
                  exists: true,
                  selected: true,
                  stock_level: createdItem.stock_level ?? 1,
                  location_status: createdItem.location_status,
                  current_location: createdItem.current_location,
                  current_bin: createdItem.current_bin,
                  ebay_status: createdItem.ebay_status,
                  linnworks_status: createdItem.linnworks_status,
                  shopify_status: createdItem.shopify_status,
                  square_status: createdItem.square_status,
                  loyverse_status: createdItem.loyverse_status,
                  vinted_status: createdItem.vinted_status,
                  depop_status: createdItem.depop_status,
                  tiktok_shop_status: createdItem.tiktok_shop_status,
                }
              : item
          )
        )

        setMessage(`Created item ${rawSku} by ${staff.name}`)
        setScanValue('')
        return
      }

      setMessage(`Already scanned: ${rawSku}`)
      setScanValue('')
      return
    }

    setBusy(true)

    const { data, error } = await supabase
      .from('items')
      .select(`
        id,
        sku,
        brand,
        reporting_category,
        tagged_size,
        waist_in,
        condition,
        selling_price,
        stock_level,
        ai_title,
        basic_title,
        location_status,
        current_location,
        current_bin,
        ebay_status,
        linnworks_status,
        shopify_status,
        square_status,
        loyverse_status,
        vinted_status,
        depop_status,
        tiktok_shop_status,
        item_images (
          processed_url,
          original_url,
          image_order
        )
      `)
      .eq('sku', rawSku)
      .maybeSingle()

    setBusy(false)

    if (error) {
      setMessage(error.message)
      return
    }

    let itemData = data

    if (!itemData) {
      const confirmed = window.confirm(
        `SKU ${rawSku} is not in the app yet. Create item now?`
      )

      if (confirmed) {
        setBusy(true)
        const createdItem = await createItemFromSku(rawSku)
        setBusy(false)

        if (!createdItem) {
          setScanValue('')
          return
        }

        itemData = createdItem
        setMessage(`Created item ${rawSku} by ${staff.name}`)
      }
    }

    const images = (itemData?.item_images || []) as ItemImage[]

    const firstImageRecord =
      images
        .filter((img) => img.processed_url || img.original_url)
        .sort((a, b) => (a.image_order ?? 0) - (b.image_order ?? 0))[0] || null

    const firstImage =
      firstImageRecord?.processed_url || firstImageRecord?.original_url || null

    const newItem: ScannedItem = {
      id: itemData?.id || null,
      sku: rawSku,
      exists: !!itemData,
      selected: true,
      image_url: firstImage,
      ai_title: itemData?.ai_title || null,
      basic_title: itemData?.basic_title || null,
      brand: itemData?.brand || null,
      reporting_category: itemData?.reporting_category || null,
      tagged_size: itemData?.tagged_size || null,
      waist_in: itemData?.waist_in || null,
      condition: itemData?.condition || null,
      selling_price: itemData?.selling_price || null,
      stock_level: itemData?.stock_level ?? 1,
      location_status: itemData?.location_status || 'unknown',
      current_location: itemData?.current_location || null,
      current_bin: itemData?.current_bin || null,
      ebay_status: itemData?.ebay_status || 'not_listed',
      linnworks_status: itemData?.linnworks_status || 'not_synced',
      shopify_status: itemData?.shopify_status || 'not_listed',
      square_status: itemData?.square_status || 'not_listed',
      loyverse_status: itemData?.loyverse_status || 'not_listed',
      vinted_status: itemData?.vinted_status || 'not_listed',
      depop_status: itemData?.depop_status || 'not_listed',
      tiktok_shop_status: itemData?.tiktok_shop_status || 'not_listed',
    }

    setScannedItems((prev) => [newItem, ...prev])
    setScanValue('')

    setTimeout(() => scanInputRef.current?.focus(), 50)
  }

  function toggleSelectAll() {
    setScannedItems((prev) =>
      prev.map((item) => ({
        ...item,
        selected: !allSelected,
      }))
    )
  }

  function toggleItemSelected(sku: string) {
    setScannedItems((prev) =>
      prev.map((item) =>
        item.sku === sku ? { ...item, selected: !item.selected } : item
      )
    )
  }

  function clearScans() {
    setScannedItems([])
    setMessage('')
  }

  function openSelectedItem() {
    if (selectedCount !== 1) return

    const selected = selectedItems[0]

    if (!selected.id) {
      setMessage('This SKU does not exist in the app yet.')
      return
    }

    router.push(`/items/${selected.id}`)
  }

  async function moveSelected(to: 'warehouse' | 'shop') {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    if (selectedCount === 0) {
      setMessage('Select at least one item.')
      return
    }

    const existingItems = selectedItems.filter((item) => item.id)

    if (existingItems.length === 0) {
      setMessage('None of the selected SKUs exist in the app yet.')
      return
    }

    const fromLocation = to === 'warehouse' ? 'SHOP-1' : 'WAREHOUSE'
    const toLocation = to === 'warehouse' ? 'WAREHOUSE' : 'SHOP-1'
    const inTransitLocation =
      to === 'warehouse' ? 'IN-TRANSIT-TO-WAREHOUSE' : 'IN-TRANSIT-TO-SHOP'

    const confirmedTransfer = window.confirm(
      `Transfer stock OK?\n\n${existingItems.length} item(s) will be transferred to ${toLocation}.`
    )

    if (!confirmedTransfer) return

    const now = new Date().toISOString()

    setBusy(true)
    setMessage('Creating transfer...')

    const { data: transfer, error: transferError } = await supabase
      .from('stock_transfers')
      .insert({
        from_location: fromLocation,
        to_location: toLocation,
        status: 'sent',
        sent_at: now,
        created_by: staff.id,
      })
      .select('id, transfer_number')
      .single()

    if (transferError || !transfer) {
      setBusy(false)
      setMessage(transferError?.message || 'Could not create transfer.')
      return
    }

    const { error: transferItemsError } = await supabase
      .from('stock_transfer_items')
      .insert(
        existingItems.map((item) => ({
          transfer_id: transfer.id,
          item_id: item.id,
          sku: item.sku,
          status: 'in_transfer',
        }))
      )

    if (transferItemsError) {
      setBusy(false)
      setMessage(transferItemsError.message)
      return
    }

    const { error: itemUpdateError } = await supabase
      .from('items')
      .update({
        location_status: 'in_transfer',
        current_location: inTransitLocation,
        current_bin: inTransitLocation,
        last_saved_by: staff.id,
        updated_at: now,
      })
      .in(
        'id',
        existingItems.map((item) => item.id)
      )

    if (itemUpdateError) {
      setBusy(false)
      setMessage(itemUpdateError.message)
      return
    }

    setScannedItems((prev) =>
      prev.map((item) =>
        item.selected && item.id
          ? {
              ...item,
              location_status: 'in_transfer',
              current_location: inTransitLocation,
              current_bin: inTransitLocation,
              selected: false,
            }
          : item
      )
    )

    setBusy(false)

    const paddedTransferNumber = String(transfer.transfer_number).padStart(7, '0')

    setMessage(
      `Created transfer #${paddedTransferNumber} for ${existingItems.length} item(s) by ${staff.name}.`
    )

    const printManifest = window.confirm(
      `Transfer #${paddedTransferNumber} created.\n\nPrint manifest now?`
    )

    if (printManifest) {
      window.open(`/transfers/${transfer.id}/manifest`, '_blank')
    }
  }

  function reprintSelectedLabels() {
    if (selectedCount === 0) {
      setMessage('Select at least one label to reprint.')
      return
    }

    openLabelPreview(
      selectedItems.map((item) => ({
        sku: item.sku,
        sizeText: getSizeText(item),
        price: item.selling_price,
      }))
    )

    setMessage(`Opened preview for ${selectedItems.length} label(s).`)
  }

  async function printNextLabels() {
    const qty = Number(printQty)

    if (qty < 0 || qty > 100) {
      setMessage('Quantity must be 0–100.')
      return
    }

    if (qty === 0) {
      setMessage('Quantity is 0. Nothing to print.')
      return
    }

    setBusy(true)
    setMessage('Generating labels...')

    try {
      const yearPrefix = getYearPrefix()
      const skus: string[] = []

      const rowsToInsert: {
        sku: string
        year_prefix: string
        sequence_number: number
        check_digit: string
      }[] = []

      let attempts = 0

      while (skus.length < qty && attempts < qty * 100) {
        attempts++

        const sequenceNumber = randomSequenceNumber()
        const body = `${yearPrefix}${String(sequenceNumber).padStart(7, '0')}`
        const checkDigit = luhnCheckDigit(body)
        const sku = `${body}${checkDigit}`

        if (skus.includes(sku)) continue

        const { data: existingItem, error: itemCheckError } = await supabase
          .from('items')
          .select('sku')
          .eq('sku', sku)
          .maybeSingle()

        if (itemCheckError) {
          throw new Error(`Item SKU check failed: ${itemCheckError.message}`)
        }

        if (existingItem) continue

        const { data: existingGenerated, error: generatedCheckError } =
          await supabase
            .from('generated_skus')
            .select('sku')
            .eq('sku', sku)
            .maybeSingle()

        if (generatedCheckError) {
          throw new Error(
            `Generated SKU check failed: ${generatedCheckError.message}`
          )
        }

        if (existingGenerated) continue

        skus.push(sku)

        rowsToInsert.push({
          sku,
          year_prefix: yearPrefix,
          sequence_number: sequenceNumber,
          check_digit: checkDigit,
        })
      }

      if (skus.length !== qty) {
        throw new Error('Could not generate enough unique SKUs.')
      }

      const { error: insertError } = await supabase
        .from('generated_skus')
        .insert(rowsToInsert)

      if (insertError) {
        throw new Error(`Saving generated SKUs failed: ${insertError.message}`)
      }

      openLabelPreview(
        skus.map((sku) => ({
          sku,
          sizeText: '',
          price: null,
        }))
      )

      setMessage(`Opened preview for ${skus.length} new random SKU label(s).`)
    } catch (error: any) {
      setMessage(error.message || 'Print Next failed.')
    } finally {
      setBusy(false)
    }
  }

  function channelOpacity(status?: string | null) {
    if (!status || status === 'not_listed' || status === 'not_synced') {
      return 'opacity-25 grayscale'
    }

    if (status === 'listed' || status === 'synced' || status === 'active') {
      return 'opacity-100'
    }

    if (status === 'error') {
      return 'opacity-80 grayscale ring-1 ring-red-500'
    }

    if (status === 'queued') {
      return 'opacity-60 grayscale'
    }

    return 'opacity-40 grayscale'
  }

  return (
    <main className="min-h-screen bg-neutral-950 p-5 text-white">
      <div className="mb-5 flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">SKU Search</h1>

            <p className="text-sm text-neutral-400">
              Scan SKUs, preview labels, move location, and open items for editing.
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

          <AppNav current="sku" />
        </div>

        <div className="flex items-center gap-3">
          {message && (
            <span className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm">
              {message}
            </span>
          )}
        </div>
      </div>

      <section className="mb-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            ref={scanInputRef}
            value={scanValue}
            onChange={(e) => setScanValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleScan()
            }}
            placeholder={staff ? 'Scan SKU or transfer QR' : 'Go to staff PIN screen first'}
            disabled={busy || !staff}
            className="flex-1 rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-lg outline-none focus:border-white disabled:opacity-50"
            autoFocus
          />

          <button
            onClick={handleScan}
            disabled={busy || !staff}
            className="rounded-xl bg-white px-5 py-3 font-semibold text-black disabled:opacity-50"
          >
            Add Scan
          </button>
        </div>
      </section>

      <section className="mb-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              disabled={scannedItems.length === 0}
              className="h-5 w-5 rounded border-zinc-600 bg-zinc-950"
            />

            <div>
              <h2 className="text-lg font-semibold">Scanned Items</h2>

              <p className="text-sm text-neutral-400">
                {scannedItems.length} scanned / {selectedCount} selected
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {showTransferToWarehouse && (
              <button
                onClick={() => moveSelected('warehouse')}
                disabled={busy || !staff || selectedCount === 0}
                className="rounded-xl border border-neutral-700 px-4 py-2 text-sm disabled:opacity-40"
              >
                Transfer to Warehouse
              </button>
            )}

            {showTransferToShop && (
              <button
                onClick={() => moveSelected('shop')}
                disabled={busy || !staff || selectedCount === 0}
                className="rounded-xl border border-neutral-700 px-4 py-2 text-sm disabled:opacity-40"
              >
                Transfer to Shop
              </button>
            )}

            <button
              onClick={reprintSelectedLabels}
              disabled={selectedCount === 0}
              className="rounded-xl border border-neutral-700 px-4 py-2 text-sm disabled:opacity-40"
            >
              Reprint Label
            </button>

            <button
              onClick={openSelectedItem}
              disabled={selectedCount !== 1}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
            >
              Open / Edit
            </button>

            <button
              onClick={clearScans}
              disabled={scannedItems.length === 0}
              className="rounded-xl border border-neutral-700 px-4 py-2 text-sm disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {scannedItems.length === 0 && (
            <div className="rounded-2xl border border-dashed border-neutral-800 p-8 text-center text-neutral-500">
              No SKUs scanned yet.
            </div>
          )}

          {scannedItems.map((item) => (
            <div
              key={item.sku}
              className={`w-full rounded-2xl border bg-neutral-950 p-3 ${
                item.selected ? 'border-white' : 'border-neutral-800'
              }`}
            >
              <div className="flex gap-3">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={item.selected}
                    onChange={() => toggleItemSelected(item.sku)}
                    className="h-5 w-5 rounded border-zinc-600 bg-zinc-950"
                  />
                </div>

                <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-neutral-800">
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-neutral-500">
                      No image
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-neutral-500">
                        {item.sku}
                      </p>

                      <h3 className="truncate text-base font-semibold">
                        {item.ai_title || item.basic_title || 'Untitled item'}
                      </h3>

                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-neutral-400">
                        <span>{item.brand || 'No brand'}</span>
                        <span>·</span>
                        <span>{item.reporting_category || 'No category'}</span>
                        <span>·</span>
                        <span>{item.tagged_size || 'No size'}</span>
                        <span>·</span>
                        <span>{item.condition || 'No condition'}</span>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-neutral-900 px-2 py-1 text-neutral-300">
                          {item.current_location || 'No location'}
                        </span>

                        <span className="rounded-full bg-neutral-900 px-2 py-1 text-neutral-300">
                          {item.current_bin || 'No bin/rack'}
                        </span>

                        {typeof item.selling_price === 'number' && (
                          <span className="rounded-full bg-neutral-900 px-2 py-1 text-neutral-300">
                            £{item.selling_price.toFixed(2)}
                          </span>
                        )}

                        {!item.exists && (
                          <span className="rounded-full bg-yellow-500/20 px-2 py-1 text-yellow-300">
                            Not in app yet
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col gap-1 rounded-lg bg-neutral-900 p-1">
                      {[0, 2, 4, 6].map((start) => (
                        <div key={start} className="flex gap-1">
                          {CHANNEL_ICONS.slice(start, start + 2).map((icon) => (
                            <img
                              key={icon.name}
                              src={icon.src}
                              title={`${icon.name}: ${String(
                                item[icon.key as keyof ScannedItem] ||
                                  'not_listed'
                              )}`}
                              className={`h-4 w-4 rounded-sm ${channelOpacity(
                                item[
                                  icon.key as keyof ScannedItem
                                ] as string | null
                              )}`}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 text-lg font-semibold">
            Print Next Unused Labels
          </h2>

          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              max={100}
              value={printQty}
              onChange={(e) => setPrintQty(Number(e.target.value))}
              className="w-32 rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
            />

            <button
              onClick={printNextLabels}
              disabled={busy}
              className="rounded-xl bg-white px-4 py-2 font-semibold text-black disabled:opacity-50"
            >
              Preview / Print Next
            </button>
          </div>

          <p className="mt-2 text-sm text-neutral-400">
            Generates unused pseudo-random SKU barcode labels and opens the print preview page.
          </p>
        </div>
      </section>
    </main>
  )
}
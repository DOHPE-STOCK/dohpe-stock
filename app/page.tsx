'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
  barcode_number?: string | null
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
  sku_type?: 'single_use' | 'reusable' | string | null
  location_status?: string | null
  current_location?: string | null
  current_bin?: string | null
  stock_locations?: StockLocationChoice[]
  loan_status?: string | null
  loaned_by?: string | null
  loaned_by_name?: string | null
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

type ReusableSkuResult = {
  id: string
  sku: string
  barcode_number?: string | null
  sku_type?: string | null
  brand?: string | null
  reporting_category?: string | null
  basic_title?: string | null
  ai_title?: string | null
  final_title?: string | null
  selling_price?: number | null
  stock_level?: number | null
  current_location?: string | null
  current_bin?: string | null
}

type StockLocationChoice = {
  id: string
  item_id: string
  sku: string | null
  location_name: string
  bin_code: string
  stock_level: number
}

type LocationConfig = {
  name: string
  label: string | null
  is_active: boolean
  bin_mode: 'basic' | 'range' | null
  basic_bins: string[] | null
}

function configuredLocationRows(rows: LocationConfig[]) {
  const configured = rows.filter((row) => text(row.label) || /^LOCATION-\d+$/i.test(text(row.name)))
  return configured.length > 0 ? configured : rows
}

type TransferLineDraft = {
  item: ScannedItem
  quantity: number | ''
  sourceLocation: string
  sourceBin: string
  sourceChoices?: StockLocationChoice[]
  selectedSourceId?: string
}

type TransferModalState = {
  lines: TransferLineDraft[]
  sourceLocation: string
  destinationLocation: string
  destinationBin: string
  step: 'details' | 'confirm'
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

const WAREHOUSE_LOCATION = 'LOCATION-1'
const IN_TRANSIT_LOCATION = 'IN_TRANSIT'
const DEFAULT_BIN = 'Default'

async function upsertStockLocationViaApi(params: {
  itemId: string
  sku: string
  locationName: string
  binCode: string
  stockLevel: number
  source: string
}) {
  const response = await fetch('/api/items/stock-location', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      item_id: params.itemId,
      sku: params.sku,
      location_name: params.locationName,
      bin_code: params.binCode,
      stock_level: params.stockLevel,
      source: params.source,
    }),
  })

  const result = await response.json()

  if (!response.ok || result?.ok === false) {
    throw new Error(result?.error || 'Stock location update failed.')
  }

  return result.row as StockLocationChoice
}

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

function cleanReusableSku(value: string) {
  return value.trim().toUpperCase()
}

function normaliseIdentifier(value: string) {
  return value.trim().replace(/\s+/g, '').toUpperCase()
}

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function escapePostgrestOrValue(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')
    .replaceAll(',', '\\,')
}

function canonicalLocationKey(value: string | null | undefined) {
  return String(value || '').trim().toUpperCase().replace(/[\s_]+/g, '-')
}

function getReusableTitle(item: ReusableSkuResult) {
  return item.final_title || item.ai_title || item.basic_title || item.sku
}

function defaultDestinationBin(location: string) {
  const value = canonicalLocationKey(location)
  if (value === WAREHOUSE_LOCATION) return DEFAULT_BIN
  return 'FLOOR'
}

function normaliseLocationForSave(location: string | null | undefined) {
  return canonicalLocationKey(location) || WAREHOUSE_LOCATION
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
  const [reusableSearch, setReusableSearch] = useState('')
  const [reusableResults, setReusableResults] = useState<ReusableSkuResult[]>([])
  const [reusableSuggestionsLoaded, setReusableSuggestionsLoaded] = useState(false)
  const [reusableBusy, setReusableBusy] = useState(false)
  const [reusableMessage, setReusableMessage] = useState('')
  const [reusablePrintOpen, setReusablePrintOpen] = useState(false)
  const [reusablePrintQty, setReusablePrintQty] = useState(1)
  const [reusablePrintItem, setReusablePrintItem] = useState<ReusableSkuResult | null>(null)
  const [locationConfigs, setLocationConfigs] = useState<LocationConfig[]>([])
  const [transferModal, setTransferModal] = useState<TransferModalState | null>(null)

  useEffect(() => {
    fetchLocationConfigs()
  }, [])

  async function fetchLocationConfigs() {
    const { data, error } = await supabase
      .from('locations')
      .select('name, label, is_active, bin_mode, basic_bins')
      .eq('is_active', true)
      .order('name', { ascending: true })

    if (!error) {
      setLocationConfigs(configuredLocationRows((data || []) as LocationConfig[]))
    }
  }

  function getLocationConfig(location: string | null | undefined) {
    const key = canonicalLocationKey(location)
    return locationConfigs.find((config) => {
      return (
        canonicalLocationKey(config.name) === key ||
        canonicalLocationKey(config.label) === key
      )
    })
  }

  function isInTransitLocation(location: string | null | undefined) {
    const key = canonicalLocationKey(location)
    return (
      key === 'IN-TRANSIT' ||
      key === 'IN-TRANSIT-TO-SHOP' ||
      key === 'IN-TRANSIT-TO-WAREHOUSE'
    )
  }

  function resolveLocationName(location: string | null | undefined) {
    if (isInTransitLocation(location)) return IN_TRANSIT_LOCATION
    const key = canonicalLocationKey(location)
    const config = getLocationConfig(location)
    return text(config?.name) || key || WAREHOUSE_LOCATION
  }

  function displayLocation(location: string | null | undefined) {
    if (isInTransitLocation(location)) return 'IN TRANSIT'
    const name = resolveLocationName(location)
    const config = getLocationConfig(name)
    return text(config?.label) || name || '-'
  }

  function activeLocationOptions() {
    if (locationConfigs.length > 0) return locationConfigs

    return [
      {
        name: WAREHOUSE_LOCATION,
        label: 'WAREHOUSE',
        is_active: true,
        bin_mode: 'range',
        basic_bins: [DEFAULT_BIN],
      } as LocationConfig,
    ]
  }

  function getBasicBins(location: string) {
    const config = getLocationConfig(location)
    if (config?.bin_mode !== 'basic') return []

    return (config.basic_bins || [])
      .map((bin) => text(bin).toUpperCase())
      .filter(Boolean)
      .slice(0, 3)
  }

  function aggregateStockRowsForDisplay(rows: StockLocationChoice[]) {
    const grouped = new Map<string, StockLocationChoice>()

    rows.forEach((row) => {
      const location = resolveLocationName(row.location_name)
      const bin = text(row.bin_code) || DEFAULT_BIN
      const key = `${canonicalLocationKey(location)}::${bin.toUpperCase()}`
      const existing = grouped.get(key)

      if (existing) {
        grouped.set(key, {
          ...existing,
          stock_level: Number(existing.stock_level || 0) + Number(row.stock_level || 0),
        })
        return
      }

      grouped.set(key, {
        ...row,
        location_name: location,
        bin_code: bin,
        stock_level: Number(row.stock_level || 0),
      })
    })

    return Array.from(grouped.values())
  }

  async function getInTransitStockRowsForSku(sku: string, itemId?: string | null) {
    const cleanSku = text(sku).toUpperCase()
    if (!cleanSku) return []

    let query = supabase
      .from('stock_transfer_items')
      .select('id, item_id, sku, source_bin, status, stock_transfers!inner(from_location, status)')
      .eq('sku', cleanSku)
      .eq('status', 'in_transfer')
      .eq('stock_transfers.status', 'sent')

    if (itemId) {
      query = query.eq('item_id', itemId)
    }

    const { data, error } = await query
    if (error) return []

    const sourceCounts = new Map<string, StockLocationChoice>()
    let total = 0

    ;((data || []) as any[]).forEach((row) => {
      const transfer = Array.isArray(row.stock_transfers)
        ? row.stock_transfers[0]
        : row.stock_transfers
      const sourceLocation = resolveLocationName(transfer?.from_location || WAREHOUSE_LOCATION)
      const sourceBin = text(row.source_bin) || DEFAULT_BIN
      const key = `${sourceLocation}::${sourceBin.toUpperCase()}`
      const existing = sourceCounts.get(key)
      total += 1

      sourceCounts.set(key, {
        id: `in-transit-source-${key}`,
        item_id: text(row.item_id),
        sku: cleanSku,
        location_name: sourceLocation,
        bin_code: sourceBin,
        stock_level: Number(existing?.stock_level || 0) - 1,
      })
    })

    const rows = Array.from(sourceCounts.values())

    if (total > 0) {
      rows.push({
        id: `in-transit-${cleanSku}`,
        item_id: itemId || '',
        sku: cleanSku,
        location_name: IN_TRANSIT_LOCATION,
        bin_code: 'Pending Transfer',
        stock_level: total,
      })
    }

    return rows
  }

  const selectedItems = useMemo(
    () => scannedItems.filter((item) => item.selected),
    [scannedItems]
  )

  const exactReusableMatch = useMemo(() => {
    const clean = cleanReusableSku(reusableSearch)

    if (!clean) return null

    return (
      reusableResults.find((item) => item.sku.toUpperCase() === clean || item.barcode_number === clean) ||
      null
    )
  }, [reusableResults, reusableSearch])

  const reusableDropdownMatches = useMemo(() => {
    const clean = reusableSearch.trim().toLowerCase()

    if (!clean) return []

    return reusableResults
      .filter((item) => {
        const haystack = [
          item.sku,
          item.barcode_number,
          item.brand,
          item.reporting_category,
          item.basic_title,
          item.ai_title,
          item.final_title,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()

        return haystack.includes(clean)
      })
      .slice(0, 8)
  }, [reusableResults, reusableSearch])

  const selectedCount = selectedItems.length

  const selectedLoanItems = selectedItems.filter(
    (item) => item.loan_status === 'on_loan'
  )

  const selectedLoanCount = selectedLoanItems.length
  const hasSelectedLoanItems = selectedLoanCount > 0
  const hasMixedLoanSelection =
    selectedLoanCount > 0 && selectedLoanCount < selectedCount

  const allSelected =
    scannedItems.length > 0 && scannedItems.every((item) => item.selected)

  const canTransferStock = selectedCount > 0 && !hasSelectedLoanItems

  async function getStaffName(staffId?: string | null) {
    if (!staffId) return null

    const { data } = await supabase
      .from('staff_users')
      .select('name')
      .eq('id', staffId)
      .maybeSingle()

    return data?.name || null
  }

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
        sku_type: 'single_use',
        location_status: 'stored',
        current_location: WAREHOUSE_LOCATION,
        current_bin: 'Default',
        loan_status: 'not_on_loan',
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

    try {
      await upsertStockLocationViaApi({
        itemId: data.id,
        sku: data.sku,
        locationName: WAREHOUSE_LOCATION,
        binCode: DEFAULT_BIN,
        stockLevel: 1,
        source: 'sku_search_create',
      })
    } catch (error: any) {
      setMessage(`Created item, but stock-location row failed: ${error.message}`)
    }

    return data
  }

  async function getStockRowsForItem(itemData: any, sku: string) {
    const rows = new Map<string, StockLocationChoice>()

    if (itemData?.id) {
      const { data, error } = await supabase
        .from('item_stock_locations')
        .select('id, item_id, sku, location_name, bin_code, stock_level')
        .eq('item_id', itemData.id)

      if (error) throw new Error(error.message)

      ;((data || []) as StockLocationChoice[]).forEach((row) => rows.set(row.id, row))
    }

    const cleanSku = text(sku).toUpperCase()

    if (cleanSku) {
      const { data, error } = await supabase
        .from('item_stock_locations')
        .select('id, item_id, sku, location_name, bin_code, stock_level')
        .eq('sku', cleanSku)

      if (error) throw new Error(error.message)

      ;((data || []) as StockLocationChoice[]).forEach((row) => rows.set(row.id, row))
    }

    const inTransitRows = await getInTransitStockRowsForSku(sku, itemData?.id)

    return aggregateStockRowsForDisplay([...Array.from(rows.values()), ...inTransitRows]).sort((a, b) => {
      const locationCompare = displayLocation(a.location_name).localeCompare(displayLocation(b.location_name))
      if (locationCompare !== 0) return locationCompare
      return text(a.bin_code).localeCompare(text(b.bin_code))
    })
  }

  async function ensurePrimaryStockLocationRow(itemData: any, sku: string) {
    if (!itemData?.id) return []

    const existingRows = await getStockRowsForItem(itemData, sku)
    return existingRows
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

    const isTenDigitBarcode = /^\d{10}$/.test(rawSku)

    if (isTenDigitBarcode && !isValidSku(rawSku)) {
      setMessage(`Invalid SKU/check digit: ${rawSku}`)
      setScanValue('')
      return
    }

    setBusy(true)

    const safeLookup = escapePostgrestOrValue(rawSku)

    const { data, error } = await supabase
      .from('items')
      .select(`
        id,
        sku,
        barcode_number,
        brand,
        reporting_category,
        tagged_size,
        waist_in,
        condition,
        selling_price,
        stock_level,
        sku_type,
        ai_title,
        basic_title,
        location_status,
        current_location,
        current_bin,
        loan_status,
        loaned_by,
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
      const { data: identifierData, error: identifierError } = await supabase
        .from('item_identifiers')
        .select('item_id')
        .eq('identifier_value_normalized', normaliseIdentifier(rawSku))
        .eq('is_active', true)
        .maybeSingle()

      if (identifierError) {
        setMessage(identifierError.message)
        return
      }

      if (identifierData?.item_id) {
        const { data: identifierItem, error: identifierItemError } = await supabase
          .from('items')
          .select(`
            id,
            sku,
            barcode_number,
            brand,
            reporting_category,
            tagged_size,
            waist_in,
            condition,
            selling_price,
            stock_level,
            sku_type,
            ai_title,
            basic_title,
            location_status,
            current_location,
            current_bin,
            loan_status,
            loaned_by,
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
          .eq('id', identifierData.item_id)
          .maybeSingle()

        if (identifierItemError) {
          setMessage(identifierItemError.message)
          return
        }

        itemData = identifierItem
      }
    }

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

    const loanedByName =
      itemData?.loan_status === 'on_loan'
        ? await getStaffName(itemData?.loaned_by)
        : null

    const images = (itemData?.item_images || []) as ItemImage[]

    const firstImageRecord =
      images
        .filter((img) => img.processed_url || img.original_url)
        .sort((a, b) => (a.image_order ?? 0) - (b.image_order ?? 0))[0] || null

    const firstImage =
      firstImageRecord?.processed_url || firstImageRecord?.original_url || null

    const stockLocations = itemData ? await ensurePrimaryStockLocationRow(itemData, itemData.sku || rawSku) : []

    const newItem: ScannedItem = {
      id: itemData?.id || null,
      sku: itemData?.sku || rawSku,
      barcode_number: itemData?.barcode_number || null,
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
      sku_type: itemData?.sku_type || 'single_use',
      location_status: itemData?.location_status || 'unknown',
      current_location: resolveLocationName(itemData?.current_location || null),
      current_bin: itemData?.current_bin || null,
      stock_locations: stockLocations,
      loan_status: itemData?.loan_status || 'not_on_loan',
      loaned_by: itemData?.loaned_by || null,
      loaned_by_name: loanedByName,
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

  function openLoanReturn() {
    if (selectedLoanCount === 0) {
      setMessage('Select an item that is currently on loan.')
      return
    }

    window.localStorage.setItem(
      'loan_return_skus',
      JSON.stringify(selectedLoanItems.map((item) => item.sku))
    )

    router.push('/scanner/loan')
  }

  async function getReusableStockChoices(item: ScannedItem) {
    const rows = new Map<string, StockLocationChoice>()

    if (item.id) {
      const { data, error } = await supabase
        .from('item_stock_locations')
        .select('id, item_id, sku, location_name, bin_code, stock_level')
        .eq('item_id', item.id)
        .gt('stock_level', 0)
        .order('location_name', { ascending: true })

      if (error) throw new Error(error.message)

      ;((data || []) as StockLocationChoice[]).forEach((row) => {
        rows.set(row.id, row)
      })
    }

    const sku = text(item.sku).toUpperCase()

    if (sku) {
      const { data, error } = await supabase
        .from('item_stock_locations')
        .select('id, item_id, sku, location_name, bin_code, stock_level')
        .eq('sku', sku)
        .gt('stock_level', 0)
        .order('location_name', { ascending: true })

      if (error) throw new Error(error.message)

      ;((data || []) as StockLocationChoice[]).forEach((row) => {
        rows.set(row.id, row)
      })
    }

    const inTransitRows = await getInTransitStockRowsForSku(sku, item.id)
    const foundRows = aggregateStockRowsForDisplay([...Array.from(rows.values()), ...inTransitRows])
      .filter((row) => !isInTransitLocation(row.location_name))
      .filter((row) => Number(row.stock_level || 0) > 0)
      .sort((a, b) => {
      const locationCompare = displayLocation(a.location_name).localeCompare(displayLocation(b.location_name))
      if (locationCompare !== 0) return locationCompare
      return text(a.bin_code).localeCompare(text(b.bin_code))
      })

    if (foundRows.length > 0) return foundRows

    const fallbackStock = Number(item.stock_level || 0)
    if (fallbackStock > 0 && item.id) {
      return []
    }

    return []
  }

  async function openTransferModal() {
    setMessage('')

    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    if (hasSelectedLoanItems) {
      setMessage('One or more selected items are on loan. Return them before transferring.')
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

    const transferLines: {
      item: ScannedItem
      quantity: number | ''
      sourceLocation: string
      sourceBin: string
      sourceChoices?: StockLocationChoice[]
      selectedSourceId?: string
    }[] = []

    setBusy(true)
    setMessage('Preparing transfer...')

    try {
      for (const item of existingItems) {
        const choices = await getReusableStockChoices(item)
        const choice = choices[0]

        if (choice) {
          transferLines.push({
            item,
            quantity: 1,
            sourceLocation: choice.location_name,
            sourceBin: choice.bin_code || DEFAULT_BIN,
            sourceChoices: choices,
            selectedSourceId: choice.id,
          })
        } else {
          transferLines.push({
            item,
            quantity: 1,
            sourceLocation: resolveLocationName(item.current_location),
            sourceBin: item.current_bin || DEFAULT_BIN,
          })
        }
      }
    } catch (error: any) {
      setBusy(false)
      setMessage(error.message || 'Could not prepare transfer.')
      return
    }

    setBusy(false)
    setMessage('')

    const sourceKeys = new Set(
      transferLines.map((line) => canonicalLocationKey(resolveLocationName(line.sourceLocation)))
    )
    const availableDestinations = activeLocationOptions().filter(
      (location) => !sourceKeys.has(canonicalLocationKey(resolveLocationName(location.name)))
    )
    const defaultDestination =
      availableDestinations.find((location) => location.bin_mode === 'basic') ||
      availableDestinations[0] ||
      activeLocationOptions()[0]
    const destinationLocation = defaultDestination?.name || WAREHOUSE_LOCATION
    const bins = getBasicBins(destinationLocation)

    setTransferModal({
      lines: transferLines,
      sourceLocation: transferLines[0]?.sourceLocation || WAREHOUSE_LOCATION,
      destinationLocation,
      destinationBin: bins[0] || defaultDestinationBin(destinationLocation),
      step: 'details',
    })
  }

  function updateTransferLine(index: number, updates: Partial<TransferLineDraft>) {
    setTransferModal((current) => {
      if (!current) return current

      const lines = current.lines.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...updates } : line
      )

      return { ...current, lines }
    })
  }

  function selectTransferSource(index: number, choice: StockLocationChoice) {
    setTransferModal((current) => {
      if (!current) return current

      const lines = current.lines.map((line, lineIndex) =>
        lineIndex === index
          ? {
              ...line,
              selectedSourceId: choice.id,
              sourceLocation: choice.location_name,
              sourceBin: choice.bin_code || DEFAULT_BIN,
              quantity: 1,
            }
          : line
      )
      const sourceKeys = new Set(
        lines.map((line) => canonicalLocationKey(resolveLocationName(line.sourceLocation)))
      )
      const destinationStillAllowed = !sourceKeys.has(
        canonicalLocationKey(resolveLocationName(current.destinationLocation))
      )

      if (destinationStillAllowed) return { ...current, lines }

      const nextDestination =
        activeLocationOptions().find(
          (location) => !sourceKeys.has(canonicalLocationKey(resolveLocationName(location.name)))
        ) || activeLocationOptions()[0]
      const destinationLocation = nextDestination?.name || WAREHOUSE_LOCATION
      const bins = getBasicBins(destinationLocation)

      return {
        ...current,
        lines,
        destinationLocation,
        destinationBin: bins[0] || defaultDestinationBin(destinationLocation),
      }
    })
  }

  function selectTransferDestination(location: string) {
    const bins = getBasicBins(location)

    setTransferModal((current) =>
      current
        ? {
            ...current,
            destinationLocation: location,
            destinationBin: bins[0] || defaultDestinationBin(location),
          }
        : current
    )
  }

  function transferDestinationOptions(modal: TransferModalState) {
    const sourceKeys = new Set(
      modal.lines.map((line) => canonicalLocationKey(resolveLocationName(line.sourceLocation)))
    )

    return activeLocationOptions().filter(
      (location) => !sourceKeys.has(canonicalLocationKey(resolveLocationName(location.name)))
    )
  }

  async function submitTransferModal() {
    if (!transferModal || !staff) return

    const transferLines = transferModal.lines

    const sourceLocations = Array.from(
      new Set(transferLines.map((line) => canonicalLocationKey(line.sourceLocation)))
    )

    if (sourceLocations.length !== 1) {
      setMessage('Selected stock comes from more than one location. Create one transfer per source location.')
      return
    }

    for (const line of transferLines) {
      const sourceChoice = line.sourceChoices?.find((choice) => choice.id === line.selectedSourceId)

      const quantity = Number(line.quantity || 0)

      if (sourceChoice && (quantity < 1 || quantity > Number(sourceChoice.stock_level || 0))) {
        setMessage(`${line.item.sku} quantity must be between 1 and ${sourceChoice.stock_level}.`)
        return
      }
    }

    const fromLocation = transferLines[0].sourceLocation
    const toLocation = transferModal.destinationLocation
    const inTransitLocation =
      canonicalLocationKey(toLocation) === WAREHOUSE_LOCATION ? 'IN-TRANSIT-TO-WAREHOUSE' : 'IN-TRANSIT-TO-SHOP'
    const totalQuantity = transferLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0)
    const singleUseTransferLines = transferLines.filter(
      (line) => !line.sourceChoices || line.sourceChoices.length === 0
    )

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
        transferLines.flatMap((line) =>
          Array.from({ length: Number(line.quantity || 0) }, () => ({
            transfer_id: transfer.id,
            item_id: line.item.id,
            sku: line.item.sku,
            source_bin: line.sourceBin,
            status: 'in_transfer',
          }))
        )
      )

    if (transferItemsError) {
      setBusy(false)
      setMessage(transferItemsError.message)
      return
    }

    const singleUseTransferIds = singleUseTransferLines
      .map((line) => line.item.id)
      .filter(Boolean)

    if (singleUseTransferIds.length > 0) {
      const { error: itemUpdateError } = await supabase
        .from('items')
        .update({
          location_status: 'in_transfer',
          current_location: inTransitLocation,
          current_bin: inTransitLocation,
          last_saved_by: staff.id,
          updated_at: now,
        })
        .in('id', singleUseTransferIds)

      if (itemUpdateError) {
        setBusy(false)
        setMessage(itemUpdateError.message)
        return
      }
    }

    setScannedItems((prev) =>
      prev.map((item) =>
        item.selected && item.id
          ? {
              ...item,
              location_status:
                transferLines.some((line) => line.item.id === item.id && line.sourceChoices?.length)
                  ? item.location_status
                  : 'in_transfer',
              current_location:
                transferLines.some((line) => line.item.id === item.id && line.sourceChoices?.length)
                  ? item.current_location
                  : inTransitLocation,
              current_bin:
                transferLines.some((line) => line.item.id === item.id && line.sourceChoices?.length)
                  ? item.current_bin
                  : inTransitLocation,
              selected: false,
            }
          : item
      )
    )

    setBusy(false)
    setTransferModal(null)

    const paddedTransferNumber = String(transfer.transfer_number).padStart(7, '0')

    setMessage(
      `Created transfer #${paddedTransferNumber} for ${totalQuantity} unit(s) by ${staff.name}.`
    )
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

      setMessage(`Opened preview for ${skus.length} new single-use SKU label(s).`)
    } catch (error: any) {
      setMessage(error.message || 'Print Next failed.')
    } finally {
      setBusy(false)
    }
  }

  async function generateReusableBarcodeNumber() {
    const yearPrefix = getYearPrefix()
    let attempts = 0

    while (attempts < 1000) {
      attempts++

      const sequenceNumber = randomSequenceNumber()
      const body = `${yearPrefix}${String(sequenceNumber).padStart(7, '0')}`
      const checkDigit = luhnCheckDigit(body)
      const barcodeNumber = `${body}${checkDigit}`

      const { data: existingItemBySku, error: itemSkuError } = await supabase
        .from('items')
        .select('id')
        .eq('sku', barcodeNumber)
        .maybeSingle()

      if (itemSkuError) {
        throw new Error(`Item SKU check failed: ${itemSkuError.message}`)
      }

      if (existingItemBySku) continue

      const { data: existingItemByBarcode, error: itemBarcodeError } = await supabase
        .from('items')
        .select('id')
        .eq('barcode_number', barcodeNumber)
        .maybeSingle()

      if (itemBarcodeError) {
        throw new Error(`Item barcode check failed: ${itemBarcodeError.message}`)
      }

      if (existingItemByBarcode) continue

      const { data: existingGenerated, error: generatedCheckError } =
        await supabase
          .from('generated_skus')
          .select('sku')
          .eq('sku', barcodeNumber)
          .maybeSingle()

      if (generatedCheckError) {
        throw new Error(
          `Generated SKU check failed: ${generatedCheckError.message}`
        )
      }

      if (existingGenerated) continue

      const { error: insertGeneratedError } = await supabase
        .from('generated_skus')
        .insert({
          sku: barcodeNumber,
          year_prefix: yearPrefix,
          sequence_number: sequenceNumber,
          check_digit: checkDigit,
        })

      if (insertGeneratedError) {
        throw new Error(`Saving reusable barcode failed: ${insertGeneratedError.message}`)
      }

      return barcodeNumber
    }

    throw new Error('Could not generate a reusable barcode number.')
  }

  async function loadReusableSkuSuggestions() {
    if (reusableSuggestionsLoaded || reusableBusy) return

    setReusableBusy(true)
    setReusableMessage('')

    try {
      const { data, error } = await supabase
        .from('items')
        .select(`
          id,
          sku,
          barcode_number,
          sku_type,
          brand,
          reporting_category,
          basic_title,
          ai_title,
          final_title,
          selling_price,
          stock_level,
          current_location,
          current_bin
        `)
        .eq('sku_type', 'reusable')
        .order('sku', { ascending: true })
        .limit(300)

      if (error) throw new Error(error.message)

      setReusableResults((data || []) as ReusableSkuResult[])
      setReusableSuggestionsLoaded(true)
    } catch (error: any) {
      setReusableMessage(error.message || 'Could not load reusable SKU suggestions.')
    } finally {
      setReusableBusy(false)
    }
  }

  async function findReusableSku() {
    const clean = reusableSearch.trim()

    if (!clean) {
      setReusableMessage('Enter a reusable SKU, brand, or title first.')
      return
    }

    setReusableBusy(true)
    setReusableMessage('Finding reusable SKU...')

    try {
      const sku = cleanReusableSku(clean)
      const safe = escapePostgrestOrValue(clean)

      const { data, error } = await supabase
        .from('items')
        .select(`
          id,
          sku,
          barcode_number,
          sku_type,
          brand,
          reporting_category,
          basic_title,
          ai_title,
          final_title,
          selling_price,
          stock_level,
          current_location,
          current_bin
        `)
        .eq('sku_type', 'reusable')
        .or(
          `sku.eq.${sku},barcode_number.eq.${sku},sku.ilike.%${safe}%,barcode_number.ilike.%${safe}%,brand.ilike.%${safe}%,basic_title.ilike.%${safe}%,ai_title.ilike.%${safe}%,final_title.ilike.%${safe}%`
        )
        .order('sku', { ascending: true })
        .limit(8)

      if (error) throw new Error(error.message)

      const rows = (data || []) as ReusableSkuResult[]
      setReusableResults(rows)
      setReusableSuggestionsLoaded(true)

      if (rows.length === 0) {
        setReusableMessage('No reusable SKU found. Use Create New if this should be a repeat-stock SKU.')
        return
      }

      const exact = rows.find((item) => item.sku.toUpperCase() === sku || item.barcode_number === sku)

      if (exact) {
        setReusableMessage(`Found reusable SKU ${exact.sku}. Use Edit or Print.`)
        return
      }

      setReusableMessage(`Found ${rows.length} matching reusable SKU(s).`)
    } catch (error: any) {
      setReusableMessage(error.message || 'Could not find reusable SKU.')
    } finally {
      setReusableBusy(false)
    }
  }

  async function createReusableSku() {
    if (!staff) {
      setReusableMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    const sku = cleanReusableSku(reusableSearch)

    if (!sku) {
      setReusableMessage('Enter a reusable SKU first.')
      return
    }

    if (exactReusableMatch) {
      setReusableMessage('This reusable SKU already exists. Use Edit or Print.')
      return
    }

    const confirmed = window.confirm(
      `Create reusable SKU ${sku}?\n\nThis creates a repeat-stock product line, not a one-off single-use item.`
    )

    if (!confirmed) return

    const now = new Date().toISOString()

    setReusableBusy(true)
    setReusableMessage('Creating reusable SKU...')

    try {
      const { data: existing, error: existingError } = await supabase
        .from('items')
        .select('id, sku, barcode_number, sku_type')
        .eq('sku', sku)
        .maybeSingle()

      if (existingError) throw new Error(existingError.message)

      if (existing) {
        setReusableMessage(
          existing.sku_type === 'reusable'
            ? 'Reusable SKU already exists. Use Find, Edit, or Print.'
            : 'That SKU already exists as a single-use/item SKU. Choose a different reusable SKU.'
        )
        return
      }

      const barcodeNumber = await generateReusableBarcodeNumber()

      const { data, error } = await supabase
        .from('items')
        .insert({
          sku,
          barcode_number: barcodeNumber,
          sku_type: 'reusable',
          status: 'working',
          stock_level: 0,
          shop_floor_stock: 0,
          warehouse_stock: 0,
          location_status: 'stored',
          current_location: WAREHOUSE_LOCATION,
          current_bin: 'Default',
          loan_status: 'not_on_loan',
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
        .select('id')
        .single()

      if (error) throw new Error(error.message)

      setReusableSearch('')
      setReusableResults([])
      setReusableSuggestionsLoaded(false)
      setReusableMessage(`Created reusable SKU ${sku} with barcode ${barcodeNumber}. Opening edit page...`)
      router.push(`/items/${data.id}`)
    } catch (error: any) {
      setReusableMessage(error.message || 'Could not create reusable SKU.')
    } finally {
      setReusableBusy(false)
    }
  }

  function editReusableSku(item: ReusableSkuResult) {
    router.push(`/items/${item.id}`)
  }

  function openReusablePrintQuantity(item?: ReusableSkuResult | null) {
    const target = item || exactReusableMatch

    if (!target) {
      setReusableMessage('Find or select an existing reusable SKU before printing.')
      return
    }

    setReusablePrintItem(target)
    setReusablePrintQty(1)
    setReusablePrintOpen(true)
  }

  function printReusableSkuQuantity() {
    if (!reusablePrintItem) return

    const qty = Math.max(1, Math.min(100, Number(reusablePrintQty) || 1))

    openLabelPreview(
      Array.from({ length: qty }, () => ({
        sku: reusablePrintItem.barcode_number || reusablePrintItem.sku,
        sizeText: reusablePrintItem.sku,
        price: reusablePrintItem.selling_price,
      }))
    )

    setReusablePrintOpen(false)
    setReusableMessage(`Opened ${qty} label(s) for ${reusablePrintItem.sku}.`)
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
      <div className="app-header mb-5 flex flex-wrap items-start justify-between gap-4 rounded-3xl bg-black p-4 text-white shadow-2xl sm:p-5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-normal">SKU Search</h1>

            <p className="text-sm text-neutral-300">
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
            {hasMixedLoanSelection && (
              <div className="w-full rounded-xl border border-orange-700 bg-orange-950 p-3 text-sm font-bold text-orange-200">
                {selectedLoanCount} of {selectedCount} selected item(s) are on loan.
                Return loan items before transferring stock.
              </div>
            )}

            {selectedLoanCount > 0 && (
              <button
                onClick={openLoanReturn}
                className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-black text-white hover:bg-orange-500"
              >
                Return Loan
              </button>
            )}

            {canTransferStock && (
              <button
                onClick={openTransferModal}
                disabled={busy || !staff || selectedCount === 0}
                className="rounded-xl border border-neutral-700 px-4 py-2 text-sm font-black text-white disabled:opacity-40"
              >
                Transfer Stock
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

          {scannedItems.map((item) => {
            const isOnLoan = item.loan_status === 'on_loan'
            const visibleStockRows = (item.stock_locations || []).filter(
              (row) => Number(row.stock_level || 0) > 0
            )

            return (
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
                          {isOnLoan ? (
                            <>
                              <span className="rounded-full bg-orange-950 px-2 py-1 font-black text-orange-300">
                                ON LOAN
                              </span>

                              <span className="rounded-full bg-neutral-900 px-2 py-1 text-neutral-300">
                                Loaned by: {item.loaned_by_name || 'Unknown'}
                              </span>
                            </>
                          ) : visibleStockRows.length === 0 ? (
                            <>
                              <span className="rounded-full bg-neutral-900 px-2 py-1 text-neutral-300">
                                {displayLocation(item.current_location)}
                              </span>

                              <span className="rounded-full bg-neutral-900 px-2 py-1 text-neutral-300">
                                {item.current_bin || 'No bin/rack'}
                              </span>
                            </>
                          ) : (
                            null
                          )}

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

                        {visibleStockRows.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            {visibleStockRows.map((row) => (
                                <span
                                  key={row.id}
                                  className="rounded-full bg-emerald-950 px-2 py-1 font-bold text-emerald-200"
                                >
                                  {displayLocation(row.location_name)} / {row.bin_code || DEFAULT_BIN}: {row.stock_level}
                                </span>
                              ))}
                          </div>
                        )}
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
            )
          })}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 text-lg font-semibold">
            Print Next Single-Use Labels
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
            Generates unused pseudo-random single-use SKU barcode labels and opens the print preview page.
          </p>
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 text-lg font-semibold">
            Create / Find / Print Reusable SKU
          </h2>

          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <input
                value={reusableSearch}
                onFocus={loadReusableSkuSuggestions}
                onChange={(e) => setReusableSearch(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (exactReusableMatch) {
                      editReusableSku(exactReusableMatch)
                    } else {
                      findReusableSku()
                    }
                  }
                }}
                placeholder="Reusable SKU, brand, or title"
                disabled={!staff}
                autoComplete="new-password"
              name="dohpe-reusable-sku-no-autofill"
              id="dohpe-reusable-sku-no-autofill"
              className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-white disabled:opacity-50"
              />

              <datalist id="reusable-sku-suggestions">
                {reusableResults.map((item) => (
                  <option
                    key={item.id}
                    value={item.sku}
                    label={[
                      getReusableTitle(item),
                      item.barcode_number ? `Barcode ${item.barcode_number}` : '',
                      item.brand,
                      item.reporting_category,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                ))}
              </datalist>
            </div>

            <button
              type="button"
              onClick={() => {
                if (exactReusableMatch) {
                  editReusableSku(exactReusableMatch)
                  return
                }

                createReusableSku()
              }}
              disabled={reusableBusy || !staff || !reusableSearch.trim()}
              className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              {exactReusableMatch ? 'Edit' : 'Create'}
            </button>

            <button
              type="button"
              onClick={findReusableSku}
              disabled={reusableBusy || !staff || !reusableSearch.trim()}
              className="rounded-xl bg-white px-4 py-2 font-semibold text-black disabled:opacity-50"
            >
              Find
            </button>

            <button
              type="button"
              onClick={() => openReusablePrintQuantity()}
              disabled={reusableBusy || !staff || !exactReusableMatch}
              className="rounded-xl border border-neutral-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              Print
            </button>
          </div>

          <p className="mt-2 text-sm text-neutral-400">
            Reusable SKUs are for repeat-stock product lines. The field gives suggestions from existing reusable SKUs, but does not run a search on every key press.
          </p>

          {reusableMessage && (
            <div className="mt-3 rounded-xl border border-neutral-700 bg-neutral-950 p-3 text-sm text-neutral-200">
              {reusableMessage}
            </div>
          )}

          {reusableBusy && (
            <p className="mt-3 text-sm font-bold text-neutral-400">Loading...</p>
          )}

          {reusableSearch.trim().length >= 2 &&
            reusableDropdownMatches.length > 0 && (
              <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                <p className="mb-2 text-xs font-bold uppercase text-neutral-500">
                  Matching reusable SKUs
                </p>

                <div className="space-y-2">
                  {reusableDropdownMatches.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setReusableSearch(item.sku)}
                      className="w-full rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left hover:border-white"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="font-mono text-xs text-neutral-500">{item.sku}</p>
                          {item.barcode_number && (
                            <p className="font-mono text-xs text-neutral-500">
                              Barcode: {item.barcode_number}
                            </p>
                          )}
                          <h3 className="truncate text-sm font-black">
                            {getReusableTitle(item)}
                          </h3>
                          <p className="mt-1 text-xs text-neutral-400">
                            {[item.brand, item.reporting_category, displayLocation(item.current_location)]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                          <p className="mt-1 text-xs text-neutral-400">
                            Stock: {item.stock_level ?? 0}
                            {typeof item.selling_price === 'number'
                              ? ` · £${item.selling_price.toFixed(2)}`
                              : ''}
                          </p>
                        </div>

                        <div className="flex shrink-0 gap-2">
                          <span className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-black">
                            Select
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
        </div>
      </section>


      {transferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-neutral-700 bg-neutral-900 p-5 text-white shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black">Transfer Stock</h2>
                <p className="mt-1 text-sm text-neutral-400">
                  Choose the destination and confirm the stock quantities.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setTransferModal(null)}
                className="rounded-xl border border-neutral-700 px-3 py-2 text-sm font-black text-white"
              >
                Close
              </button>
            </div>

            <div className="mt-5 space-y-3">
              <p className="text-xs font-black uppercase text-neutral-500">
                Stock Lines
              </p>
              {transferModal.lines.map((line, index) => {
                const selectedSource = line.sourceChoices?.find(
                  (choice) => choice.id === line.selectedSourceId
                )
                const maxQuantity = selectedSource?.stock_level || 1

                return (
                  <div
                    key={`${line.item.sku}-${index}`}
                    className="rounded-xl border border-neutral-800 bg-neutral-950 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-sm font-black">{line.item.sku}</p>
                        <p className="text-xs text-neutral-400">
                          {line.item.brand || line.item.basic_title || line.item.ai_title || 'Stock item'}
                        </p>
                      </div>

                      <label className="flex items-center gap-2 text-sm font-bold">
                        Qty
                        <input
                          type="number"
                          min={1}
                          max={maxQuantity}
                          value={line.quantity}
                          onChange={(event) => {
                            const value = event.target.value
                            updateTransferLine(index, {
                              quantity: value === '' ? '' : Math.floor(Number(value)),
                            })
                          }}
                          onBlur={() =>
                            updateTransferLine(index, {
                              quantity: Math.min(
                                maxQuantity,
                                Math.max(1, Math.floor(Number(line.quantity) || 1))
                              ),
                            })
                          }
                          className="w-20 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-2 text-white"
                        />
                      </label>
                    </div>

                    {line.sourceChoices && line.sourceChoices.length > 1 ? (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {line.sourceChoices.map((choice) => (
                          <button
                            key={choice.id}
                            type="button"
                            onClick={() => selectTransferSource(index, choice)}
                            className={`rounded-lg border px-3 py-2 text-left text-xs font-bold ${
                              line.selectedSourceId === choice.id
                                ? 'border-blue-400 bg-blue-700 text-white'
                                : 'border-neutral-700 bg-neutral-900 text-white hover:border-white'
                            }`}
                          >
                            {displayLocation(choice.location_name)} / {choice.bin_code}
                            <span className="ml-2 text-neutral-300">
                              {choice.stock_level} available
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-neutral-400">
                        From {displayLocation(line.sourceLocation)} / {line.sourceBin}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="mt-5">
              <p className="mb-2 text-xs font-black uppercase text-neutral-500">
                Destination Location
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {transferDestinationOptions(transferModal).map((location) => {
                  const selected =
                    canonicalLocationKey(location.name) ===
                    canonicalLocationKey(transferModal.destinationLocation)

                  return (
                    <button
                      key={location.name}
                      type="button"
                      onClick={() => selectTransferDestination(location.name)}
                      className={`rounded-xl border px-4 py-3 text-left text-sm font-black ${
                        selected
                          ? 'border-emerald-400 bg-emerald-700 text-white'
                          : 'border-neutral-700 bg-neutral-950 text-white hover:border-white'
                      }`}
                    >
                      {displayLocation(location.name)}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="mt-5">
              <p className="mb-2 text-xs font-black uppercase text-neutral-500">
                Destination Bin
              </p>
              {getBasicBins(transferModal.destinationLocation).length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  {getBasicBins(transferModal.destinationLocation).map((bin) => (
                    <button
                      key={bin}
                      type="button"
                      onClick={() =>
                        setTransferModal((current) =>
                          current ? { ...current, destinationBin: bin } : current
                        )
                      }
                      className={`rounded-xl border px-4 py-3 text-sm font-black ${
                        transferModal.destinationBin === bin
                          ? 'border-emerald-400 bg-emerald-700 text-white'
                          : 'border-neutral-700 bg-neutral-950 text-white hover:border-white'
                      }`}
                    >
                      {bin}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { label: 'Default', value: DEFAULT_BIN },
                    { label: 'Allocate Individual on receipt', value: 'ALLOCATE_INDIVIDUAL' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() =>
                        setTransferModal((current) =>
                          current ? { ...current, destinationBin: option.value } : current
                        )
                      }
                      className={`rounded-xl border px-4 py-3 text-sm font-black ${
                        transferModal.destinationBin === option.value
                          ? 'border-emerald-400 bg-emerald-700 text-white'
                          : 'border-neutral-700 bg-neutral-950 text-white hover:border-white'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-5 rounded-xl border border-neutral-800 bg-black/30 p-4 text-sm text-neutral-300">
              <span className="font-black text-white">
                {transferModal.lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0)}
              </span>{' '}
              unit(s) from{' '}
              <span className="font-black text-white">
                {displayLocation(transferModal.lines[0]?.sourceLocation)}
              </span>{' '}
              to{' '}
              <span className="font-black text-white">
                {displayLocation(transferModal.destinationLocation)}
              </span>{' '}
              /{' '}
              <span className="font-black text-white">
                {transferModal.destinationBin === 'ALLOCATE_INDIVIDUAL'
                  ? 'Allocate Individual'
                  : transferModal.destinationBin}
              </span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTransferModal(null)}
                className="rounded-xl border border-neutral-700 px-4 py-3 font-black text-white"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={submitTransferModal}
                disabled={busy}
                className="rounded-xl bg-emerald-600 px-4 py-3 font-black text-white disabled:opacity-50"
              >
                {busy ? 'Creating...' : 'Create Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {reusablePrintOpen && reusablePrintItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-neutral-700 bg-neutral-900 p-5 text-white shadow-2xl">
            <h2 className="text-xl font-black">Print Reusable SKU</h2>
            <p className="mt-2 font-mono text-sm text-neutral-300">
              SKU: {reusablePrintItem.sku}
            </p>
            <p className="mt-1 font-mono text-sm text-neutral-300">
              Barcode: {reusablePrintItem.barcode_number || 'Not set'}
            </p>
            <p className="mt-1 text-sm text-neutral-400">
              {getReusableTitle(reusablePrintItem)}
            </p>

            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-bold text-neutral-400">
                Label quantity
              </span>
              <input
                type="number"
                min={1}
                max={100}
                value={reusablePrintQty}
                onChange={(e) => setReusablePrintQty(Number(e.target.value))}
                className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-3 text-lg outline-none focus:border-white"
                autoFocus
              />
            </label>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setReusablePrintOpen(false)}
                className="rounded-xl border border-neutral-700 px-4 py-3 font-semibold text-white"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={printReusableSkuQuantity}
                className="rounded-xl bg-white px-4 py-3 font-semibold text-black"
              >
                Print
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}


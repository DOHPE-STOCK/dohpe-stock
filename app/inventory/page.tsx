'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { useCompany } from '@/app/context/CompanyContext'
import {
  isDigitalSkuType,
  isQuantityTrackedSkuType,
  normaliseSkuType,
  SKU_TYPE_OPTIONS,
  skuTypeLabel,
} from '@/lib/skuTypes'

type InventoryItem = {
  id: string
  sku: string
  status: string | null
  barcode_number: string | null
  sku_type: string | null
  brand: string | null
  reporting_category: string | null
  sub_category: string | null
  sub_type: string | null
  item_type?: string | null
  gender?: string | null
  colour_primary: string | null
  colour_secondary?: string | null
  tagged_size: string | null
  condition?: string | null
  material?: string | null
  era?: string | null
  style?: string | null
  flaws?: string | null
  cost_price?: number | null
  waist_in: number | null
  pit_to_pit_in?: number | null
  collar_to_hem_in?: number | null
  pit_to_cuff_in?: number | null
  sleeve_in?: number | null
  inside_leg_in?: number | null
  rise_in?: number | null
  hem_width_in?: number | null
  selling_price: number | null
  hs_code?: string | null
  country_of_origin?: string | null
  composition?: string | null
  shipping_size_identifier?: string | null
  package_weight_grams?: number | null
  package_length_cm?: number | null
  package_width_cm?: number | null
  package_height_cm?: number | null
  vat_rule?: string | null
  vat_rate?: number | null
  stock_level: number | null
  shop_floor_stock: number | null
  warehouse_stock: number | null
  current_location: string | null
  current_bin: string | null
  linnworks_managed: boolean | null
  linnworks_status: string | null
  ebay_status: string | null
  shopify_status: string | null
  square_status: string | null
  grailed_status: string | null
  vestiaire_collective_status: string | null
  whatnot_status: string | null
  vinted_status: string | null
  depop_status: string | null
  tiktok_shop_status: string | null
  linnworks_sync_error?: string | null
  ebay_sync_error?: string | null
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

type StockAlertRow = {
  id: string
  item_id: string | null
  sku: string | null
  alert_type: string
  severity: 'info' | 'warning' | 'critical'
  status: string
  location_name: string | null
  bin_code: string | null
  quantity: number | null
  title: string
  message: string | null
  created_at: string
}

type LocationLabelRow = {
  name: string
  label: string | null
  is_active?: boolean | null
}

type LocationColumn = {
  key: string
  label: string
}

function configuredLocationRows(rows: LocationLabelRow[]) {
  const configured = rows.filter((row) => text(row.label) || /^LOCATION-\d+$/i.test(text(row.name)))
  return configured.length > 0 ? configured : rows
}

const CHANNEL_ICONS = [
  { key: 'linnworks_status', name: 'Linnworks', src: 'https://www.google.com/s2/favicons?domain=linnworks.com&sz=64' },
  { key: 'ebay_status', name: 'eBay', src: 'https://www.google.com/s2/favicons?domain=ebay.co.uk&sz=64' },
  { key: 'vinted_status', name: 'Vinted', src: 'https://www.google.com/s2/favicons?domain=vinted.co.uk&sz=64' },
  { key: 'depop_status', name: 'Depop', src: 'https://www.google.com/s2/favicons?domain=depop.com&sz=64' },
  { key: 'grailed_status', name: 'Grailed', src: 'https://www.google.com/s2/favicons?domain=grailed.com&sz=64' },
  { key: 'vestiaire_collective_status', name: 'Vestiaire Collective', src: 'https://www.google.com/s2/favicons?domain=vestiairecollective.com&sz=64' },
  { key: 'whatnot_status', name: 'Whatnot', src: 'https://www.google.com/s2/favicons?domain=whatnot.com&sz=64' },
  { key: 'shopify_status', name: 'Shopify', src: 'https://www.google.com/s2/favicons?domain=shopify.com&sz=64' },
  { key: 'square_status', name: 'Square', src: 'https://www.google.com/s2/favicons?domain=squareup.com&sz=64' },
  { key: 'tiktok_shop_status', name: 'TikTok Shop', src: 'https://www.google.com/s2/favicons?domain=tiktok.com&sz=64' },
] as const

type ChannelKey = (typeof CHANNEL_ICONS)[number]['key']
type ChannelIcon = (typeof CHANNEL_ICONS)[number]
type ExportProgress = {
  open: boolean
  status: 'working' | 'success' | 'failed'
  title: string
  message: string
  details?: string[]
}

const SELLING_OR_MANAGEMENT_CHANNELS = new Set([
  'linnworks',
  'ebay',
  'vinted',
  'depop',
  'grailed',
  'vestiaire_collective',
  'whatnot',
  'shopify',
  'tiktok_shop',
])

const WIRED_EXPORT_CHANNELS = new Set(['linnworks', 'ebay'])

const BATCH_EDIT_FIELDS = [
  { group: 'Catalogue', key: 'brand', label: 'Brand', mode: 'text' },
  { group: 'Catalogue', key: 'reporting_category', label: 'Reporting Category', mode: 'text' },
  { group: 'Catalogue', key: 'sub_category', label: 'Sub Category', mode: 'text' },
  { group: 'Catalogue', key: 'item_type', label: 'Item Type', mode: 'text' },
  { group: 'Catalogue', key: 'gender', label: 'Gender', mode: 'text' },
  { group: 'Catalogue', key: 'tagged_size', label: 'Tagged Size', mode: 'text' },
  { group: 'Catalogue', key: 'condition', label: 'Condition', mode: 'text' },
  { group: 'Catalogue', key: 'material', label: 'Material', mode: 'text' },
  { group: 'Catalogue', key: 'colour_primary', label: 'Primary Colour', mode: 'text' },
  { group: 'Catalogue', key: 'colour_secondary', label: 'Secondary Colour', mode: 'text' },
  { group: 'Catalogue', key: 'era', label: 'Era', mode: 'text' },
  { group: 'Catalogue', key: 'style', label: 'Style', mode: 'text' },
  { group: 'Catalogue', key: 'flaws', label: 'Flaws', mode: 'text' },
  { group: 'Pricing', key: 'cost_price', label: 'Cost Price', mode: 'number' },
  { group: 'Pricing', key: 'selling_price', label: 'Selling Price', mode: 'number' },
  { group: 'Status', key: 'status', label: 'Status', mode: 'text' },
  { group: 'Measurements', key: 'pit_to_pit_in', label: 'Pit to Pit', mode: 'number' },
  { group: 'Measurements', key: 'collar_to_hem_in', label: 'Collar to Hem', mode: 'number' },
  { group: 'Measurements', key: 'pit_to_cuff_in', label: 'Pit to Cuff', mode: 'number' },
  { group: 'Measurements', key: 'sleeve_in', label: 'Sleeve', mode: 'number' },
  { group: 'Measurements', key: 'waist_in', label: 'Waist', mode: 'number' },
  { group: 'Measurements', key: 'inside_leg_in', label: 'Inside Leg', mode: 'number' },
  { group: 'Measurements', key: 'rise_in', label: 'Rise', mode: 'number' },
  { group: 'Measurements', key: 'hem_width_in', label: 'Leg Opening', mode: 'number' },
  { group: 'Logistics', key: 'hs_code', label: 'HS Code', mode: 'text' },
  { group: 'Logistics', key: 'country_of_origin', label: 'Country of Origin', mode: 'text' },
  { group: 'Logistics', key: 'composition', label: 'Composition', mode: 'text' },
  { group: 'Logistics', key: 'shipping_size_identifier', label: 'Shipping Size ID', mode: 'text' },
  { group: 'Logistics', key: 'package_weight_grams', label: 'Package Weight (g)', mode: 'number' },
  { group: 'Logistics', key: 'package_length_cm', label: 'Package Length (cm)', mode: 'number' },
  { group: 'Logistics', key: 'package_width_cm', label: 'Package Width (cm)', mode: 'number' },
  { group: 'Logistics', key: 'package_height_cm', label: 'Package Height (cm)', mode: 'number' },
  { group: 'Logistics', key: 'vat_rule', label: 'VAT Rule', mode: 'text' },
  { group: 'Logistics', key: 'vat_rate', label: 'VAT Rate', mode: 'number' },
] as const

const BATCH_EDIT_GROUPS = Array.from(new Set(BATCH_EDIT_FIELDS.map((field) => field.group)))

const LIVE_CHANNEL_STATUSES = ['listed', 'synced', 'active']
const RETRYABLE_CHANNEL_STATUSES = ['pending_update', 'failed', 'error']

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function currency(value: number | null | undefined) {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount)
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

function statusText(value: string | null | undefined) {
  return inventoryStatus(value).replaceAll('_', ' ') || '-'
}

function inventoryStatus(value: string | null | undefined) {
  const status = text(value).toLowerCase()
  if (status === 'processed') return 'finalised'
  return status
}

function channelIconClass(status?: string | null) {
  const value = text(status).toLowerCase()
  if (!value || value === 'not_listed' || value === 'not_synced') return 'opacity-20 grayscale'
  if (value === 'listed' || value === 'synced' || value === 'active') return 'opacity-100'
  if (value === 'error' || value === 'failed') return 'opacity-90 grayscale ring-1 ring-red-500'
  if (value === 'pending_update') return 'opacity-100'
  if (value === 'queued' || value === 'pending' || value === 'syncing') return 'animate-pulse opacity-60 grayscale'
  return 'opacity-40 grayscale'
}

function isChannelLive(status?: string | null) {
  const value = text(status).toLowerCase()
  return value === 'listed' || value === 'synced' || value === 'active'
}

function isChannelPendingUpdate(status?: string | null) {
  return text(status).toLowerCase() === 'pending_update'
}

function isChannelRetryable(status?: string | null) {
  return RETRYABLE_CHANNEL_STATUSES.includes(text(status).toLowerCase())
}

function channelErrorField(statusField: ChannelKey) {
  if (statusField === 'linnworks_status') return 'linnworks_sync_error'
  if (statusField === 'ebay_status') return 'ebay_sync_error'
  return ''
}

function channelStatusAfterSuccess(statusField: ChannelKey) {
  if (statusField === 'linnworks_status') return 'synced'
  return 'listed'
}

function channelIntegrationKey(channel: ChannelIcon) {
  return channel.key.replace(/_status$/, '')
}

function isNumericUniqueSku(item: InventoryItem) {
  return /^\d+$/.test(text(item.sku)) && !isDigitalSkuType(item.sku_type)
}

function displayBarcode(item: InventoryItem) {
  return text(item.barcode_number) || (isNumericUniqueSku(item) ? text(item.sku) : '-')
}

function canonicalLocationKey(value: string | null | undefined) {
  return text(value).toUpperCase().replace(/[\s_]+/g, '-')
}

const IN_TRANSIT_LOCATION = 'IN_TRANSIT'

export default function InventoryPage() {
  const { activeCompanyId, schemaReady } = useCompany()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [locations, setLocations] = useState<StockLocationRow[]>([])
  const [locationLabels, setLocationLabels] = useState<Record<string, string>>({})
  const [locationColumns, setLocationColumns] = useState<LocationColumn[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [itemStatusFilter, setItemStatusFilter] = useState('ALL')
  const [locationFilter, setLocationFilter] = useState('ALL')
  const [binFilter, setBinFilter] = useState('ALL')
  const [skuTypeFilter, setSkuTypeFilter] = useState('ALL')
  const [stockFilter, setStockFilter] = useState('ALL')
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState('')
  const [enabledIntegrationChannels, setEnabledIntegrationChannels] = useState<string[]>([])
  const [showExportPicker, setShowExportPicker] = useState(false)
  const [selectedExportChannels, setSelectedExportChannels] = useState<ChannelKey[]>([])
  const [exportProgress, setExportProgress] = useState<ExportProgress>({
    open: false,
    status: 'working',
    title: '',
    message: '',
  })
  const [showBatchEdit, setShowBatchEdit] = useState(false)
  const [batchField, setBatchField] = useState<(typeof BATCH_EDIT_FIELDS)[number]['key']>('brand')
  const [batchMode, setBatchMode] = useState<'set' | 'replace'>('set')
  const [batchFind, setBatchFind] = useState('')
  const [batchValue, setBatchValue] = useState('')
  const [batchBusy, setBatchBusy] = useState(false)
  const [stockAlerts, setStockAlerts] = useState<StockAlertRow[]>([])
  const [selectedStockAlertId, setSelectedStockAlertId] = useState('')
  const [stockAlertBusy, setStockAlertBusy] = useState(false)

  useEffect(() => {
    fetchInventory()
  }, [activeCompanyId, schemaReady])

  async function fetchInventory() {
    setLoading(true)
    setMessage('')

    let itemsQuery = supabase
      .from('items')
      .select(`
        id,
        sku,
        status,
        barcode_number,
        sku_type,
        brand,
        reporting_category,
        sub_category,
        sub_type,
        item_type,
        gender,
        colour_primary,
        colour_secondary,
        tagged_size,
        condition,
        material,
        era,
        style,
        flaws,
        cost_price,
        pit_to_pit_in,
        collar_to_hem_in,
        pit_to_cuff_in,
        sleeve_in,
        waist_in,
        inside_leg_in,
        rise_in,
        hem_width_in,
        selling_price,
        hs_code,
        country_of_origin,
        composition,
        shipping_size_identifier,
        package_weight_grams,
        package_length_cm,
        package_width_cm,
        package_height_cm,
        vat_rule,
        vat_rate,
        stock_level,
        shop_floor_stock,
        warehouse_stock,
        current_location,
        current_bin,
        linnworks_managed,
        linnworks_status,
        linnworks_sync_error,
        ebay_status,
        ebay_sync_error,
        shopify_status,
        square_status,
        grailed_status,
        vestiaire_collective_status,
        whatnot_status,
        vinted_status,
        depop_status,
        tiktok_shop_status,
        updated_at
      `)
      .order('updated_at', { ascending: false })
      .limit(2000)

    let stockLocationsQuery = supabase
      .from('item_stock_locations')
      .select(`
        id,
        item_id,
        sku,
        location_name,
        bin_code,
        stock_level,
        synced_at
      `)

    let locationLabelsQuery = supabase
      .from('locations')
      .select('name, label, is_active')
      .eq('is_active', true)

    let transferItemsQuery = supabase
      .from('stock_transfer_items')
      .select('id, item_id, sku, source_bin, status, stock_transfers!inner(from_location, status, company_id)')
      .eq('status', 'in_transfer')
      .eq('stock_transfers.status', 'sent')

    let integrationsQuery = supabase
      .from('integration_settings')
      .select('channel, enabled')
      .eq('enabled', true)

    let stockAlertsQuery = supabase
      .from('stock_alerts')
      .select('id, item_id, sku, alert_type, severity, status, location_name, bin_code, quantity, title, message, created_at')
      .in('status', ['open', 'acknowledged'])
      .order('created_at', { ascending: false })
      .limit(100)

    if (schemaReady) {
      itemsQuery = itemsQuery.eq('company_id', activeCompanyId)
      stockLocationsQuery = stockLocationsQuery.eq('company_id', activeCompanyId)
      locationLabelsQuery = locationLabelsQuery.eq('company_id', activeCompanyId)
      transferItemsQuery = transferItemsQuery.eq('stock_transfers.company_id', activeCompanyId)
      integrationsQuery = integrationsQuery.eq('company_id', activeCompanyId)
      stockAlertsQuery = stockAlertsQuery.eq('company_id', activeCompanyId)
    }

    const [itemsResult, locationsResult, locationLabelsResult, transferItemsResult, integrationsResult, stockAlertsResult] = await Promise.all([
      itemsQuery,
      stockLocationsQuery,
      locationLabelsQuery,
      transferItemsQuery,
      integrationsQuery,
      stockAlertsQuery,
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

    if (locationLabelsResult.error) {
      setMessage(locationLabelsResult.error.message)
      setLoading(false)
      return
    }

    if (transferItemsResult.error) {
      setMessage(transferItemsResult.error.message)
      setLoading(false)
      return
    }

    if (integrationsResult.error) {
      setMessage(integrationsResult.error.message)
      setLoading(false)
      return
    }

    if (stockAlertsResult.error) {
      setStockAlerts([])
    } else {
      setStockAlerts((stockAlertsResult.data || []) as StockAlertRow[])
    }

    setItems((itemsResult.data || []) as InventoryItem[])
    setEnabledIntegrationChannels((integrationsResult.data || []).map((row: any) => text(row.channel)))

    const fetchedLocations = configuredLocationRows((locationLabelsResult.data || []) as LocationLabelRow[])
    const activeLocations =
      fetchedLocations.length > 0
        ? fetchedLocations
        : [{ name: 'LOCATION-1', label: 'WAREHOUSE', is_active: true }]
    const orderedLocations = [...activeLocations].sort((a, b) =>
      canonicalLocationKey(a.name).localeCompare(canonicalLocationKey(b.name), undefined, { numeric: true })
    )
    const nextLabels = Object.fromEntries(
      orderedLocations.map((location) => [
        text(location.name),
        text(location.label || location.name).toUpperCase(),
      ])
    )

    setLocationLabels(nextLabels)
    setLocationColumns([
      ...orderedLocations.map((location) => {
        const key = text(location.name)
        return {
          key,
          label: nextLabels[key] || key,
        }
      }),
      { key: IN_TRANSIT_LOCATION, label: 'IN TRANSIT' },
    ])
    setLocations([
      ...((locationsResult.data || []) as StockLocationRow[]),
      ...buildInTransitRows((transferItemsResult.data || []) as any[]),
    ])
    setLoading(false)

    const params = new URLSearchParams(window.location.search)
    const alertId = text(params.get('stock_alert'))
    if (alertId) setSelectedStockAlertId(alertId)
  }

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const q = search.toLowerCase().trim()
      const locationRows = getLocationRows(item)

      const matchesSearch =
        !q ||
        text(item.sku).toLowerCase().includes(q) ||
        displayBarcode(item).toLowerCase().includes(q) ||
        text(item.brand).toLowerCase().includes(q) ||
        text(item.reporting_category).toLowerCase().includes(q) ||
        text(item.sub_category).toLowerCase().includes(q) ||
        text(item.current_location).toLowerCase().includes(q) ||
        displayLocation(item.current_location).toLowerCase().includes(q) ||
        text(item.current_bin).toLowerCase().includes(q) ||
        locationRows.some((row) =>
          `${row.location_name} ${displayLocation(row.location_name)} ${row.bin_code}`.toLowerCase().includes(q)
        )

      const matchesSkuType =
        skuTypeFilter === 'ALL' ||
        normaliseSkuType(item.sku_type) === skuTypeFilter.toLowerCase()

      const matchesItemStatus =
        itemStatusFilter === 'ALL' ||
        inventoryStatus(item.status) === itemStatusFilter.toLowerCase()

      const matchesLocation =
        locationFilter === 'ALL' ||
        canonicalLocationKey(resolveLocationName(item.current_location)) === canonicalLocationKey(locationFilter) ||
        locationRows.some(
          (row) => canonicalLocationKey(row.location_name) === canonicalLocationKey(locationFilter)
        )

      const matchesBin =
        binFilter === 'ALL' ||
        text(item.current_bin).toLowerCase() === binFilter.toLowerCase() ||
        locationRows.some(
          (row) => text(row.bin_code).toLowerCase() === binFilter.toLowerCase()
        )

      const stock = Number(item.stock_level || 0)

      const matchesStock =
        stockFilter === 'ALL' ||
        (stockFilter === 'IN_STOCK' && stock > 0) ||
        (stockFilter === 'OUT_OF_STOCK' && stock <= 0)

      return (
        matchesSearch &&
        matchesItemStatus &&
        matchesSkuType &&
        matchesLocation &&
        matchesBin &&
        matchesStock
      )
    })
  }, [items, locations, locationLabels, search, itemStatusFilter, skuTypeFilter, locationFilter, binFilter, stockFilter])

  const itemStatusOptions = useMemo(() => {
    const values = new Set<string>()

    items.forEach((item) => {
      const status = inventoryStatus(item.status)
      if (status) values.add(status)
    })

    return Array.from(values).sort()
  }, [items])

  const locationOptions = useMemo(() => {
    const values = new Set<string>()

    locationColumns.forEach((location) => {
      values.add(location.key)
    })

    items.forEach((item) => {
      const current = resolveLocationName(item.current_location)
      if (current) values.add(current)
    })

    locations.forEach((row) => {
      const location = resolveLocationName(row.location_name)
      if (location) values.add(location)
    })

    return Array.from(values).sort((a, b) => displayLocation(a).localeCompare(displayLocation(b)))
  }, [items, locations, locationColumns, locationLabels])

  const binOptions = useMemo(() => {
    const values = new Set<string>()

    items.forEach((item) => {
      const current = text(item.current_bin).toUpperCase()
      if (current) values.add(current)
    })

    locations.forEach((row) => {
      const bin = text(row.bin_code).toUpperCase()
      if (bin) values.add(bin)
    })

    return Array.from(values).sort()
  }, [items, locations])

  const summary = useMemo(() => {
    const totalUnits = filteredItems.reduce(
      (sum, item) => sum + Number(item.stock_level || 0),
      0
    )
    const totalValue = filteredItems.reduce(
      (sum, item) => sum + Number(item.stock_level || 0) * Number(item.selling_price || 0),
      0
    )
    const inStock = filteredItems.filter((item) => Number(item.stock_level || 0) > 0).length
    const quantityTracked = filteredItems.filter((item) => isQuantityTrackedSkuType(item.sku_type)).length
    const liveOnAnyChannel = filteredItems.filter((item) =>
      CHANNEL_ICONS.some((channel) => isChannelLive(item[channel.key]))
    ).length

    return {
      itemCount: filteredItems.length,
      totalUnits,
      totalValue,
      inStock,
      quantityTracked,
      liveOnAnyChannel,
    }
  }, [filteredItems])

  const filteredItemIds = useMemo(
    () => filteredItems.map((item) => item.id),
    [filteredItems]
  )

  const selectedItems = useMemo(
    () => items.filter((item) => selectedItemIds.includes(item.id)),
    [items, selectedItemIds]
  )

  const allFilteredSelected =
    filteredItemIds.length > 0 &&
    filteredItemIds.every((id) => selectedItemIds.includes(id))

  function clearFilters() {
    setSearch('')
    setItemStatusFilter('ALL')
    setLocationFilter('ALL')
    setBinFilter('ALL')
    setSkuTypeFilter('ALL')
    setStockFilter('ALL')
  }

  function toggleSelected(itemId: string) {
    setSelectedItemIds((current) =>
      current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId]
    )
  }

  function toggleSelectAllFiltered() {
    setSelectedItemIds((current) => {
      if (allFilteredSelected) {
        return current.filter((id) => !filteredItemIds.includes(id))
      }

      return Array.from(new Set([...current, ...filteredItemIds]))
    })
  }

  function liveChannelsForItem(item: InventoryItem) {
    return CHANNEL_ICONS.filter((channel) =>
      LIVE_CHANNEL_STATUSES.includes(text(item[channel.key]).toLowerCase())
    )
  }

  function pendingChannelUpdatesForItems(targetItems: InventoryItem[]) {
    const updates: Record<string, unknown> = {}
    let hasPending = false

    for (const item of targetItems) {
      for (const channel of liveChannelsForItem(item)) {
        updates[channel.key] = 'pending_update'
        hasPending = true
      }
    }

    if (hasPending) updates.channel_pending_update_at = new Date().toISOString()
    return updates
  }

  async function updateItemChannelStatus(
    itemId: string,
    updates: Record<string, unknown>
  ) {
    let query = supabase
      .from('items')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', itemId)

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { error } = await query
    if (error) throw new Error(error.message)
  }

  async function fetchFullItem(itemId: string) {
    let query = supabase
      .from('items')
      .select('*')
      .eq('id', itemId)

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data, error } = await query.maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new Error('Item not found for active company.')
    return data
  }

  async function publishEbayChanges(item: InventoryItem) {
    const readinessResponse = await fetch(
      `/api/integrations/ebay/listing-readiness?sku=${encodeURIComponent(item.sku)}`
    )
    const readiness = await readinessResponse.json().catch(() => null)
    if (!readinessResponse.ok || !readiness?.ok) {
      throw new Error(readiness?.message || 'eBay readiness check failed.')
    }

    const draftResponse = await fetch('/api/integrations/ebay/shadow-draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ readiness }),
    })
    const draft = await draftResponse.json().catch(() => null)
    if (!draftResponse.ok || !draft?.ok) {
      throw new Error(draft?.message || 'Could not save eBay draft.')
    }

    const publishResponse = await fetch('/api/integrations/ebay/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sku: item.sku }),
    })
    const published = await publishResponse.json().catch(() => null)
    if (!publishResponse.ok || !published?.ok) {
      throw new Error(published?.message || 'Could not publish eBay changes.')
    }
  }

  async function publishLinnworksChanges(item: InventoryItem) {
    const fullItem = await fetchFullItem(item.id)
    const response = await fetch('/api/integrations/linnworks/export-item', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fullItem),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.message || 'Linnworks export failed.')
    }
  }

  function finishExportProgress(progress: Omit<ExportProgress, 'open'>) {
    setExportProgress({ ...progress, open: true })

    if (progress.status === 'success') {
      window.setTimeout(() => {
        setExportProgress((current) =>
          current.status === 'success' ? { ...current, open: false } : current
        )
      }, 1500)
    }
  }

  async function publishChannelUpdate(item: InventoryItem, channel: (typeof CHANNEL_ICONS)[number]) {
    const status = item[channel.key as ChannelKey]
    if (!isChannelRetryable(status)) return

    const channelKey = channel.key.replace(/_status$/, '')
    const errorField = channelErrorField(channel.key)

    if (!['ebay', 'linnworks'].includes(channelKey)) {
      setMessage(`${channel.name} update route is not wired yet.`)
      return
    }

    const retryText = isChannelPendingUpdate(status) ? 'unpublished changes' : 'failed update'
    const confirmed = window.confirm(`Publish ${retryText} for ${item.sku} to ${channel.name}?`)
    if (!confirmed) return

    setExporting(true)
    setExportProgress({
      open: true,
      status: 'working',
      title: `Publishing to ${channel.name}`,
      message: item.sku,
    })

    try {
      await updateItemChannelStatus(item.id, {
        [channel.key]: 'pending',
        ...(errorField ? { [errorField]: null } : {}),
      })

      setItems((current) =>
        current.map((row) => (row.id === item.id ? { ...row, [channel.key]: 'pending' } : row))
      )

      if (channelKey === 'ebay') await publishEbayChanges(item)
      if (channelKey === 'linnworks') await publishLinnworksChanges(item)

      const successStatus = channelStatusAfterSuccess(channel.key)
      await updateItemChannelStatus(item.id, {
        [channel.key]: successStatus,
        ...(errorField ? { [errorField]: null } : {}),
      })

      setItems((current) =>
        current.map((row) =>
          row.id === item.id
            ? { ...row, [channel.key]: successStatus, ...(errorField ? { [errorField]: null } : {}) }
            : row
        )
      )
      finishExportProgress({
        status: 'success',
        title: `${channel.name} updated`,
        message: item.sku,
      })
    } catch (error: any) {
      const message = error.message || `${channel.name} update failed.`
      await updateItemChannelStatus(item.id, {
        [channel.key]: 'failed',
        ...(errorField ? { [errorField]: message } : {}),
      }).catch(() => null)

      setItems((current) =>
        current.map((row) =>
          row.id === item.id
            ? { ...row, [channel.key]: 'failed', ...(errorField ? { [errorField]: message } : {}) }
            : row
        )
      )
      finishExportProgress({
        status: 'failed',
        title: `${channel.name} update failed`,
        message,
        details: [item.sku],
      })
    } finally {
      setExporting(false)
    }
  }

  async function applyBatchEdit() {
    if (selectedItems.length < 2) {
      setMessage('Select at least 2 items before using batch edit.')
      return
    }

    const field = BATCH_EDIT_FIELDS.find((row) => row.key === batchField)
    if (!field) return

    if (batchMode === 'replace' && !batchFind) {
      setMessage('Enter text to find before using find and replace.')
      return
    }

    const liveCount = selectedItems.filter((item) => liveChannelsForItem(item).length > 0).length
    const confirmed = window.confirm(
      `Apply batch edit to ${selectedItems.length} item(s)?${
        liveCount
          ? `\n\n${liveCount} item(s) are already published. Their channel icons will be marked with unpublished changes.`
          : ''
      }`
    )

    if (!confirmed) return

    setBatchBusy(true)
    setMessage(`Applying batch edit to ${selectedItems.length} item(s)...`)

    try {
      let markedPending = false
      let changedCount = 0

      for (const item of selectedItems) {
        const currentValue = text((item as any)[batchField])
        let nextValue: any = batchValue

        if (batchMode === 'replace') {
          if (!currentValue.includes(batchFind)) continue
          nextValue = currentValue.replaceAll(batchFind, batchValue)
        }

        if (field.mode === 'number') {
          const numberValue = Number(nextValue)
          nextValue = Number.isFinite(numberValue) ? numberValue : null
        } else {
          nextValue = text(nextValue) || null
        }

        const itemPendingUpdates = pendingChannelUpdatesForItems([item])
        if (Object.keys(itemPendingUpdates).length) markedPending = true

        let query = supabase
          .from('items')
          .update({
            [batchField]: nextValue,
            ...(batchField === 'sub_category' ? { sub_type: nextValue } : {}),
            ...itemPendingUpdates,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id)

        if (schemaReady) query = query.eq('company_id', activeCompanyId)

        const { error } = await query
        if (error) throw new Error(error.message)
        changedCount += 1
      }

      setItems((current) =>
        current.map((item) => {
          if (!selectedItemIds.includes(item.id)) return item
          const currentValue = text((item as any)[batchField])
          let nextValue: any = batchValue

          if (batchMode === 'replace') {
            if (!currentValue.includes(batchFind)) return item
            nextValue = currentValue.replaceAll(batchFind, batchValue)
          }

          if (field.mode === 'number') {
            const numberValue = Number(nextValue)
            nextValue = Number.isFinite(numberValue) ? numberValue : null
          } else {
            nextValue = text(nextValue) || null
          }

          const itemPendingUpdates = pendingChannelUpdatesForItems([item])

          return {
            ...item,
            [batchField]: nextValue,
            ...(batchField === 'sub_category' ? { sub_type: nextValue } : {}),
            ...itemPendingUpdates,
          }
        })
      )

      setShowBatchEdit(false)
      setBatchFind('')
      setBatchValue('')
      setMessage(
        `Batch edit applied to ${changedCount} item(s).${
          markedPending ? ' Published channels were marked with unpublished changes.' : ''
        }`
      )

      if (markedPending) {
        window.alert(
          'Batch edit saved. Published channel icons now show unpublished changes. Use the warning icons in Inventory to publish the updates.'
        )
      }
    } catch (error: any) {
      setMessage(error.message || 'Batch edit failed.')
    } finally {
      setBatchBusy(false)
    }
  }

  async function deleteSelectedItems() {
    if (selectedItemIds.length === 0) return

    const confirmed = window.confirm(
      `Delete ${selectedItemIds.length} selected item(s)?\n\nThis removes linked image rows and stock-location rows, then deletes the item records. This cannot be undone.`
    )

    if (!confirmed) return

    setLoading(true)
    setMessage(`Deleting ${selectedItemIds.length} selected item(s)...`)

    const { error: imageError } = await supabase
      .from('item_images')
      .delete()
      .in('item_id', selectedItemIds)

    if (imageError) {
      setLoading(false)
      setMessage(imageError.message)
      return
    }

    const { error: locationError } = await supabase
      .from('item_stock_locations')
      .delete()
      .in('item_id', selectedItemIds)

    if (locationError) {
      setLoading(false)
      setMessage(locationError.message)
      return
    }

    const { error } = await supabase
      .from('items')
      .delete()
      .in('id', selectedItemIds)

    if (error) {
      setLoading(false)
      setMessage(error.message)
      return
    }

    setItems((current) => current.filter((item) => !selectedItemIds.includes(item.id)))
    setLocations((current) => current.filter((row) => !selectedItemIds.includes(row.item_id)))
    setSelectedItemIds([])
    setLoading(false)
    setMessage('Selected items deleted.')
  }

  function openExportPicker() {
    if (selectedItems.length === 0) return

    if (wiredExportChannels.length === 0) {
      setMessage('No active selling or inventory-management integrations are ready to export yet.')
      return
    }

    setSelectedExportChannels(wiredExportChannels.map((channel) => channel.key))
    setShowExportPicker(true)
  }

  function toggleExportChannel(channelKey: ChannelKey) {
    setSelectedExportChannels((current) =>
      current.includes(channelKey)
        ? current.filter((key) => key !== channelKey)
        : [...current, channelKey]
    )
  }

  async function exportSelectedItems(channelKeys = selectedExportChannels) {
    if (selectedItems.length === 0) return

    const channels = wiredExportChannels.filter((channel) => channelKeys.includes(channel.key))
    if (channels.length === 0) {
      setMessage('Choose at least one active export channel.')
      return
    }

    const channelNames = channels.map((channel) => channel.name).join(', ')
    const confirmed = window.confirm(
      `Export ${selectedItems.length} selected item(s) to ${channelNames}?`
    )
    if (!confirmed) return

    setExporting(true)
    setShowExportPicker(false)
    setExportProgress({
      open: true,
      status: 'working',
      title: 'Exporting selected items',
      message: `${selectedItems.length} item(s) to ${channelNames}`,
    })

    let successCount = 0
    let failCount = 0
    const failures: string[] = []

    for (const item of selectedItems) {
      for (const channel of channels) {
        const channelKey = channelIntegrationKey(channel)
        const errorField = channelErrorField(channel.key)

        try {
          await updateItemChannelStatus(item.id, {
            [channel.key]: 'pending',
            ...(errorField ? { [errorField]: null } : {}),
          })

          setItems((current) =>
            current.map((row) =>
              row.id === item.id
                ? { ...row, [channel.key]: 'pending', ...(errorField ? { [errorField]: null } : {}) }
                : row
            )
          )

          if (channelKey === 'ebay') await publishEbayChanges(item)
          if (channelKey === 'linnworks') await publishLinnworksChanges(item)

          const successStatus = channelStatusAfterSuccess(channel.key)
          await updateItemChannelStatus(item.id, {
            [channel.key]: successStatus,
            ...(errorField ? { [errorField]: null } : {}),
          })

          successCount += 1
          setItems((current) =>
            current.map((row) =>
              row.id === item.id
                ? { ...row, [channel.key]: successStatus, ...(errorField ? { [errorField]: null } : {}) }
                : row
            )
          )
        } catch (error: any) {
          const message = error.message || `${channel.name} export failed.`
          failCount += 1
          failures.push(`${item.sku} / ${channel.name}: ${message}`)
          await updateItemChannelStatus(item.id, {
            [channel.key]: 'failed',
            ...(errorField ? { [errorField]: message } : {}),
          }).catch(() => null)

          setItems((current) =>
            current.map((row) =>
              row.id === item.id
                ? { ...row, [channel.key]: 'failed', ...(errorField ? { [errorField]: message } : {}) }
                : row
            )
          )
        }
      }
    }

    setExporting(false)
    finishExportProgress({
      status: failCount > 0 ? 'failed' : 'success',
      title: failCount > 0 ? 'Channel export failed' : 'Channel export complete',
      message: `${successCount} succeeded, ${failCount} failed`,
      details: failures.slice(0, 8),
    })
  }

  function resolveLocationName(locationName: string | null | undefined) {
    if (isInTransitLocation(locationName)) return IN_TRANSIT_LOCATION
    const key = canonicalLocationKey(locationName)
    const match = Object.entries(locationLabels).find(([name, label]) => {
      return canonicalLocationKey(name) === key || canonicalLocationKey(label) === key
    })

    return match?.[0] || text(locationName)
  }

  function isInTransitLocation(locationName: string | null | undefined) {
    const key = canonicalLocationKey(locationName)
    return (
      key === 'IN-TRANSIT' ||
      key === 'IN-TRANSIT-TO-SHOP' ||
      key === 'IN-TRANSIT-TO-WAREHOUSE'
    )
  }

  function getLocationRows(item: InventoryItem) {
    const itemId = text(item.id)
    const sku = text(item.sku).toUpperCase()

    const matchingRows = locations.filter((row) => {
      const rowItemId = text(row.item_id)
      const rowSku = text(row.sku).toUpperCase()

      return (itemId && rowItemId === itemId) || (sku && rowSku === sku)
    })

    const grouped = new Map<string, StockLocationRow>()

    matchingRows.forEach((row) => {
      const location = resolveLocationName(row.location_name)
      const bin = text(row.bin_code) || 'Default'
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

  function buildInTransitRows(rows: any[]) {
    const pendingRows: StockLocationRow[] = []

    rows.forEach((row) => {
      const transfer = Array.isArray(row.stock_transfers)
        ? row.stock_transfers[0]
        : row.stock_transfers
      const sourceLocation = text(transfer?.from_location) || 'LOCATION-1'
      const sourceBin = text(row.source_bin) || 'Default'
      const itemId = text(row.item_id)
      const sku = text(row.sku).toUpperCase()

      pendingRows.push(
        {
          id: `pending-source-${row.id}`,
          item_id: itemId,
          sku,
          location_name: sourceLocation,
          bin_code: sourceBin,
          stock_level: -1,
          synced_at: null,
        },
        {
          id: `pending-in-transit-${row.id}`,
          item_id: itemId,
          sku,
          location_name: IN_TRANSIT_LOCATION,
          bin_code: 'Pending Transfer',
          stock_level: 1,
          synced_at: null,
        }
      )
    })

    return pendingRows
  }

  function getTotalStock(item: InventoryItem) {
    if (locationFilter !== 'ALL') {
      return getLocationQty(item, locationFilter)
    }

    const rows = getLocationRows(item)

    if (rows.length > 0) {
      return rows.reduce((sum, row) => sum + Math.max(0, Number(row.stock_level || 0)), 0)
    }

    return Number(item.stock_level || 0)
  }

  function getLocationQty(item: InventoryItem, locationKey: string) {
    const rows = getLocationRows(item).filter(
      (row) => canonicalLocationKey(row.location_name) === canonicalLocationKey(locationKey)
    )

    if (rows.length > 0) {
      return Math.max(0, rows.reduce((sum, row) => sum + Number(row.stock_level || 0), 0))
    }

    if (getLocationRows(item).length === 0 && canonicalLocationKey(resolveLocationName(item.current_location)) === canonicalLocationKey(locationKey)) {
      return Number(item.stock_level || 0)
    }

    return 0
  }

  function getAllLocationTooltip(item: InventoryItem, columns: LocationColumn[]) {
    return columns
      .map((location) => `${location.label}: ${getLocationQty(item, location.key)}`)
      .join('\n')
  }

  function getBinTooltip(item: InventoryItem) {
    const key = canonicalLocationKey(locationFilter)
    const rows = getLocationRows(item).filter(
      (row) => canonicalLocationKey(row.location_name) === key
    )

    if (rows.length > 0) {
      const bins = new Map<string, number>()

      rows.forEach((row) => {
        const bin = text(row.bin_code) || 'Default'
        bins.set(bin, (bins.get(bin) || 0) + Number(row.stock_level || 0))
      })

      return Array.from(bins.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([bin, quantity]) => `${bin}: ${quantity}`)
        .join('\n')
    }

    if (getLocationRows(item).length === 0 && canonicalLocationKey(resolveLocationName(item.current_location)) === key) {
      return `${item.current_bin || 'Default'}: ${Number(item.stock_level || 0)}`
    }

    return 'No stock at this location'
  }

  function getStockTooltip(item: InventoryItem, columns: LocationColumn[]) {
    if (locationFilter === 'ALL') return getAllLocationTooltip(item, columns)
    return getBinTooltip(item)
  }

  function alertsForItem(item: InventoryItem) {
    const itemId = text(item.id)
    const sku = text(item.sku).toUpperCase()
    return stockAlerts.filter((alert) => {
      const alertItemId = text(alert.item_id)
      const alertSku = text(alert.sku).toUpperCase()
      return (itemId && alertItemId === itemId) || (sku && alertSku === sku)
    })
  }

  const selectedStockAlert = useMemo(
    () => stockAlerts.find((alert) => alert.id === selectedStockAlertId) || null,
    [stockAlerts, selectedStockAlertId]
  )

  const selectedStockAlertItem = useMemo(() => {
    if (!selectedStockAlert) return null
    return (
      items.find((item) => text(item.id) === text(selectedStockAlert.item_id)) ||
      items.find((item) => text(item.sku).toUpperCase() === text(selectedStockAlert.sku).toUpperCase()) ||
      null
    )
  }, [items, selectedStockAlert])

  const selectedStockAlertPositiveRows = useMemo(() => {
    if (!selectedStockAlertItem) return []
    return getLocationRows(selectedStockAlertItem)
      .filter((row) => Number(row.stock_level || 0) > 0)
      .filter((row) => {
        const sameLocation =
          canonicalLocationKey(row.location_name) === canonicalLocationKey(selectedStockAlert?.location_name)
        const sameBin = text(row.bin_code).toUpperCase() === text(selectedStockAlert?.bin_code).toUpperCase()
        return !(sameLocation && sameBin)
      })
      .sort((a, b) => Number(b.stock_level || 0) - Number(a.stock_level || 0))
  }, [selectedStockAlertItem, selectedStockAlert, locations, locationLabels])

  async function resolveNegativeStockFromRow(row: StockLocationRow) {
    if (!selectedStockAlert) return

    const needed = Math.abs(Math.min(0, Number(selectedStockAlert.quantity || 0))) || 1
    const quantity = Math.min(needed, Number(row.stock_level || 0))
    if (quantity <= 0) return

    const confirmed = window.confirm(
      `Move ${quantity} unit(s) from ${displayLocation(row.location_name)} / ${row.bin_code || 'Default'} to cover ${displayLocation(selectedStockAlert.location_name)} / ${selectedStockAlert.bin_code || 'Default'}?`
    )

    if (!confirmed) return

    setStockAlertBusy(true)
    setMessage('')

    try {
      const response = await fetch('/api/stock/alerts/resolve-negative', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          alert_id: selectedStockAlert.id,
          source_row_id: row.id,
          quantity,
        }),
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.message || payload?.error || 'Negative stock resolve failed.')
      }

      setMessage(payload.resolved ? 'Negative stock alert resolved.' : 'Stock moved. Alert still needs more stock.')
      setSelectedStockAlertId('')
      await fetchInventory()
    } catch (error: any) {
      setMessage(error.message || 'Negative stock resolve failed.')
    } finally {
      setStockAlertBusy(false)
    }
  }

  function displayLocation(locationName: string | null | undefined) {
    const name = resolveLocationName(locationName)
    if (name === IN_TRANSIT_LOCATION) return 'IN TRANSIT'
    return locationLabels[name] || name || '-'
  }

  const tooltipLocationColumns =
    locationColumns.length > 0 ? locationColumns : [{ key: 'LOCATION-1', label: 'WAREHOUSE' }]

  const visibleChannelIcons = CHANNEL_ICONS.filter((channel) =>
    enabledIntegrationChannels.includes(channelIntegrationKey(channel))
  )

  const activeExportChannels = CHANNEL_ICONS.filter((channel) => {
    const integrationKey = channelIntegrationKey(channel)
    return (
      SELLING_OR_MANAGEMENT_CHANNELS.has(integrationKey) &&
      enabledIntegrationChannels.includes(integrationKey)
    )
  })

  const wiredExportChannels = activeExportChannels.filter((channel) =>
    WIRED_EXPORT_CHANNELS.has(channelIntegrationKey(channel))
  )

  const tableGridTemplate = '28px 130px 105px 90px 90px minmax(150px,0.9fr) 68px 78px minmax(80px,140px) 96px'

  return (
    <StaffPermissionGate permission="inventory">
      <main className="min-h-screen bg-neutral-950 p-4 text-white">
        <div className="app-header mb-4 flex flex-wrap items-start justify-between gap-4 rounded-3xl bg-black p-4 text-white shadow-2xl sm:p-5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
            <div>
              <h1 className="text-2xl font-black tracking-normal">Inventory</h1>

              <p className="text-sm text-neutral-300">
                Compact multi-location stock view
              </p>
            </div>

            <AppNav current="inventory" />
          </div>
        </div>

        <section className="mb-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="mb-4 grid gap-3 md:grid-cols-6">
            <div className="rounded-xl bg-neutral-950 p-4">
              <p className="text-xs font-black uppercase text-neutral-500">Items</p>
              <p className="mt-1 text-2xl font-black">{summary.itemCount}</p>
            </div>

            <div className="rounded-xl bg-neutral-950 p-4">
              <p className="text-xs font-black uppercase text-neutral-500">Units</p>
              <p className="mt-1 text-2xl font-black">{summary.totalUnits}</p>
            </div>

            <div className="rounded-xl bg-neutral-950 p-4">
              <p className="text-xs font-black uppercase text-neutral-500">Retail Value</p>
              <p className="mt-1 text-2xl font-black text-green-300">
                {currency(summary.totalValue)}
              </p>
            </div>

            <div className="rounded-xl bg-neutral-950 p-4">
              <p className="text-xs font-black uppercase text-neutral-500">In Stock SKUs</p>
              <p className="mt-1 text-2xl font-black">{summary.inStock}</p>
            </div>

            <div className="rounded-xl bg-neutral-950 p-4">
              <p className="text-xs font-black uppercase text-neutral-500">Standard</p>
              <p className="mt-1 text-2xl font-black">{summary.quantityTracked}</p>
            </div>

            <div className="rounded-xl bg-neutral-950 p-4">
              <p className="text-xs font-black uppercase text-neutral-500">Live Channel</p>
              <p className="mt-1 text-2xl font-black">{summary.liveOnAnyChannel}</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr_auto]">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search SKU / barcode / brand / bin"
              className="rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm outline-none"
            />

            <select
              value={itemStatusFilter}
              onChange={(e) => setItemStatusFilter(e.target.value)}
              className="rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm outline-none"
            >
              <option value="ALL">All Item Statuses</option>
              {itemStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {statusText(status)}
                </option>
              ))}
            </select>

            <select
              value={skuTypeFilter}
              onChange={(e) => setSkuTypeFilter(e.target.value)}
              className="rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm outline-none"
            >
              <option value="ALL">All SKU Types</option>
              {SKU_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm outline-none"
            >
              <option value="ALL">All Locations</option>
              {locationOptions.map((location) => (
                <option key={location} value={location}>
                  {displayLocation(location)}
                </option>
              ))}
            </select>

            <select
              value={binFilter}
              onChange={(e) => setBinFilter(e.target.value)}
              className="rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm outline-none"
            >
              <option value="ALL">All Bins</option>
              {binOptions.map((bin) => (
                <option key={bin} value={bin}>
                  {bin}
                </option>
              ))}
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

            <button
              type="button"
              onClick={clearFilters}
              className="rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm font-black text-white hover:bg-neutral-800"
            >
              Clear
            </button>
          </div>
        </section>

        {message && (
          <section className="mb-4 rounded-xl border border-yellow-800 bg-yellow-950 p-4 text-sm font-bold text-yellow-300">
            {message}
          </section>
        )}

        <section className="rounded-xl border border-neutral-800 bg-neutral-900">
          {selectedItemIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 bg-neutral-950 px-3 py-3">
              <span className="text-xs font-black">
                {selectedItemIds.length} selected
              </span>

              {selectedItemIds.length === 1 ? (
                <Link
                  href={`/items/${selectedItemIds[0]}`}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-500"
                >
                  Edit
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowBatchEdit(true)}
                  disabled={exporting}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                  title="Batch edit selected items."
                >
                  Batch Edit
                </button>
              )}

              <button
                type="button"
                onClick={openExportPicker}
                disabled={exporting}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
              >
                {exporting ? 'Exporting...' : 'Export'}
              </button>

              <button
                type="button"
                onClick={deleteSelectedItems}
                className="rounded-lg bg-red-600 px-3 py-2 text-xs font-black text-white"
              >
                Delete
              </button>
            </div>
          )}

          <div
            className="inventory-table-header grid gap-2 border-b border-neutral-800 bg-black/40 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-white"
            style={{ gridTemplateColumns: tableGridTemplate }}
          >
            <div>
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={toggleSelectAllFiltered}
                aria-label="Select all filtered inventory"
              />
            </div>
            <div>SKU</div>
            <div>Barcode</div>
            <div>Status</div>
            <div>Type</div>
            <div>Item</div>
            <div>Stock</div>
            <div>Price</div>
            <div className="flex flex-wrap items-center gap-1">
              {visibleChannelIcons.map((channel) => (
                <img
                  key={channel.key}
                  src={channel.src}
                  alt={channel.name}
                  title={channel.name}
                  className="h-4 w-4 rounded-sm"
                />
              ))}
            </div>
            <div className="text-right">Actions</div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-neutral-500">
              Loading inventory...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="p-8 text-center text-neutral-500">
              No inventory matches the current filters.
            </div>
          ) : (
            <div className="divide-y divide-neutral-800">
              {filteredItems.map((item) => {
                const itemAlerts = alertsForItem(item)
                return (
                  <div
                    key={item.id}
                    className="grid gap-2 px-3 py-2 text-xs"
                    style={{ gridTemplateColumns: tableGridTemplate }}
                  >
                    <div>
                      <input
                        type="checkbox"
                        checked={selectedItemIds.includes(item.id)}
                        onChange={() => toggleSelected(item.id)}
                        aria-label={`Select ${item.sku}`}
                      />
                    </div>

                    <div className="truncate font-mono">
                      {item.sku}
                    </div>

                    <div className="truncate font-mono text-neutral-400">
                      {displayBarcode(item)}
                    </div>

                    <div>
                      <span className="rounded-full bg-neutral-800 px-2 py-1 text-[10px] font-black uppercase text-white">
                        {statusText(item.status)}
                      </span>
                    </div>

                    <div>
                      <span className="rounded-full bg-neutral-800 px-2 py-1 text-[10px] font-black uppercase text-white">
                        {skuTypeLabel(item.sku_type)}
                      </span>
                    </div>

                    <div className="truncate">
                      <span className="font-bold">
                        {item.brand || 'No brand'}
                      </span>

                      <span className="mx-1 text-neutral-600">/</span>

                      <span className="text-neutral-300">
                        {item.reporting_category || 'No category'}
                      </span>

                      {item.sub_category && (
                        <>
                          <span className="mx-1 text-neutral-600">/</span>

                          <span className="text-neutral-400">
                            {item.sub_category}
                          </span>
                        </>
                      )}

                      {getSize(item) && (
                        <>
                          <span className="mx-1 text-neutral-600">/</span>

                          <span className="text-neutral-500">
                            {getSize(item)}
                          </span>
                        </>
                      )}
                    </div>

                    <div className="group relative font-black">
                      <div className="flex items-center gap-1">
                        <span className="inline-flex cursor-help rounded-md px-1">
                          {getTotalStock(item)}
                        </span>
                        {itemAlerts.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setSelectedStockAlertId(itemAlerts[0].id)}
                            className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[11px] font-black text-white hover:bg-red-500"
                            title={itemAlerts[0].message || itemAlerts[0].title}
                          >
                            !
                          </button>
                        )}
                      </div>
                      <div className="pointer-events-none absolute bottom-6 left-0 z-50 hidden min-w-56 whitespace-pre-line rounded-lg border border-neutral-700 bg-black p-3 text-xs font-bold leading-5 text-white shadow-2xl group-hover:block">
                        {getStockTooltip(item, tooltipLocationColumns)}
                      </div>
                    </div>

                    <div className="font-bold text-green-300">
                      {currency(item.selling_price)}
                    </div>

                    <div className="flex flex-wrap items-center gap-1">
                      {visibleChannelIcons.map((channel) => {
                        const status = item[channel.key as ChannelKey]
                        const pendingUpdate = isChannelPendingUpdate(status)
                        const retryable = isChannelRetryable(status)
                        const errorField = channelErrorField(channel.key)
                        const errorMessage = errorField ? text((item as any)[errorField]) : ''
                        const title = pendingUpdate
                          ? `${channel.name}: unpublished changes pending. Click to publish changes.`
                          : retryable
                            ? `${channel.name}: failed update. Click to retry.${errorMessage ? ` ${errorMessage}` : ''}`
                          : errorMessage
                            ? `${channel.name}: ${statusText(status)} - ${errorMessage}`
                            : `${channel.name}: ${statusText(status)}`

                        return (
                          <button
                            key={channel.key}
                            type="button"
                            onClick={() => publishChannelUpdate(item, channel)}
                            disabled={!retryable || exporting}
                            title={title}
                            className={`relative h-5 w-5 rounded-sm ${
                              retryable ? 'cursor-pointer hover:bg-amber-500/20' : 'cursor-default'
                            } disabled:cursor-default`}
                          >
                            <img
                              src={channel.src}
                              alt={channel.name}
                              className={`h-4 w-4 rounded-sm ${channelIconClass(status)}`}
                            />
                            {pendingUpdate && (
                              <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-400 text-[9px] font-black leading-none text-black ring-1 ring-black">
                                ◷
                              </span>
                            )}
                            {!pendingUpdate && retryable && (
                              <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[9px] font-black leading-none text-white ring-1 ring-black">
                                !
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>

                    <div className="flex justify-end gap-2 text-right">
                      <Link
                        href={`/stock-truth?sku=${encodeURIComponent(item.sku)}`}
                        className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1 text-[11px] font-black text-white hover:border-white"
                      >
                        Truth
                      </Link>
                      <Link
                        href={`/items/${item.id}`}
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

        {showExportPicker && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <div className="w-full max-w-lg rounded-2xl border border-neutral-700 bg-neutral-950 p-5 text-white shadow-2xl">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-black text-white">Export Selected Items</h2>
                  <p className="mt-1 text-sm font-bold text-neutral-400">
                    {selectedItemIds.length} selected item(s). Choose active selling or inventory-management channels.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowExportPicker(false)}
                  className="rounded-lg bg-neutral-800 px-3 py-2 text-xs font-black text-white hover:bg-neutral-700"
                >
                  Close
                </button>
              </div>

              <div className="space-y-2">
                {wiredExportChannels.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setSelectedExportChannels(wiredExportChannels.map((channel) => channel.key))}
                    className="flex w-full items-center justify-between rounded-xl border border-emerald-700 bg-emerald-950 px-4 py-3 text-left text-sm font-black text-white hover:bg-emerald-900"
                  >
                    <span>All available export channels</span>
                    <span className="text-xs text-emerald-200">{wiredExportChannels.length} channels</span>
                  </button>
                )}

                {wiredExportChannels.map((channel) => {
                  const checked = selectedExportChannels.includes(channel.key)

                  return (
                    <button
                      key={channel.key}
                      type="button"
                      onClick={() => toggleExportChannel(channel.key)}
                      className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-black text-white ${
                        checked
                          ? 'border-emerald-500 bg-emerald-900'
                          : 'border-neutral-700 bg-black hover:bg-neutral-900'
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <img src={channel.src} alt="" className="h-5 w-5 rounded-sm" />
                        {channel.name}
                      </span>
                      <span className={checked ? 'text-emerald-200' : 'text-neutral-500'}>
                        {checked ? 'Selected' : 'Click to include'}
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowExportPicker(false)}
                  className="rounded-lg border border-neutral-700 px-4 py-2 text-sm font-black text-white hover:bg-neutral-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => exportSelectedItems()}
                  disabled={exporting || selectedExportChannels.length === 0}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {exporting ? 'Exporting...' : 'Export Now'}
                </button>
              </div>
            </div>
          </div>
        )}

        {exportProgress.open && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4">
            <div className="w-full max-w-md rounded-2xl border border-neutral-700 bg-neutral-950 p-5 text-white shadow-2xl">
              <div className="flex items-start gap-3">
                <div
                  className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black ${
                    exportProgress.status === 'success'
                      ? 'bg-emerald-500 text-black'
                      : exportProgress.status === 'failed'
                        ? 'bg-red-600 text-white'
                        : 'bg-blue-600 text-white'
                  }`}
                >
                  {exportProgress.status === 'success' ? '✓' : exportProgress.status === 'failed' ? '!' : '...'}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-black text-white">{exportProgress.title}</h2>
                  <p className="mt-1 text-sm font-bold text-neutral-300">{exportProgress.message}</p>
                  {exportProgress.details && exportProgress.details.length > 0 && (
                    <div className="mt-3 max-h-40 overflow-auto rounded-xl border border-neutral-800 bg-black p-3 text-xs font-bold leading-5 text-red-200">
                      {exportProgress.details.map((detail, index) => (
                        <p key={`${detail}-${index}`}>{detail}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {exportProgress.status === 'failed' && (
                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setExportProgress((current) => ({ ...current, open: false }))}
                    className="rounded-lg bg-white px-4 py-2 text-sm font-black text-black hover:bg-neutral-200"
                  >
                    Acknowledge
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {selectedStockAlert && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <div className="w-full max-w-3xl rounded-2xl border border-red-900 bg-neutral-950 p-5 text-white shadow-2xl">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase text-red-300">Negative Stock Alert</p>
                  <h2 className="mt-1 text-xl font-black">{selectedStockAlert.sku || 'Unknown SKU'}</h2>
                  <p className="mt-1 text-sm font-bold text-neutral-400">
                    {displayLocation(selectedStockAlert.location_name)} / {selectedStockAlert.bin_code || 'Default'}:
                    {' '}
                    <span className="text-red-300">{selectedStockAlert.quantity ?? '-'}</span>
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedStockAlertId('')}
                  className="rounded-lg bg-neutral-800 px-3 py-2 text-xs font-black text-white hover:bg-neutral-700"
                >
                  Close
                </button>
              </div>

              <p className="mb-4 rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-sm font-bold text-neutral-300">
                {selectedStockAlert.message || 'Choose a positive source bin below to cover the negative quantity.'}
              </p>

              {!selectedStockAlertItem ? (
                <p className="rounded-xl border border-yellow-800 bg-yellow-950 p-4 text-sm font-bold text-yellow-200">
                  This SKU is not currently visible in the active inventory result set.
                </p>
              ) : selectedStockAlertPositiveRows.length === 0 ? (
                <div className="rounded-xl border border-yellow-800 bg-yellow-950 p-4">
                  <p className="text-sm font-black text-yellow-100">No positive bins found for this SKU.</p>
                  <p className="mt-1 text-xs font-bold text-yellow-200">
                    Use recount mode later, or manually adjust the stock level from the item logistics tab.
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-neutral-800">
                  <div className="grid grid-cols-[1fr_1fr_80px_120px] gap-2 bg-neutral-900 px-3 py-2 text-[11px] font-black uppercase text-neutral-500">
                    <span>Source Location</span>
                    <span>Source Bin</span>
                    <span className="text-right">Qty</span>
                    <span className="text-right">Action</span>
                  </div>

                  <div className="divide-y divide-neutral-800">
                    {selectedStockAlertPositiveRows.map((row) => (
                      <div
                        key={row.id}
                        className="grid grid-cols-[1fr_1fr_80px_120px] gap-2 px-3 py-3 text-sm font-bold"
                      >
                        <span>{displayLocation(row.location_name)}</span>
                        <span className="text-neutral-300">{row.bin_code || 'Default'}</span>
                        <span className="text-right text-white">{row.stock_level}</span>
                        <button
                          type="button"
                          onClick={() => resolveNegativeStockFromRow(row)}
                          disabled={stockAlertBusy}
                          className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-500 disabled:opacity-50"
                        >
                          Deduct
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
                <p className="text-xs font-black uppercase text-neutral-500">Recount QR</p>
                <p className="mt-1 text-sm font-bold text-neutral-300">
                  Scanner recount tasks will use this alert as the starting point in the next pass.
                </p>
              </div>
            </div>
          </div>
        )}

        {showBatchEdit && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <div className="w-full max-w-xl rounded-2xl border border-neutral-700 bg-neutral-950 p-5 shadow-2xl">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-black text-white">Batch Edit</h2>
                  <p className="mt-1 text-sm font-bold text-neutral-400">
                    {selectedItemIds.length} selected item(s). SKU, barcode, RFID and unique identifiers are kept out of batch edits for safety.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowBatchEdit(false)}
                  className="rounded-lg bg-neutral-800 px-3 py-2 text-xs font-black text-white hover:bg-neutral-700"
                >
                  Close
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-black uppercase text-neutral-500">Field</span>
                  <select
                    value={batchField}
                    onChange={(event) => setBatchField(event.target.value as any)}
                    className="h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm font-bold text-white outline-none"
                  >
                    {BATCH_EDIT_GROUPS.map((group) => (
                      <optgroup key={group} label={group}>
                        {BATCH_EDIT_FIELDS.filter((field) => field.group === group).map((field) => (
                          <option key={field.key} value={field.key}>
                            {field.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-black uppercase text-neutral-500">Mode</span>
                  <select
                    value={batchMode}
                    onChange={(event) => setBatchMode(event.target.value as any)}
                    className="h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm font-bold text-white outline-none"
                  >
                    <option value="set">Set value</option>
                    <option value="replace">Find and replace</option>
                  </select>
                </label>
              </div>

              {batchMode === 'replace' && (
                <label className="mt-3 block">
                  <span className="mb-1 block text-xs font-black uppercase text-neutral-500">Find</span>
                  <input
                    value={batchFind}
                    onChange={(event) => setBatchFind(event.target.value)}
                    className="h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm font-bold text-white outline-none"
                  />
                </label>
              )}

              <label className="mt-3 block">
                <span className="mb-1 block text-xs font-black uppercase text-neutral-500">
                  {batchMode === 'replace' ? 'Replace With' : 'New Value'}
                </span>
                <input
                  value={batchValue}
                  onChange={(event) => setBatchValue(event.target.value)}
                  className="h-12 w-full rounded-lg border border-neutral-700 bg-black px-3 text-lg font-black text-white outline-none"
                />
              </label>

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowBatchEdit(false)}
                  className="rounded-lg border border-neutral-700 px-4 py-2 text-sm font-black text-white hover:bg-neutral-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={applyBatchEdit}
                  disabled={batchBusy}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {batchBusy ? 'Applying...' : 'Apply Batch Edit'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </StaffPermissionGate>
  )
}



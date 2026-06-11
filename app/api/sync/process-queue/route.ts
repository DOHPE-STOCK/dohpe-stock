import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getLinnworksIntegrationConfig, shouldRunLinnworksRoute } from '@/lib/linnworksIntegrationSettings'
import { getEnabledIntegrationCompanies } from '@/lib/tenantCronCompanies'

export const dynamic = 'force-dynamic'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('Missing Supabase admin environment variables.')
  }

  return createClient(url, serviceKey)
}

async function authoriseLinnworks() {
  const applicationId = process.env.LINNWORKS_APP_ID
  const applicationSecret = process.env.LINNWORKS_APP_SECRET
  const token = process.env.LINNWORKS_APP_TOKEN

  if (!applicationId || !applicationSecret || !token) {
    throw new Error('Missing Linnworks environment variables.')
  }

  const response = await fetch('https://api.linnworks.net/api/Auth/AuthorizeByApplication', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      ApplicationId: applicationId,
      ApplicationSecret: applicationSecret,
      Token: token,
    }),
  })

  const data = await response.json()

  if (!response.ok || !data?.Token || !data?.Server) {
    throw new Error('Linnworks authorisation failed.')
  }

  return { server: data.Server, token: data.Token }
}

async function linnworksPost(server: string, token: string, path: string, body: any) {
  const response = await fetch(`${server}${path}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      Authorization: token,
    },
    body: JSON.stringify(body),
  })

  const text = await response.text()
  let data: any = null

  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }

  if (!response.ok) {
    throw new Error(`${path} failed: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  }

  return data
}

async function linnworksGet(server: string, token: string, path: string) {
  const response = await fetch(`${server}${path}`, {
    method: 'GET',
    headers: { accept: 'application/json', Authorization: token },
  })

  const text = await response.text()
  let data: any = null

  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }

  if (!response.ok) {
    throw new Error(`${path} failed: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  }

  return data
}

function normaliseText(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function normaliseNumber(value: any) {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

const DEFAULT_LOCATION_MAPPINGS: Record<string, string> = {
  'LOCATION-1': 'Default',
  'LOCATION-2': 'SHOP-1',
  'LOCATION-3': 'SHOP-2',
  'LOCATION-4': 'SHOP-3',
  'LOCATION-5': 'SHOP-4',
  WAREHOUSE: 'Default',
  DEFAULT: 'Default',
}

let activeLocationMappings = DEFAULT_LOCATION_MAPPINGS

type LocationBinMode = 'basic' | 'range'

type AppLocationSetting = {
  name: string
  label: string
  is_active: boolean
  bin_mode: LocationBinMode
  basic_bins: string[]
}

const DEFAULT_APP_LOCATION_SETTINGS: Record<string, AppLocationSetting> = {
  'LOCATION-1': { name: 'LOCATION-1', label: 'WAREHOUSE', is_active: true, bin_mode: 'range', basic_bins: ['Default'] },
  'LOCATION-2': { name: 'LOCATION-2', label: 'SHOP-1', is_active: true, bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
  'LOCATION-3': { name: 'LOCATION-3', label: 'SHOP-2', is_active: true, bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
  'LOCATION-4': { name: 'LOCATION-4', label: 'SHOP-3', is_active: true, bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
  'LOCATION-5': { name: 'LOCATION-5', label: 'SHOP-4', is_active: true, bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
}

let activeAppLocationSettings = DEFAULT_APP_LOCATION_SETTINGS


async function loadLocationMappings(supabase: any, companyId?: string | null) {
  let query = supabase
    .from('integration_settings')
    .select('settings')
    .eq('channel', 'linnworks')

  if (companyId) query = query.eq('company_id', companyId)

  const { data, error } = await query.maybeSingle()

  if (error) return DEFAULT_LOCATION_MAPPINGS

  const saved = data?.settings?.location_mapping || data?.settings?.location_mappings || {}
  const mappings: Record<string, string> = { ...DEFAULT_LOCATION_MAPPINGS }

  for (const [appLocation, linnworksLocation] of Object.entries(saved)) {
    const key = normaliseText(appLocation).toUpperCase()
    const value = normaliseText(linnworksLocation)
    if (key && value) mappings[key] = value
  }

  return mappings
}

async function loadAppLocationSettings(supabase: any, companyId?: string | null) {
  const settings: Record<string, AppLocationSetting> = {
    ...DEFAULT_APP_LOCATION_SETTINGS,
  }

  let query = supabase
    .from('locations')
    .select('name, label, is_active, bin_mode, basic_bins')
    .in('name', Object.keys(DEFAULT_APP_LOCATION_SETTINGS))

  if (companyId) query = query.eq('company_id', companyId)

  const { data, error } = await query

  if (error) return settings

  for (const row of data || []) {
    const name = normaliseText(row.name).toUpperCase()
    if (!/^LOCATION-\d+$/i.test(name)) continue

    settings[name] = {
      ...(settings[name] || {
        name,
        label: name,
        is_active: true,
        bin_mode: 'basic',
        basic_bins: ['Default'],
      }),
      name,
      label: normaliseText(row.label) || settings[name]?.label || name,
      is_active: row.is_active !== false,
      bin_mode: row.bin_mode === 'range' ? 'range' : 'basic',
      basic_bins: Array.isArray(row.basic_bins)
        ? row.basic_bins.map((bin: any) => normaliseText(bin)).filter(Boolean)
        : settings[name]?.basic_bins || ['Default'],
    }
  }

  return settings
}


function mapAppLocationToLinnworksLocation(locationName: string) {
  const value = normaliseText(locationName)
  const key = value.toUpperCase()

  if (!value) return 'Default'
  if (activeLocationMappings[key]) return activeLocationMappings[key]

  return value
}

function mapLinnworksLocationToAppLocation(locationName: string) {
  const value = normaliseText(locationName)
  const key = value.toUpperCase()

  if (!value || key === 'DEFAULT' || key === 'WAREHOUSE') {
    const warehouseEntry = Object.entries(activeLocationMappings).find(
      ([appLocation, mapped]) =>
        /^LOCATION-\d+$/i.test(appLocation) &&
        ['default', 'warehouse'].includes(normaliseText(mapped).toLowerCase())
    )

    return warehouseEntry?.[0] || 'LOCATION-1'
  }

  if (/^LOCATION-\d+$/i.test(value)) return key

  const locationEntry = Object.entries(activeLocationMappings).find(
    ([appLocation, mapped]) =>
      /^LOCATION-\d+$/i.test(appLocation) && normaliseText(mapped).toUpperCase() === key
  )

  if (locationEntry?.[0]) return locationEntry[0]

  const shopMatch = key.match(/^SHOP-(\d+)$/)
  if (shopMatch) return `LOCATION-${Number(shopMatch[1]) + 1}`

  return key
}

function normaliseAction(value: any) {
  return normaliseText(value).toLowerCase()
}

function getLocationName(row: any) {
  return normaliseText(
    row?.Location?.LocationName ||
      row?.Location?.locationName ||
      row?.LocationName ||
      row?.locationName ||
      row?.StockLocationName ||
      row?.stockLocationName ||
      row?.Name ||
      row?.name
  )
}

function getLocationId(row: any) {
  return (
    row?.Location?.StockLocationId ||
    row?.Location?.stockLocationId ||
    row?.Location?.pkStockLocationId ||
    row?.Location?.LocationId ||
    row?.Location?.locationId ||
    row?.StockLocationId ||
    row?.stockLocationId ||
    row?.pkStockLocationId ||
    row?.LocationId ||
    row?.locationId ||
    row?.FKStockLocationId ||
    row?.fkStockLocationId ||
    row?.Id ||
    row?.id ||
    null
  )
}

function getStockLevel(row: any) {
  return (
    normaliseNumber(row?.StockLevel) ??
    normaliseNumber(row?.stockLevel) ??
    normaliseNumber(row?.Level) ??
    normaliseNumber(row?.level) ??
    normaliseNumber(row?.Quantity) ??
    normaliseNumber(row?.quantity) ??
    normaliseNumber(row?.Available) ??
    normaliseNumber(row?.available) ??
    normaliseNumber(row?.OnHand) ??
    normaliseNumber(row?.onHand) ??
    normaliseNumber(row?.InStock) ??
    normaliseNumber(row?.inStock) ??
    0
  )
}

function getStockValue(row: any) {
  return (
    normaliseNumber(row?.StockValue) ??
    normaliseNumber(row?.stockValue) ??
    normaliseNumber(row?.Value) ??
    normaliseNumber(row?.value) ??
    null
  )
}

function getBinRack(row: any) {
  return normaliseText(
    row?.Location?.BinRack ||
      row?.Location?.binRack ||
      row?.BinRack ||
      row?.binRack ||
      row?.Binrack ||
      row?.binrack ||
      row?.Bin ||
      row?.bin
  )
}

function findStockItemIdFromData(data: any) {
  if (!data) return null

  if (Array.isArray(data)) {
    const first = data[0]
    return first?.StockItemId || first?.stockItemId || first?.Id || first?.id || null
  }

  return (
    data?.StockItemId ||
    data?.stockItemId ||
    data?.Id ||
    data?.id ||
    data?.Item?.StockItemId ||
    data?.item?.stockItemId ||
    null
  )
}

async function findLinnworksItemBySku(server: string, token: string, sku: string) {
  const data = await linnworksGet(
    server,
    token,
    `/api/Inventory/GetInventoryItem?sKU=${encodeURIComponent(sku)}`
  )

  return findStockItemIdFromData(data)
}

function findLocationId(locations: any[], locationName: string) {
  const wanted = mapAppLocationToLinnworksLocation(locationName).toLowerCase().trim()

  const match = locations.find((location) => {
    const possibleNames = [
      location.LocationName,
      location.locationName,
      location.Name,
      location.name,
      location.StockLocationName,
      location.stockLocationName,
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase().trim())

    return possibleNames.includes(wanted)
  })

  return getLocationId(match)
}

function findLocationNameById(locations: any[], locationId: string) {
  const wanted = locationId.toLowerCase().trim()

  const match = locations.find((location) => {
    const possibleIds = [
      location.StockLocationId,
      location.stockLocationId,
      location.pkStockLocationId,
      location.LocationId,
      location.locationId,
      location.Id,
      location.id,
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase().trim())

    return possibleIds.includes(wanted)
  })

  return match ? getLocationName(match) : ''
}

async function getInventoryItemLocations(server: string, token: string, stockItemId: string) {
  const data = await linnworksGet(
    server,
    token,
    `/api/Inventory/GetInventoryItemLocations?inventoryItemId=${encodeURIComponent(stockItemId)}`
  )

  return Array.isArray(data) ? data : []
}

async function getStockItemsFull(server: string, token: string, sku: string) {
  return await linnworksPost(server, token, '/api/Stock/GetStockItemsFull', {
    keyword: sku,
    searchTypes: ['SKU'],
    dataRequirements: ['StockLevels'],
    entriesPerPage: 1,
    pageNumber: 1,
    loadCompositeParents: false,
    loadVariationParents: false,
  })
}

function getStockItemsFromFullResponse(data: any) {
  if (!data) return []
  if (Array.isArray(data)) return data

  const candidates = [
    data.Data,
    data.data,
    data.Items,
    data.items,
    data.StockItems,
    data.stockItems,
    data.Results,
    data.results,
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
  }

  return [data]
}

function getStockLevelsFromFullItem(item: any) {
  const candidates = [
    item?.StockLevels,
    item?.stockLevels,
    item?.StockItemLevels,
    item?.stockItemLevels,
    item?.Levels,
    item?.levels,
    item?.Locations,
    item?.locations,
    item?.LocationStockLevels,
    item?.locationStockLevels,
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
  }

  return []
}

function getSkuFromFullItem(item: any) {
  return normaliseText(
    item?.SKU ||
      item?.Sku ||
      item?.sku ||
      item?.ItemNumber ||
      item?.itemNumber ||
      item?.ItemNumberSKU ||
      item?.itemNumberSKU
  )
}

async function getLinnworksStockRows(params: {
  server: string
  token: string
  sku: string
  stockItemId: string
  locations: any[]
}) {
  const { server, token, sku, stockItemId, locations } = params

  const [stockFullRaw, locationRows] = await Promise.all([
    getStockItemsFull(server, token, sku),
    getInventoryItemLocations(server, token, stockItemId),
  ])

  const fullItems = getStockItemsFromFullResponse(stockFullRaw)
  const fullItem =
    fullItems.find((item) => getSkuFromFullItem(item).toLowerCase() === sku.toLowerCase()) ||
    fullItems[0] ||
    null

  const stockLevelRows = fullItem ? getStockLevelsFromFullItem(fullItem) : []

  const mappedRows = stockLevelRows.map((stockRow) => {
    const locationId = getLocationId(stockRow)

    const matchingLocationRow = locationId
      ? locationRows.find(
          (row) =>
            String(getLocationId(row) || '').toLowerCase() === String(locationId).toLowerCase()
        )
      : null

    const locationName =
      getLocationName(stockRow) ||
      getLocationName(matchingLocationRow) ||
      (locationId ? findLocationNameById(locations, locationId) : '') ||
      ''

    return {
      raw: stockRow,
      locationRaw: matchingLocationRow,
      locationId,
      locationName,
      stockLevel: getStockLevel(stockRow),
      stockValue: getStockValue(stockRow),
      binRack: getBinRack(stockRow) || getBinRack(matchingLocationRow),
    }
  })

  return {
    stockFullRaw,
    fullItems,
    fullItem,
    stockLevelRows,
    locationRows,
    mappedRows,
  }
}

async function updateStockField(
  server: string,
  token: string,
  params: {
    stockItemId: string
    fieldName: string
    fieldValue: string | number
    locationId?: string | null
  }
) {
  const payload: any = {
    inventoryItemId: params.stockItemId,
    fieldName: params.fieldName,
    fieldValue: String(params.fieldValue),
    changeSource: 'Dohpe Stock App Queue',
  }

  if (params.locationId) {
    payload.locationId = params.locationId
  }

  return await linnworksPost(server, token, '/api/Inventory/UpdateInventoryItemStockField', payload)
}

async function getItemThumbnailUrl(supabase: any, itemId: string | null | undefined) {
  if (!itemId) return ''

  const { data, error } = await supabase
    .from('item_images')
    .select('processed_url, original_url')
    .eq('item_id', itemId)
    .order('image_order', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error || !data) return ''

  return normaliseText(data.processed_url || data.original_url)
}

async function sendTelegramMessage(message: string, photoUrl?: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!botToken || !chatId) {
    return { skipped: true, reason: 'Telegram env vars missing' }
  }

  const url = photoUrl
    ? `https://api.telegram.org/bot${botToken}/sendPhoto`
    : `https://api.telegram.org/bot${botToken}/sendMessage`

  const body = photoUrl
    ? {
        chat_id: chatId,
        photo: photoUrl,
        caption: message,
      }
    : {
        chat_id: chatId,
        text: message,
      }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Telegram send failed: ${text}`)
  }

  return { ok: true, with_photo: Boolean(photoUrl) }
}

function formatTelegramReason(payload: any) {
  const rawReason = normaliseText(payload.reason)

  if (!rawReason) return 'Stock update'

  const value = rawReason.toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ')

  if (value.includes('online') && value.includes('sale')) return 'Online sale'
  if (value.includes('stock update')) return 'Stock update'
  if (value.includes('manual')) return 'Manual adjustment'
  if (value.includes('loan')) return 'Loan'
  if (value.includes('pos cash sale')) return 'POS cash sale'
  if (value.includes('pos card sale')) return 'POS card sale'
  if (value.includes('pos exchange sale')) return 'POS exchange sale'
  if (value.includes('pos refund')) return 'POS refund'
  if (value.includes('pos exchange return')) return 'POS exchange return'

  return rawReason
}

function shouldSendTelegramForUpdateStock(payload: any) {
  const reason = normaliseText(payload.reason).toLowerCase()

  return reason === 'online_sale' || reason === 'stock_update'
}

function shouldApplyOperationalStockAdjustment(payload: any) {
  const reason = normaliseText(payload.reason).toLowerCase()

  return !reason.startsWith('transfer_reusable_')
}

function shouldPushDirectPayloadBinRack(payload: any) {
  const reason = normaliseText(payload.reason).toLowerCase()
  const bin = normaliseText(payload.bin)

  if (!bin) return false
  if (reason.startsWith('transfer_reusable_')) return false
  if (isPosSaleDeductionReason(reason) || isPosReturnIncrementReason(reason)) return false

  return true
}

function isPosSaleDeductionReason(reason: string) {
  return ['pos_cash_sale', 'pos_card_sale', 'pos_exchange_sale'].includes(reason)
}

function isPosReturnIncrementReason(reason: string) {
  return ['pos_refund', 'pos_exchange_return', 'pos_cash_refund', 'pos_card_refund'].includes(reason)
}

function getPreferredReturnLocation(payload: any, item: any) {
  return (
    normaliseText(payload.location) ||
    normaliseText(item?.current_location) ||
    'SHOP-1'
  )
}

function mapOperationalLocationToStoredLocation(locationName: string) {
  return mapLinnworksLocationToAppLocation(locationName)
}

function isShopLocationName(locationName: string) {
  return mapAppLocationToLinnworksLocation(locationName).toLowerCase().startsWith('shop-')
}

function canonicalAppLocationName(locationName: any) {
  const raw = normaliseText(locationName)
  if (!raw) return 'LOCATION-1'

  if (/^LOCATION-\d+$/i.test(raw)) return raw.toUpperCase()

  const mapped = mapLinnworksLocationToAppLocation(raw)
  if (/^LOCATION-\d+$/i.test(mapped)) return mapped.toUpperCase()

  return raw.toUpperCase()
}

function getAppLocationSetting(locationName: any) {
  const appLocation = canonicalAppLocationName(locationName)
  return (
    activeAppLocationSettings[appLocation] || {
      name: appLocation,
      label: appLocation,
      is_active: true,
      bin_mode: 'basic' as LocationBinMode,
      basic_bins: ['Default'],
    }
  )
}

function isRangeLocationName(locationName: any) {
  return getAppLocationSetting(locationName).bin_mode === 'range'
}

function isBasicLocationName(locationName: any) {
  return getAppLocationSetting(locationName).bin_mode !== 'range'
}

function splitNaturalParts(value: string) {
  return normaliseText(value)
    .toUpperCase()
    .split(/(\d+)/)
    .filter((part) => part.length > 0)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part))
}

function naturalBinCompare(a: any, b: any) {
  const left = splitNaturalParts(a)
  const right = splitNaturalParts(b)
  const max = Math.max(left.length, right.length)

  for (let index = 0; index < max; index += 1) {
    const aPart = left[index]
    const bPart = right[index]

    if (aPart === undefined) return -1
    if (bPart === undefined) return 1

    if (typeof aPart === 'number' && typeof bPart === 'number') {
      if (aPart !== bPart) return aPart - bPart
      continue
    }

    const aString = String(aPart)
    const bString = String(bPart)

    if (aString !== bString) return aString.localeCompare(bString)
  }

  return 0
}

async function getAppBinsForLocation(params: {
  supabase: any
  itemId?: string | null
  locationName: string
}) {
  const { supabase, itemId } = params
  const locationName = canonicalAppLocationName(params.locationName)

  if (!itemId) return []

  const { data, error } = await supabase
    .from('item_stock_locations')
    .select('location_name, bin_code, stock_level')
    .eq('item_id', itemId)
    .eq('location_name', locationName)

  if (error) throw new Error(error.message)

  return data || []
}

async function getLinnworksBinRackForLocation(params: {
  supabase: any
  itemId?: string | null
  locationName: string
}) {
  const locationName = canonicalAppLocationName(params.locationName)
  const setting = getAppLocationSetting(locationName)

  if (setting.bin_mode !== 'range') {
    return {
      shouldPush: false,
      value: '',
      reason: `${locationName} is a basic-bin location. Linnworks uses broad location stock only.`,
    }
  }

  const rows = await getAppBinsForLocation({
    supabase: params.supabase,
    itemId: params.itemId,
    locationName,
  })

  const bins = Array.from(
    new Set(
      rows
        .filter((row: any) => Number(row.stock_level || 0) > 0)
        .map((row: any) => normaliseText(row.bin_code))
        .filter(Boolean)
    )
  ).sort(naturalBinCompare)

  return {
    shouldPush: true,
    value: bins.join('|'),
    reason: bins.length > 0
      ? 'Range/allocate location: pushed active app bins to Linnworks BinRack.'
      : 'Range/allocate location: no active app bins remain, clearing Linnworks BinRack.',
  }
}


function sameLinnworksLocation(a: any, b: any) {
  const aRaw = normaliseText(a)
  const bRaw = normaliseText(b)

  if (!aRaw || !bRaw) return false

  const aAsLinnworks = mapAppLocationToLinnworksLocation(aRaw).toLowerCase()
  const bAsLinnworks = mapAppLocationToLinnworksLocation(bRaw).toLowerCase()

  if (aAsLinnworks && bAsLinnworks && aAsLinnworks === bAsLinnworks) return true

  const aAsApp = mapLinnworksLocationToAppLocation(aRaw).toUpperCase()
  const bAsApp = mapLinnworksLocationToAppLocation(bRaw).toUpperCase()

  return Boolean(aAsApp && bAsApp && aAsApp === bAsApp)
}

function getLinnworksLocationDisplay(value: any) {
  return mapAppLocationToLinnworksLocation(normaliseText(value) || 'Default')
}

function isTransferReusableReason(reason: string) {
  return reason === 'transfer_reusable_from_source' || reason === 'transfer_reusable_to_destination'
}

async function assertReusableTransferSourceAlreadyProcessed(params: {
  supabase: any
  row: any
  sku: string
  payload: any
}) {
  const transferId = normaliseText(params.payload.transfer_id)

  if (!transferId) return

  const { data, error } = await params.supabase
    .from('linnworks_sync_queue')
    .select('id, sku, status, error_message, payload, created_at')
    .eq('sku', params.sku)
    .order('created_at', { ascending: true })
    .limit(100)

  if (error) throw new Error(error.message)

  const sourceRow = (data || []).find((candidate: any) => {
    const candidatePayload = candidate.payload || {}

    return (
      normaliseText(candidatePayload.transfer_id) === transferId &&
      normaliseText(candidatePayload.reason).toLowerCase() === 'transfer_reusable_from_source'
    )
  })

  if (!sourceRow) {
    throw new Error(
      `Transfer ${transferId} destination increment is blocked because no source deduction queue row was found.`
    )
  }

  if (sourceRow.status !== 'processed') {
    throw new Error(
      `Transfer ${transferId} destination increment is blocked until source deduction is processed. Source status: ${sourceRow.status}. ${sourceRow.error_message || ''}`.trim()
    )
  }
}

function getOperationalDeductionPriority(locationName: string, reason: string) {
  if (isRangeLocationName(locationName)) {
    return []
  }

  const setting = getAppLocationSetting(locationName)
  const basicBins = setting.basic_bins.length > 0 ? setting.basic_bins : ['Default']
  const normalisedBasicBins = basicBins.map((bin) => normaliseText(bin) || 'Default')

  if (isShopLocationName(locationName) && isPosSaleDeductionReason(reason)) {
    const priority = ['FLOOR', 'STOCK', 'Default']
    return [
      ...priority.filter((bin) =>
        normalisedBasicBins.map((value) => value.toUpperCase()).includes(bin.toUpperCase())
      ),
      ...normalisedBasicBins.filter((bin) =>
        !priority.map((value) => value.toUpperCase()).includes(bin.toUpperCase())
      ),
    ]
  }

  return normalisedBasicBins
}

async function upsertOperationalStockRow(params: {
  supabase: any
  item: any
  locationName: string
  binCode: string
  nextStock: number
  source: string
}) {
  const { supabase, item, locationName, binCode, nextStock, source } = params
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('item_stock_locations')
    .select('id')
    .eq('item_id', item.id)
    .eq('location_name', locationName)
    .eq('bin_code', binCode)
    .limit(1)

  if (error) throw new Error(error.message)

  const existing = data?.[0]

  if (existing) {
    const { error: updateError } = await supabase
      .from('item_stock_locations')
      .update({
        stock_level: nextStock,
        source,
        updated_at: now,
      })
      .eq('id', existing.id)

    if (updateError) throw new Error(updateError.message)
    return
  }

  const { error: insertError } = await supabase
    .from('item_stock_locations')
    .insert({
      item_id: item.id,
      sku: item.sku,
      location_name: locationName,
      location_id: null,
      bin_code: binCode,
      stock_level: nextStock,
      source,
      synced_at: null,
      updated_at: now,
    })

  if (insertError) throw new Error(insertError.message)
}

async function recalcItemStockFromOperationalRows(supabase: any, item: any) {
  const { data, error } = await supabase
    .from('item_stock_locations')
    .select('location_name, bin_code, stock_level')
    .eq('item_id', item.id)

  if (error) throw new Error(error.message)

  const rows = data || []
  const total = rows.reduce((sum: number, row: any) => sum + Number(row.stock_level || 0), 0)
  const shopFloor = rows.reduce((sum: number, row: any) => {
    return isShopLocationName(row.location_name) && normaliseText(row.bin_code).toUpperCase() === 'FLOOR'
      ? sum + Number(row.stock_level || 0)
      : sum
  }, 0)
  const warehouse = rows.reduce((sum: number, row: any) => {
    const loc = mapAppLocationToLinnworksLocation(row.location_name).toLowerCase()
    return loc === 'default' || loc === 'warehouse'
      ? sum + Number(row.stock_level || 0)
      : sum
  }, 0)

  const displayRow = rows
    .filter((row: any) => Number(row.stock_level || 0) > 0)
    .sort((a: any, b: any) => Number(b.stock_level || 0) - Number(a.stock_level || 0))[0]

  const { error: updateError } = await supabase
    .from('items')
    .update({
      stock_level: total,
      shop_floor_stock: shopFloor,
      warehouse_stock: warehouse,
      current_location: displayRow?.location_name || item.current_location || null,
      current_bin: displayRow?.bin_code || item.current_bin || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', item.id)

  if (updateError) throw new Error(updateError.message)

  return { total, shopFloor, warehouse }
}

async function applyOperationalStockAdjustment(params: {
  supabase: any
  item: any
  payload: any
  delta: number
}) {
  const { supabase, item, payload, delta } = params
  const reason = normaliseText(payload.reason).toLowerCase()
  const locationName = mapOperationalLocationToStoredLocation(
    normaliseText(payload.location) || normaliseText(item?.current_location) || 'Default'
  )
  const requestedBin = normaliseText(payload.bin) || (isShopLocationName(locationName) ? 'FLOOR' : 'Default')

  const { data, error } = await supabase
    .from('item_stock_locations')
    .select('id, location_name, bin_code, stock_level')
    .eq('item_id', item.id)
    .eq('location_name', locationName)

  if (error) throw new Error(error.message)

  const rows = data || []

  if (delta > 0) {
    const existing = rows.find((row: any) => normaliseText(row.bin_code).toUpperCase() === requestedBin.toUpperCase())
    const nextStock = Number(existing?.stock_level || 0) + delta

    await upsertOperationalStockRow({
      supabase,
      item,
      locationName,
      binCode: requestedBin,
      nextStock,
      source: 'app_queue',
    })

    return await recalcItemStockFromOperationalRows(supabase, item)
  }

  const quantityToDeduct = Math.abs(delta)
  let remaining = quantityToDeduct

  const sortedRows = isRangeLocationName(locationName)
    ? [...rows].sort((a: any, b: any) => naturalBinCompare(a.bin_code, b.bin_code))
    : (() => {
        const priority = [requestedBin, ...getOperationalDeductionPriority(locationName, reason)]
        const uniquePriority = Array.from(new Set(priority.map((bin) => normaliseText(bin) || 'Default')))

        return uniquePriority
          .map((binCode) =>
            rows.find((candidate: any) => normaliseText(candidate.bin_code).toUpperCase() === binCode.toUpperCase())
          )
          .filter(Boolean)
      })()

  for (const row of sortedRows) {
    if (remaining <= 0) break

    const currentStock = Number(row.stock_level || 0)
    if (currentStock <= 0) continue

    const deduction = Math.min(currentStock, remaining)
    const nextStock = currentStock - deduction

    await upsertOperationalStockRow({
      supabase,
      item,
      locationName,
      binCode: row.bin_code,
      nextStock,
      source: 'app_queue',
    })

    remaining -= deduction
  }

  if (remaining > 0) {
    throw new Error(
      `${item.sku} has insufficient app stock in ${locationName}. Needed ${quantityToDeduct}, short by ${remaining}.`
    )
  }

  return await recalcItemStockFromOperationalRows(supabase, item)
}


function getLocationPriority(locationName: string, payload: any, item: any) {
  const value = locationName.toLowerCase()
  const reason = normaliseText(payload.reason).toLowerCase()
  const payloadLocation = normaliseText(payload.location).toLowerCase()
  const itemLocation = normaliseText(item?.current_location).toLowerCase()
  const saleLocation = normaliseText(payload.sale_location).toLowerCase()

  if (saleLocation && value === saleLocation) return 0
  if (payloadLocation && value === payloadLocation) return 1
  if (itemLocation && value === itemLocation) return 2

  if (isPosSaleDeductionReason(reason)) {
    if (value === 'default') return 3
    if (value.startsWith('shop') || value.includes('shop-')) return 4
    if (value.includes('warehouse')) return 5
    if (value.includes('transit')) return 9
    return 6
  }

  if (value.startsWith('shop') || value.includes('shop-')) return 3
  if (value.includes('warehouse')) return 4
  if (value === 'default') return 5
  if (value.includes('transit')) return 9

  return 6
}

function chooseLocationForAdjustment(params: {
  stockRows: any[]
  payload: any
  item: any
  delta: number
}) {
  const { stockRows, payload, item, delta } = params

  const reason = normaliseText(payload.reason).toLowerCase()

  const rawWantedLocation =
    normaliseText(payload.location) ||
    normaliseText(payload.sale_location) ||
    ''

  const wantedLocation = getLinnworksLocationDisplay(rawWantedLocation)
  const rowsWithStock = stockRows.filter((row) => row.locationId && row.stockLevel > 0)

  const findMatchingLocation = (wanted: string) => {
    if (!wanted) return null

    return (
      stockRows.find((row) => sameLinnworksLocation(row.locationName, wanted)) ||
      stockRows.find((row) => sameLinnworksLocation(row.locationName, mapLinnworksLocationToAppLocation(wanted))) ||
      null
    )
  }

  if (delta < 0) {
    if (rawWantedLocation || wantedLocation) {
      const exactWanted = findMatchingLocation(rawWantedLocation) || findMatchingLocation(wantedLocation)

      if (exactWanted && exactWanted.stockLevel > 0) {
        return {
          ...exactWanted,
          newStockLevel: Math.max(0, exactWanted.stockLevel + delta),
          selectionReason: isTransferReusableReason(reason)
            ? 'transfer_source_location_had_linnworks_stock'
            : 'wanted_location_had_stock',
        }
      }

      if (payload.strict_location === true) {
        throw new Error(
          `Wanted location ${wantedLocation || rawWantedLocation} has no Linnworks stock for ${payload.sku || item?.sku}. Refusing to deduct from another location.`
        )
      }
    }

    if (rowsWithStock.length === 1) {
      const selected = rowsWithStock[0]

      return {
        ...selected,
        newStockLevel: Math.max(0, selected.stockLevel + delta),
        selectionReason: 'only_location_with_stock',
      }
    }

    if (rowsWithStock.length > 1) {
      const sorted = [...rowsWithStock].sort((a, b) => {
        const priorityA = getLocationPriority(a.locationName, payload, item)
        const priorityB = getLocationPriority(b.locationName, payload, item)

        if (priorityA !== priorityB) return priorityA - priorityB
        return b.stockLevel - a.stockLevel
      })

      const selected = sorted[0]

      return {
        ...selected,
        newStockLevel: Math.max(0, selected.stockLevel + delta),
        selectionReason: isPosSaleDeductionReason(reason)
          ? 'best_pos_sale_location_with_stock'
          : 'best_location_with_stock',
      }
    }

    throw new Error('No Linnworks location has stock available to deduct.')
  }

  if (delta > 0) {
    const preferredReturnLocation = isPosReturnIncrementReason(reason)
      ? getPreferredReturnLocation(payload, item)
      : (rawWantedLocation || wantedLocation)

    if (preferredReturnLocation) {
      const exactWanted =
        findMatchingLocation(preferredReturnLocation) ||
        findMatchingLocation(mapAppLocationToLinnworksLocation(preferredReturnLocation))

      if (exactWanted) {
        return {
          ...exactWanted,
          newStockLevel: exactWanted.stockLevel + delta,
          selectionReason: isTransferReusableReason(reason)
            ? 'transfer_destination_location'
            : isPosReturnIncrementReason(reason)
              ? 'pos_return_to_current_shop_location'
              : 'wanted_location_for_increment',
        }
      }
    }

    if (isPosReturnIncrementReason(reason)) {
      const shopOneRow = stockRows.find((row) => sameLinnworksLocation(row.locationName, 'SHOP-1'))

      if (shopOneRow) {
        return {
          ...shopOneRow,
          newStockLevel: shopOneRow.stockLevel + delta,
          selectionReason: 'pos_return_fallback_to_shop_1',
        }
      }
    }

    const itemLocation = normaliseText(item?.current_location)

    if (itemLocation) {
      const itemLocationRow = findMatchingLocation(itemLocation)

      if (itemLocationRow) {
        return {
          ...itemLocationRow,
          newStockLevel: itemLocationRow.stockLevel + delta,
          selectionReason: 'item_current_location_for_increment',
        }
      }
    }

    const defaultRow =
      stockRows.find((row) => sameLinnworksLocation(row.locationName, 'Default')) ||
      stockRows[0]

    if (!defaultRow?.locationId) {
      throw new Error('Could not find a Linnworks location to increment.')
    }

    return {
      ...defaultRow,
      newStockLevel: defaultRow.stockLevel + delta,
      selectionReason: 'fallback_increment_location',
    }
  }

  throw new Error('Delta cannot be 0.')
}

async function processDebugLocationsQueueRow(params: {
  row: any
  server: string
  token: string
  locations: any[]
}) {
  const { row, server, token, locations } = params
  const payload = row.payload || {}

  const sku = normaliseText(payload.sku || row.sku)
  if (!sku) throw new Error('Missing SKU in queue payload.')

  const stockItemId =
    normaliseText(payload.linnworks_item_id) ||
    normaliseText(payload.stockItemId) ||
    (await findLinnworksItemBySku(server, token, sku))

  if (!stockItemId) {
    throw new Error(`Could not find Linnworks item for SKU ${sku}`)
  }

  const rawLocationRows = await getInventoryItemLocations(server, token, stockItemId)

  const mappedRows = rawLocationRows.map((row) => {
    const locationId = getLocationId(row)

    return {
      raw: row,
      detected_location_id: locationId,
      detected_location_name:
        getLocationName(row) ||
        (locationId ? findLocationNameById(locations, locationId) : ''),
      detected_stock_level: getStockLevel(row),
      detected_binrack: getBinRack(row),
      raw_keys: Object.keys(row || {}),
    }
  })

  return {
    sku,
    stockItemId,
    note: 'Inventory/GetInventoryItemLocations does not include stock quantity. Use debug_stock_full for live stock levels.',
    rawLocationRows,
    mappedRows,
  }
}

async function processDebugStockFullQueueRow(params: {
  row: any
  server: string
  token: string
  locations: any[]
}) {
  const { row, server, token, locations } = params
  const payload = row.payload || {}

  const sku = normaliseText(payload.sku || row.sku)
  if (!sku) throw new Error('Missing SKU in queue payload.')

  const stockItemId =
    normaliseText(payload.linnworks_item_id) ||
    normaliseText(payload.stockItemId) ||
    (await findLinnworksItemBySku(server, token, sku))

  if (!stockItemId) {
    throw new Error(`Could not find Linnworks item for SKU ${sku}`)
  }

  const stockData = await getLinnworksStockRows({
    server,
    token,
    sku,
    stockItemId,
    locations,
  })

  return {
    sku,
    stockItemId,
    stockFullRaw: stockData.stockFullRaw,
    stockLevelRows: stockData.stockLevelRows,
    locationRows: stockData.locationRows,
    mappedRows: stockData.mappedRows,
  }
}

async function processAdjustStockQueueRow(params: {
  row: any
  supabase: any
  server: string
  token: string
  locations: any[]
}) {
  const { row, supabase, server, token, locations } = params
  const payload = row.payload || {}

  const sku = normaliseText(payload.sku || row.sku)
  if (!sku) throw new Error('Missing SKU in queue payload.')

  const delta = normaliseNumber(payload.delta)

  if (delta === null || delta === 0) {
    throw new Error('adjust_stock requires payload.delta, for example -1 or 1.')
  }

  const reason = normaliseText(payload.reason).toLowerCase()

  if (reason === 'transfer_reusable_to_destination') {
    await assertReusableTransferSourceAlreadyProcessed({
      supabase,
      row,
      sku,
      payload,
    })
  }

  const stockItemId =
    normaliseText(payload.linnworks_item_id) ||
    normaliseText(payload.stockItemId) ||
    (await findLinnworksItemBySku(server, token, sku))

  if (!stockItemId) {
    throw new Error(`Could not find Linnworks item for SKU ${sku}`)
  }

  const itemResult = await supabase
    .from('items')
    .select('id, sku, brand, reporting_category, cost_price, stock_level, current_location, current_bin')
    .eq('sku', sku)
    .maybeSingle()

  if (itemResult.error) throw new Error(itemResult.error.message)

  const item = itemResult.data

  const stockData = await getLinnworksStockRows({
    server,
    token,
    sku,
    stockItemId,
    locations,
  })

  if (stockData.mappedRows.length === 0) {
    throw new Error('No Linnworks stock-level rows returned from GetStockItemsFull.')
  }

  const selected = chooseLocationForAdjustment({
    stockRows: stockData.mappedRows,
    payload: { ...payload, sku },
    item,
    delta,
  })

  const expectedLocation = mapAppLocationToLinnworksLocation(
    normaliseText(payload.location) ||
      normaliseText(payload.sale_location) ||
      normaliseText(item?.current_location) ||
      ''
  )

  const usedFallbackLocation =
    delta < 0 &&
    isPosSaleDeductionReason(reason) &&
    expectedLocation &&
    selected.locationName.toLowerCase() !== expectedLocation.toLowerCase()

  const costPrice = normaliseNumber(item?.cost_price) ?? 0
  const stockValue = Number((selected.newStockLevel * costPrice).toFixed(2))

  const results: any = {}

  results.stock_level = await updateStockField(server, token, {
    stockItemId,
    fieldName: 'StockLevel',
    fieldValue: selected.newStockLevel,
    locationId: selected.locationId,
  })

  results.stock_value = await updateStockField(server, token, {
    stockItemId,
    fieldName: 'StockValue',
    fieldValue: stockValue,
    locationId: selected.locationId,
  })

  if (item?.id && shouldApplyOperationalStockAdjustment(payload)) {
    results.app_operational_stock = await applyOperationalStockAdjustment({
      supabase,
      item,
      payload,
      delta,
    })
  } else if (item?.id) {
    results.app_operational_stock = {
      skipped: true,
      reason: 'Local transfer stock is adjusted when the transfer is received.',
    }
  }

  const selectedAppLocation = mapLinnworksLocationToAppLocation(selected.locationName)
  const binRackFromAppBins = await getLinnworksBinRackForLocation({
    supabase,
    itemId: item?.id,
    locationName: selectedAppLocation,
  })

  if (binRackFromAppBins.shouldPush) {
    results.binrack = await updateStockField(server, token, {
      stockItemId,
      fieldName: 'BinRack',
      fieldValue: binRackFromAppBins.value,
      locationId: selected.locationId,
    })
  } else if (shouldPushDirectPayloadBinRack(payload)) {
    results.binrack = await updateStockField(server, token, {
      stockItemId,
      fieldName: 'BinRack',
      fieldValue: normaliseText(payload.bin),
      locationId: selected.locationId,
    })
  } else {
    results.binrack = {
      skipped: true,
      reason: binRackFromAppBins.reason || 'BinRack update not needed for this adjust_stock action.',
    }
  }

  if (usedFallbackLocation) {
    try {
      const thumbnailUrl = await getItemThumbnailUrl(supabase, item?.id)

      results.location_mismatch_telegram = await sendTelegramMessage(
        `⚠️ POS stock location mismatch\n\nSKU: ${sku}\nBrand: ${normaliseText(item?.brand) || 'Unknown'}\nCategory: ${normaliseText(item?.reporting_category) || 'Unknown'}\nSale: ${normaliseText(payload.sale_number) || normaliseText(payload.sale_id) || 'Unknown'}\nReason: ${formatTelegramReason(payload)}\nExpected location: ${expectedLocation}\nDeducted from: ${selected.locationName}\nStock at selected location: ${selected.stockLevel} → ${selected.newStockLevel}`,
        thumbnailUrl
      )
    } catch (error: any) {
      results.location_mismatch_telegram = { ok: false, error: error.message }
    }
  }

  return {
    sku,
    stockItemId,
    action: 'adjust_stock',
    delta,
    previousLocationStock: selected.stockLevel,
    newLocationStock: selected.newStockLevel,
    locationName: selected.locationName,
    locationId: selected.locationId,
    selectionReason: selected.selectionReason,
    expectedLocation,
    usedFallbackLocation,
    telegram: usedFallbackLocation
      ? results.location_mismatch_telegram
      : {
          skipped: true,
          reason: 'No Telegram notification needed for this adjust_stock action',
        },
    stockRowsUsed: stockData.mappedRows,
    results,
  }
}

async function processUpdateStockQueueRow(params: {
  row: any
  supabase: any
  server: string
  token: string
  locations: any[]
}) {
  const { row, supabase, server, token, locations } = params
  const payload = row.payload || {}

  const sku = normaliseText(payload.sku || row.sku)
  if (!sku) throw new Error('Missing SKU in queue payload.')

  const stockItemId =
    normaliseText(payload.linnworks_item_id) ||
    normaliseText(payload.stockItemId) ||
    (await findLinnworksItemBySku(server, token, sku))

  if (!stockItemId) {
    throw new Error(`Could not find Linnworks item for SKU ${sku}`)
  }

  const itemResult = await supabase
    .from('items')
    .select('id, sku, brand, reporting_category, cost_price, stock_level, current_location, current_bin')
    .eq('sku', sku)
    .maybeSingle()

  if (itemResult.error) throw new Error(itemResult.error.message)

  const item = itemResult.data

  const previousStockLevel = normaliseNumber(item?.stock_level) ?? 0

  const stockLevel =
    normaliseNumber(payload.stock_level) ??
    normaliseNumber(item?.stock_level) ??
    0

  const costPrice = normaliseNumber(item?.cost_price) ?? 0
  const stockValue = Number((stockLevel * costPrice).toFixed(2))

  const appLocationName =
    normaliseText(payload.location) ||
    normaliseText(item?.current_location) ||
    'Default'

  const locationName = mapAppLocationToLinnworksLocation(appLocationName)

  const binRack =
    normaliseText(payload.bin) ||
    normaliseText(item?.current_bin) ||
    'Default'

  const locationId = findLocationId(locations, locationName)

  if (!locationId) {
    throw new Error(`Linnworks location not found: ${locationName}`)
  }

  const results: any = {}

  results.stock_level = await updateStockField(server, token, {
    stockItemId,
    fieldName: 'StockLevel',
    fieldValue: stockLevel,
    locationId,
  })

  results.stock_value = await updateStockField(server, token, {
    stockItemId,
    fieldName: 'StockValue',
    fieldValue: stockValue,
    locationId,
  })

  const binRackFromAppBins = await getLinnworksBinRackForLocation({
    supabase,
    itemId: item?.id,
    locationName: appLocationName,
  })

  if (binRackFromAppBins.shouldPush) {
    results.binrack = await updateStockField(server, token, {
      stockItemId,
      fieldName: 'BinRack',
      fieldValue: binRackFromAppBins.value || binRack,
      locationId,
    })
  } else {
    results.binrack = {
      skipped: true,
      reason: binRackFromAppBins.reason,
    }
  }

  if (shouldSendTelegramForUpdateStock(payload)) {
    try {
      const thumbnailUrl = await getItemThumbnailUrl(supabase, item?.id)
      const reason = formatTelegramReason(payload)

      results.telegram = await sendTelegramMessage(
        `SKU: ${sku}
Brand: ${normaliseText(item?.brand) || 'Unknown'}
Category: ${normaliseText(item?.reporting_category) || 'Unknown'}
Reason: ${reason}
Stock: ${previousStockLevel} → ${stockLevel}
Location: ${locationName}
Bin: ${binRack}`,
        thumbnailUrl
      )
    } catch (error: any) {
      results.telegram = { ok: false, error: error.message }
    }
  } else {
    results.telegram = {
      skipped: true,
      reason: 'Telegram disabled unless reason is online_sale or stock_update',
    }
  }

  await supabase
    .from('items')
    .update({
      stock_level: stockLevel,
      current_location: appLocationName,
      current_bin: binRack,
      linnworks_location_sync_status: 'synced',
      linnworks_location_synced_at: new Date().toISOString(),
      linnworks_status: 'synced',
      linnworks_sync_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('sku', sku)

  return {
    sku,
    stockItemId,
    action: 'update_stock',
    previousStockLevel,
    stockLevel,
    stockValue,
    locationName,
    locationId,
    binRack,
    results,
  }
}

async function processUpdateLocationQueueRow(params: {
  row: any
  supabase: any
  server: string
  token: string
  locations: any[]
}) {
  const { row, supabase, server, token, locations } = params
  const payload = row.payload || {}

  const sku = normaliseText(payload.sku || row.sku)
  if (!sku) throw new Error('Missing SKU in queue payload.')

  const appLocationName =
    normaliseText(payload.location) ||
    'WAREHOUSE'

  const linnworksLocationName = mapAppLocationToLinnworksLocation(appLocationName)

  const binRack =
    normaliseText(payload.bin) ||
    'Default'

  const stockItemId =
    normaliseText(payload.linnworks_item_id) ||
    normaliseText(payload.stockItemId) ||
    (await findLinnworksItemBySku(server, token, sku))

  if (!stockItemId) {
    throw new Error(`Could not find Linnworks item for SKU ${sku}`)
  }

  const locationId = findLocationId(locations, linnworksLocationName)

  if (!locationId) {
    throw new Error(`Linnworks location not found: ${linnworksLocationName}`)
  }

  const results: any = {}

  const binRackFromAppBins = await getLinnworksBinRackForLocation({
    supabase,
    itemId: null,
    locationName: appLocationName,
  })

  if (binRackFromAppBins.shouldPush || shouldPushDirectPayloadBinRack(payload)) {
    results.binrack = await updateStockField(server, token, {
      stockItemId,
      fieldName: 'BinRack',
      fieldValue: binRack,
      locationId,
    })
  } else {
    results.binrack = {
      skipped: true,
      reason: binRackFromAppBins.reason || 'No BinRack update needed for this location mode.',
    }
  }

  const now = new Date().toISOString()

  const { data: item, error: itemReadError } = await supabase
    .from('items')
    .select('id, sku')
    .eq('sku', sku)
    .maybeSingle()

  if (itemReadError) throw new Error(itemReadError.message)

  const { error: itemUpdateError } = await supabase
    .from('items')
    .update({
      current_location: appLocationName,
      current_bin: binRack,
      linnworks_location_sync_status: 'synced',
      linnworks_location_synced_at: now,
      linnworks_status: 'synced',
      linnworks_sync_error: null,
      updated_at: now,
    })
    .eq('sku', sku)

  if (itemUpdateError) throw new Error(itemUpdateError.message)

  if (item?.id) {
    try {
      const { data: existingRows, error: existingError } = await supabase
        .from('item_stock_locations')
        .select('id, stock_level')
        .eq('item_id', item.id)
        .eq('location_name', mapOperationalLocationToStoredLocation(linnworksLocationName))
        .limit(1)

      if (!existingError) {
        const existing = existingRows?.[0]

        if (existing) {
          await supabase
            .from('item_stock_locations')
            .update({
              bin_code: binRack,
              updated_at: now,
            })
            .eq('id', existing.id)
        } else {
          await supabase
            .from('item_stock_locations')
            .insert({
              item_id: item.id,
              sku,
              location_name: mapOperationalLocationToStoredLocation(linnworksLocationName),
              location_id: locationId,
              bin_code: binRack,
              stock_level: 0,
              source: 'app_location_update',
              synced_at: now,
              updated_at: now,
            })
        }
      }
    } catch {
      // item_stock_locations may not exist yet in older deployments. Do not fail location sync for that.
    }
  }

  return {
    sku,
    stockItemId,
    action: 'update_location',
    appLocationName,
    linnworksLocationName,
    locationId,
    binRack,
    results,
  }
}

async function processQueue(request: Request, companyId?: string | null) {
  const startedAt = new Date().toISOString()

  try {
    const supabase = getSupabaseAdmin()
    const integrationConfig = await getLinnworksIntegrationConfig(supabase, companyId)
    const integrationGate = shouldRunLinnworksRoute({
      config: integrationConfig,
      route: 'process_queue',
      manual: new URL(request.url).searchParams.get('manual') === 'true',
    })

    if (!integrationGate.ok) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        message: integrationGate.reason,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      })
    }
    activeLocationMappings = await loadLocationMappings(supabase, companyId)
    activeAppLocationSettings = await loadAppLocationSettings(supabase, companyId)

    const body = await request.json().catch(() => ({}))
    const limit = Math.min(Number(body.limit || 10), 50)

    const { data: queueRows, error: queueError } = await supabase
      .from('linnworks_sync_queue')
      .select('*')
      .eq('status', 'pending')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true })
      .limit(limit)

    if (queueError) {
      throw new Error(queueError.message)
    }

    const rows = queueRows || []

    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No pending Linnworks queue rows.',
        processed: 0,
        started_at: startedAt,
      })
    }

    const { server, token } = await authoriseLinnworks()
    const locations = await linnworksGet(server, token, '/api/Inventory/GetStockLocations')

    const results = []

    for (const row of rows) {
      await supabase
        .from('linnworks_sync_queue')
        .update({
          status: 'processing',
          attempts: Number(row.attempts || 0) + 1,
          error_message: null,
        })
        .eq('id', row.id)

      try {
        let result: any = null
        const action = normaliseAction(row.action)

        if (action === 'debug_stock_full') {
          result = await processDebugStockFullQueueRow({
            row,
            server,
            token,
            locations: Array.isArray(locations) ? locations : [],
          })
        } else if (action === 'debug_locations') {
          result = await processDebugLocationsQueueRow({
            row,
            server,
            token,
            locations: Array.isArray(locations) ? locations : [],
          })
        } else if (action === 'adjust_stock') {
          result = await processAdjustStockQueueRow({
            row,
            supabase,
            server,
            token,
            locations: Array.isArray(locations) ? locations : [],
          })
        } else if (action === 'update_stock') {
          result = await processUpdateStockQueueRow({
            row,
            supabase,
            server,
            token,
            locations: Array.isArray(locations) ? locations : [],
          })
        } else if (action === 'update_location') {
          result = await processUpdateLocationQueueRow({
            row,
            supabase,
            server,
            token,
            locations: Array.isArray(locations) ? locations : [],
          })
        } else {
          throw new Error(`Unsupported queue action: ${row.action}`)
        }

        await supabase
          .from('linnworks_sync_queue')
          .update({
            status: 'processed',
            processed_at: new Date().toISOString(),
            error_message: null,
          })
          .eq('id', row.id)

        results.push({
          id: row.id,
          sku: row.sku,
          action: row.action,
          ok: true,
          result,
        })
      } catch (error: any) {
        await supabase
          .from('linnworks_sync_queue')
          .update({
            status: 'failed',
            error_message: error.message || 'Unknown queue processing error.',
            processed_at: new Date().toISOString(),
          })
          .eq('id', row.id)

        await supabase
        .from('items')
        .update({
            linnworks_location_sync_status: 'failed',
            linnworks_sync_error: error.message || 'Unknown queue processing error.',
            updated_at: new Date().toISOString(),
        })
        .eq('sku', row.sku)
        .eq('company_id', companyId)

        results.push({
          id: row.id,
          sku: row.sku,
          action: row.action,
          ok: false,
          error: error.message || 'Unknown queue processing error.',
        })
      }
    }

    return NextResponse.json({
      ok: true,
      company_id: companyId || null,
      processed: results.filter((row) => row.ok).length,
      failed: results.filter((row) => !row.ok).length,
      results,
    })
  } catch (error: any) {
    console.error('LINNWORKS_QUEUE_PROCESS_ERROR', error)

    return NextResponse.json(
      {
        ok: false,
        message: error.message || 'Unknown Linnworks queue processing error.',
      },
      { status: 500 }
    )
  }
}

async function processQueueForAllCompanies(request: Request) {
  const supabase = getSupabaseAdmin()
  const manual = new URL(request.url).searchParams.get('manual') === 'true'
  const companies = await getEnabledIntegrationCompanies(supabase, 'linnworks', manual)

  if (companies.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      message: 'No active companies have Linnworks auto-sync enabled.',
      processed_companies: 0,
      results: [],
    })
  }

  const results = []

  for (const company of companies) {
    const response = await processQueue(request.clone(), company.id)
    const payload = await response.json().catch(() => ({
      ok: false,
      message: `Unexpected response status ${response.status}`,
    }))

    results.push({
      company_id: company.id,
      company_name: company.name,
      company_slug: company.slug,
      status: response.status,
      ...payload,
    })
  }

  return NextResponse.json({
    ok: results.every((result) => result.ok),
    processed_companies: results.length,
    results,
  })
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, message: 'Unauthorised.' }, { status: 401 })
  }

  return processQueueForAllCompanies(request)
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, message: 'Unauthorised.' }, { status: 401 })
  }

  return processQueueForAllCompanies(request)
}

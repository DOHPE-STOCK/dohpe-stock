import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getLinnworksIntegrationConfig, shouldRunLinnworksRoute } from '@/lib/linnworksIntegrationSettings'
import { getEnabledIntegrationCompanies } from '@/lib/tenantCronCompanies'

export const dynamic = 'force-dynamic'

const DEFAULT_LOCATION_ID = '00000000-0000-0000-0000-000000000000'
const WAREHOUSE_LOCATION = 'WAREHOUSE'
const WAREHOUSE_BIN = 'Default'
const TRANSFER_REASON = 'online_order_pick'
const PENDING_TRANSFER_STATUS = 'pending_pick'
const PICKED_ITEM_STATUS = 'picked'
const PENDING_ITEM_STATUS = 'pending_pick'

type AppStockRow = {
  id: string
  item_id: string
  sku: string
  location_name: string
  bin_code: string
  stock_level: number
}

type Deduction = {
  location_name: string
  bin_code: string
  quantity: number
  row_id: string
}

type LocationSetting = {
  name: string
  label: string
  is_active: boolean
  bin_mode: 'basic' | 'range'
  basic_bins: string[]
}

const DEFAULT_LOCATION_SETTINGS: LocationSetting[] = [
  { name: 'LOCATION-1', label: 'WAREHOUSE', is_active: true, bin_mode: 'range', basic_bins: ['Default'] },
  { name: 'LOCATION-2', label: 'SHOP-1', is_active: true, bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
  { name: 'LOCATION-3', label: 'SHOP-2', is_active: true, bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
  { name: 'LOCATION-4', label: 'SHOP-3', is_active: true, bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
  { name: 'LOCATION-5', label: 'SHOP-4', is_active: true, bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
]


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

  const responseText = await response.text()
  let data: any = null

  try {
    data = responseText ? JSON.parse(responseText) : null
  } catch {
    data = responseText
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

async function loadLocationMappings(supabase: any, companyId?: string) {
  let query = supabase
    .from('integration_settings')
    .select('settings')
    .eq('channel', 'linnworks')

  if (companyId) query = query.eq('company_id', companyId)

  const { data, error } = await query
    .maybeSingle()

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


async function loadLocationSettings(supabase: any, companyId?: string) {
  const settings = new Map<string, LocationSetting>()

  for (const location of DEFAULT_LOCATION_SETTINGS) {
    settings.set(location.name.toUpperCase(), {
      ...location,
      basic_bins: [...location.basic_bins],
    })
  }

  let query = supabase
    .from('locations')
    .select('name, label, is_active, bin_mode, basic_bins')

  if (companyId) query = query.eq('company_id', companyId)

  const { data, error } = await query

  if (error) return settings

  for (const row of data || []) {
    const name = normaliseText(row.name).toUpperCase()
    if (!name) continue

    const existing = settings.get(name)

    settings.set(name, {
      name,
      label: normaliseText(row.label) || existing?.label || name,
      is_active: row.is_active !== false,
      bin_mode: row.bin_mode === 'range' ? 'range' : 'basic',
      basic_bins: Array.isArray(row.basic_bins) && row.basic_bins.length > 0
        ? row.basic_bins.map((bin: any) => normaliseText(bin).toUpperCase()).filter(Boolean)
        : existing?.basic_bins || ['Default'],
    })
  }

  return settings
}

function getLocationSetting(
  locationSettings: Map<string, LocationSetting>,
  locationName: any
) {
  const storage = appStorageLocation(locationName)
  return (
    locationSettings.get(storage.toUpperCase()) ||
    DEFAULT_LOCATION_SETTINGS.find((location) => location.name === storage.toUpperCase()) ||
    null
  )
}

function isRangeLocation(
  locationSettings: Map<string, LocationSetting>,
  locationName: any
) {
  return getLocationSetting(locationSettings, locationName)?.bin_mode === 'range'
}

function getBasicBinPriority(
  locationSettings: Map<string, LocationSetting>,
  locationName: any
) {
  const setting = getLocationSetting(locationSettings, locationName)
  const configuredBins = setting?.basic_bins?.length ? setting.basic_bins : ['Default']

  return configuredBins.map((bin) => normaliseText(bin).toUpperCase()).filter(Boolean)
}

function splitBinParts(value: string) {
  return normaliseText(value)
    .toUpperCase()
    .split(/(\d+)/)
    .filter((part) => part.length > 0)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part))
}

function compareNaturalBin(a: string, b: string) {
  const ap = splitBinParts(a)
  const bp = splitBinParts(b)
  const max = Math.max(ap.length, bp.length)

  for (let i = 0; i < max; i += 1) {
    const av = ap[i]
    const bv = bp[i]

    if (av === undefined) return -1
    if (bv === undefined) return 1

    if (typeof av === 'number' && typeof bv === 'number') {
      if (av !== bv) return av - bv
      continue
    }

    const as = String(av)
    const bs = String(bv)

    if (as !== bs) return as.localeCompare(bs, undefined, { numeric: true, sensitivity: 'base' })
  }

  return 0
}

function mapAppLocationToLinnworksLocation(locationName: string) {
  const value = normaliseText(locationName)
  const key = value.toUpperCase()

  if (!value) return 'Default'
  if (activeLocationMappings[key]) return activeLocationMappings[key]
  if (key === 'WAREHOUSE') return 'Default'
  return value
}

function canonicalLocation(value: any) {
  const clean = mapAppLocationToLinnworksLocation(value)
  const lower = clean.toLowerCase()

  if (!clean) return WAREHOUSE_LOCATION
  if (lower === 'default' || lower === 'warehouse') return WAREHOUSE_LOCATION

  return clean.toUpperCase().startsWith('SHOP-') ? clean.toUpperCase() : clean
}

function appStorageLocation(value: any) {
  const clean = normaliseText(value)
  const key = clean.toUpperCase()

  if (!clean) return 'LOCATION-1'
  if (/^LOCATION-\d+$/i.test(clean)) return key

  if (key === 'DEFAULT' || key === 'WAREHOUSE') {
    const warehouseEntry = Object.entries(activeLocationMappings).find(([, mapped]) => {
      const mappedKey = normaliseText(mapped).toUpperCase()
      return mappedKey === 'DEFAULT' || mappedKey === 'WAREHOUSE'
    })

    return warehouseEntry?.[0] || 'LOCATION-1'
  }

  const displayMatch = Object.entries(activeLocationMappings).find(([, mapped]) => {
    return normaliseText(mapped).toUpperCase() === key
  })

  if (displayMatch?.[0]) return displayMatch[0]

  const shopMatch = key.match(/^SHOP-(\d+)$/)
  if (shopMatch) return `LOCATION-${Number(shopMatch[1]) + 1}`

  return key
}

function isShopLocation(value: any) {
  const location = appStorageLocation(value).toUpperCase()

  if (/^LOCATION-\d+$/.test(location)) {
    return location !== 'LOCATION-1'
  }

  return canonicalLocation(value).toUpperCase().startsWith('SHOP-')
}

function telegramLocationKeys(value: any) {
  const storage = appStorageLocation(value)
  const display = canonicalLocation(storage)
  const keys = new Set<string>()

  if (storage) keys.add(storage)
  if (display) keys.add(display)

  return Array.from(keys)
}

function getTelegramForLocation(map: Map<string, any>, value: any) {
  for (const key of telegramLocationKeys(value)) {
    const result = map.get(key)
    if (result) return result
  }

  return null
}

function setTelegramForLocation(map: Map<string, any>, value: any, result: any) {
  for (const key of telegramLocationKeys(value)) {
    map.set(key, result)
  }
}

function shopLocationNumber(value: any) {
  const match = canonicalLocation(value).match(/^SHOP-(\d+)$/i)
  return match ? Number(match[1]) : 999
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function getArrayFromCandidates(data: any, keys: string[]) {
  if (!data) return []
  if (Array.isArray(data)) return data

  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key]
  }

  return []
}

function getOpenOrderIdRows(data: any) {
  return getArrayFromCandidates(data, [
    'Data',
    'data',
    'OrderIds',
    'orderIds',
    'Orders',
    'orders',
    'Items',
    'items',
    'Results',
    'results',
  ])
}

function getOpenOrderDetailRows(data: any) {
  return getArrayFromCandidates(data, [
    'Data',
    'data',
    'Orders',
    'orders',
    'Items',
    'items',
    'Results',
    'results',
    'OpenOrders',
    'openOrders',
  ])
}

function getOrderId(order: any) {
  return normaliseText(
    order?.OrderId ||
      order?.orderId ||
      order?.pkOrderId ||
      order?.PkOrderId ||
      order?.nOrderId ||
      order?.NumOrderId ||
      order?.numOrderId ||
      order?.ReferenceNum ||
      order?.referenceNum ||
      order
  )
}

function getOrderUuid(order: any) {
  const value = normaliseText(
    order?.pkOrderId ||
      order?.PkOrderId ||
      order?.OrderId ||
      order?.orderId ||
      order?.OrderID ||
      order?.orderID ||
      order
  )

  return isUuid(value) ? value : ''
}

function getOrderSource(order: any) {
  return normaliseText(order?.Source || order?.source || order?.Channel || order?.channel)
}

function getOrderSubSource(order: any) {
  return normaliseText(
    order?.SubSource || order?.subSource || order?.Subsource || order?.subsource
  )
}

function getOrderItems(order: any) {
  return getArrayFromCandidates(order, [
    'Items',
    'items',
    'OrderItems',
    'orderItems',
    'OrderLines',
    'orderLines',
    'Rows',
    'rows',
  ])
}

function getOrderItemId(item: any) {
  return normaliseText(
    item?.OrderItemId ||
      item?.orderItemId ||
      item?.pkOrderItemId ||
      item?.PkOrderItemId ||
      item?.rowid ||
      item?.RowId ||
      item?.id
  )
}

function getItemSku(item: any) {
  return normaliseText(
    item?.SKU ||
      item?.Sku ||
      item?.sku ||
      item?.ItemNumber ||
      item?.itemNumber ||
      item?.ItemSKU ||
      item?.itemSku ||
      item?.ChannelSKU ||
      item?.channelSku
  )
}

function getItemQuantity(item: any) {
  return (
    normaliseNumber(item?.Quantity) ??
    normaliseNumber(item?.quantity) ??
    normaliseNumber(item?.Qty) ??
    normaliseNumber(item?.qty) ??
    1
  )
}

async function sendTelegramMessage(message: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!botToken || !chatId) {
    return { skipped: true, reason: 'Telegram env vars missing' }
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
    }),
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(`Telegram send failed: ${JSON.stringify(data)}`)
  }

  return {
    ok: true,
    chat_id: chatId,
    message_id: data?.result?.message_id || null,
  }
}

async function sendTelegramPhotoMessage(params: { imageUrl: string; caption: string }) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!botToken || !chatId || !params.imageUrl) {
    return { skipped: true, reason: 'Telegram photo details missing' }
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      photo: params.imageUrl,
      caption: params.caption,
    }),
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(`Telegram photo send failed: ${JSON.stringify(data)}`)
  }

  return {
    ok: true,
    chat_id: chatId,
    message_id: data?.result?.message_id || null,
  }
}

function getFirstItemImageUrl(item: any) {
  const images = Array.isArray(item?.item_images) ? item.item_images : []

  if (images.length === 0) return ''

  const sorted = [...images].sort(
    (a: any, b: any) => Number(a?.image_order || 0) - Number(b?.image_order || 0)
  )

  return normaliseText(sorted[0]?.processed_url || sorted[0]?.original_url)
}

async function getAllOpenOrderIds(server: string, token: string) {
  const data = await linnworksPost(server, token, '/api/Orders/GetAllOpenOrders', {
    filters: {},
    sorting: [],
    fulfilmentCenter: DEFAULT_LOCATION_ID,
    additionalFilter: '',
    exactMatch: false,
  })

  const rows = getOpenOrderIdRows(data)

  return [...new Set(rows.map(getOrderUuid).filter(Boolean))]
}

async function getOpenOrdersDetails(server: string, token: string, orderIds: string[]) {
  if (orderIds.length === 0) return []

  const data = await linnworksPost(server, token, '/api/OpenOrders/GetOpenOrdersDetails', {
    OrderIds: orderIds,
    DetailLevel: [],
  })

  return getOpenOrderDetailRows(data)
}

async function getWebAppSkus(supabase: any, companyId?: string) {
  const skus = new Set<string>()
  let from = 0
  const pageSize = 1000

  while (true) {
    let query = supabase
      .from('items')
      .select('sku')
      .not('sku', 'is', null)

    if (companyId) query = query.eq('company_id', companyId)

    const { data, error } = await query.range(from, from + pageSize - 1)

    if (error) throw new Error(error.message)

    const rows = data || []

    for (const row of rows) {
      const sku = normaliseText(row.sku).toLowerCase()
      if (sku) skus.add(sku)
    }

    if (rows.length < pageSize) break
    from += pageSize
  }

  return skus
}

async function getAlreadyCheckedOrderIds(supabase: any, orderIds: string[], companyId?: string) {
  if (orderIds.length === 0) return new Set<string>()

  const checked = new Set<string>()

  for (let i = 0; i < orderIds.length; i += 100) {
    const batch = orderIds.slice(i, i + 100)

    let query = supabase
      .from('linnworks_checked_open_orders')
      .select('linnworks_order_id')
      .in('linnworks_order_id', batch)

    if (companyId) query = query.eq('company_id', companyId)

    const { data, error } = await query

    if (error) throw new Error(error.message)

    for (const row of data || []) {
      const id = normaliseText(row.linnworks_order_id)
      if (id) checked.add(id)
    }
  }

  return checked
}

async function markOrderChecked(params: {
  supabase: any
  orderId: string
  managedSkuFound: boolean
  companyId?: string
}) {
  const now = new Date().toISOString()
  let existingQuery = params.supabase
    .from('linnworks_checked_open_orders')
    .select('id')
    .eq('linnworks_order_id', params.orderId)

  if (params.companyId) existingQuery = existingQuery.eq('company_id', params.companyId)

  const { data: existing, error: existingError } = await existingQuery.limit(1).maybeSingle()
  if (existingError) throw new Error(existingError.message)

  const payload = {
    linnworks_order_id: params.orderId,
    managed_sku_found: params.managedSkuFound,
    checked_at: now,
    updated_at: now,
    ...(params.companyId ? { company_id: params.companyId } : {}),
  }

  const { error } = existing?.id
    ? await params.supabase
        .from('linnworks_checked_open_orders')
        .update(payload)
        .eq('id', existing.id)
    : await params.supabase
        .from('linnworks_checked_open_orders')
        .insert(payload)

  if (error) throw new Error(error.message)
}

async function getAppStockRows(supabase: any, itemId: string, companyId?: string) {
  let query = supabase
    .from('item_stock_locations')
    .select('id, item_id, sku, location_name, bin_code, stock_level')
    .eq('item_id', itemId)

  if (companyId) query = query.eq('company_id', companyId)

  const { data, error } = await query

  if (error) throw new Error(error.message)

  return (data || []) as AppStockRow[]
}

function getLocationDeductionPriority(locationName: any) {
  const storage = appStorageLocation(locationName)

  if (storage === 'LOCATION-1') return 0

  const shopMatch = storage.match(/^LOCATION-(\d+)$/)
  if (shopMatch) return Number(shopMatch[1]) * 100

  return 9999
}

function sortOnlineDeductionRows(
  rows: AppStockRow[],
  locationSettings: Map<string, LocationSetting>
) {
  return [...rows].sort((a, b) => {
    const aLocationPriority = getLocationDeductionPriority(a.location_name)
    const bLocationPriority = getLocationDeductionPriority(b.location_name)

    if (aLocationPriority !== bLocationPriority) {
      return aLocationPriority - bLocationPriority
    }

    const aLocation = appStorageLocation(a.location_name)
    const bLocation = appStorageLocation(b.location_name)

    if (aLocation !== bLocation) {
      return aLocation.localeCompare(bLocation, undefined, { numeric: true, sensitivity: 'base' })
    }

    const aBin = normaliseText(a.bin_code) || WAREHOUSE_BIN
    const bBin = normaliseText(b.bin_code) || WAREHOUSE_BIN
    const rangeLocation = isRangeLocation(locationSettings, aLocation)

    if (rangeLocation) {
      const binCompare = compareNaturalBin(aBin, bBin)
      if (binCompare !== 0) return binCompare
    } else {
      const priority = getBasicBinPriority(locationSettings, aLocation)
      const ai = priority.indexOf(aBin.toUpperCase())
      const bi = priority.indexOf(bBin.toUpperCase())
      const ap = ai === -1 ? 999 : ai
      const bp = bi === -1 ? 999 : bi

      if (ap !== bp) return ap - bp
    }

    return Number(b.stock_level || 0) - Number(a.stock_level || 0)
  })
}

async function updateStockRow(supabase: any, rowId: string, stockLevel: number, source: string, companyId?: string) {
  let query = supabase
    .from('item_stock_locations')
    .update({
      stock_level: stockLevel,
      source,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId)

  if (companyId) query = query.eq('company_id', companyId)

  const { error } = await query

  if (error) throw new Error(error.message)
}

async function deductAppBinsForOnlineOrder(params: {
  supabase: any
  itemId: string
  quantity: number
  locationSettings: Map<string, LocationSetting>
  companyId?: string
}) {
  const rows = await getAppStockRows(params.supabase, params.itemId, params.companyId)
  let remaining = Math.max(0, Number(params.quantity || 0))
  const deductions: any[] = []
  const sortedRows = sortOnlineDeductionRows(rows, params.locationSettings)
  const availableStock = sortedRows.reduce(
    (sum, row) => sum + Math.max(0, Number(row.stock_level || 0)),
    0
  )

  if (availableStock < remaining) {
    throw new Error(
      `Insufficient app stock for online order reservation. Needed ${remaining}, available ${availableStock}.`
    )
  }

  for (const row of sortedRows) {
    if (remaining <= 0) break

    const current = Number(row.stock_level || 0)
    if (current <= 0) continue

    const deduct = Math.min(current, remaining)
    const next = current - deduct

    await updateStockRow(params.supabase, row.id, next, 'linnworks_open_order_reserved', params.companyId)

    deductions.push({
      row_id: row.id,
      location_name: appStorageLocation(row.location_name),
      bin_code: normaliseText(row.bin_code) || WAREHOUSE_BIN,
      quantity: deduct,
    })

    remaining -= deduct
  }

  return {
    requested_quantity: params.quantity,
    deducted_quantity: params.quantity - remaining,
    remaining_quantity: remaining,
    deductions,
  }
}

async function updateItemSummary(supabase: any, itemId: string, companyId?: string) {
  const rows = await getAppStockRows(supabase, itemId, companyId)

  const stockLevel = rows.reduce((sum, row) => sum + Number(row.stock_level || 0), 0)
  const warehouseStock = rows
    .filter((row) => canonicalLocation(row.location_name) === WAREHOUSE_LOCATION)
    .reduce((sum, row) => sum + Number(row.stock_level || 0), 0)
  const shopFloorStock = rows
    .filter(
      (row) =>
        isShopLocation(row.location_name) &&
        normaliseText(row.bin_code).toUpperCase() === 'FLOOR'
    )
    .reduce((sum, row) => sum + Number(row.stock_level || 0), 0)

  const displayRow =
    rows
      .filter((row) => Number(row.stock_level || 0) > 0)
      .sort((a, b) => Number(b.stock_level || 0) - Number(a.stock_level || 0))[0] || null

  let query = supabase
    .from('items')
    .update({
      stock_level: stockLevel,
      warehouse_stock: warehouseStock,
      shop_floor_stock: shopFloorStock,
      current_location: displayRow ? appStorageLocation(displayRow.location_name) : null,
      current_bin: displayRow?.bin_code || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)

  if (companyId) query = query.eq('company_id', companyId)

  const { error } = await query

  if (error) throw new Error(error.message)

  return {
    stockLevel,
    warehouseStock,
    shopFloorStock,
  }
}

function todayRange() {
  const now = new Date()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)

  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

async function getNextTransferNumber(supabase: any, companyId?: string) {
  let query = supabase
    .from('stock_transfers')
    .select('transfer_number')
    .order('transfer_number', { ascending: false })
    .limit(1)

  if (companyId) query = query.eq('company_id', companyId)

  const { data, error } = await query

  if (error) throw new Error(error.message)

  return Number(data?.[0]?.transfer_number || 0) + 1
}

async function getOrCreatePendingTransfer(params: {
  supabase: any
  fromLocation: string
  companyId?: string
}) {
  const { start, end } = todayRange()
  const fromLocation = appStorageLocation(params.fromLocation)
  const warehouseLocation = 'LOCATION-1'

  let existingQuery = params.supabase
    .from('stock_transfers')
    .select('id, transfer_number, from_location, to_location')
    .in('from_location', [fromLocation, canonicalLocation(fromLocation)])
    .in('to_location', [warehouseLocation, WAREHOUSE_LOCATION])
    .eq('status', PENDING_TRANSFER_STATUS)
    .eq('reason', TRANSFER_REASON)
    .gte('created_at', start)
    .lt('created_at', end)
    .order('created_at', { ascending: true })
    .limit(1)

  if (params.companyId) existingQuery = existingQuery.eq('company_id', params.companyId)

  const { data: existingRows, error: existingError } = await existingQuery

  if (existingError) throw new Error(existingError.message)

  const existing = existingRows?.[0]
  if (existing?.id) return existing

  const transferNumber = await getNextTransferNumber(params.supabase, params.companyId)

  const { data: created, error: createError } = await params.supabase
    .from('stock_transfers')
    .insert({
      ...(params.companyId ? { company_id: params.companyId } : {}),
      transfer_number: transferNumber,
      from_location: fromLocation,
      to_location: warehouseLocation,
      status: PENDING_TRANSFER_STATUS,
      reason: TRANSFER_REASON,
    })
    .select('id, transfer_number')
    .single()

  if (createError) throw new Error(createError.message)

  return created
}

function expandDeductions(deductions: Deduction[]) {
  const rows: Deduction[] = []

  for (const deduction of deductions) {
    for (let i = 0; i < deduction.quantity; i += 1) {
      rows.push({
        ...deduction,
        quantity: 1,
      })
    }
  }

  return rows
}

async function addDeductionsToShopTransfers(params: {
  supabase: any
  itemId: string
  sku: string
  orderId: string
  orderItemId: string | null
  deductions: Deduction[]
  telegramByShop: Map<string, any>
  companyId?: string
}) {
  const shopDeductions = params.deductions.filter((deduction) =>
    isShopLocation(deduction.location_name)
  )

  const transferRows: any[] = []
  const groupedByShop = new Map<string, Deduction[]>()

  for (const deduction of shopDeductions) {
    const shop = appStorageLocation(deduction.location_name)
    const existing = groupedByShop.get(shop) || []
    existing.push(deduction)
    groupedByShop.set(shop, existing)
  }

  for (const [shop, deductions] of groupedByShop) {
    const transfer = await getOrCreatePendingTransfer({
      supabase: params.supabase,
      fromLocation: shop,
      companyId: params.companyId,
    })

    const expanded = expandDeductions(deductions)

    for (const deduction of expanded) {
      transferRows.push({
        ...(params.companyId ? { company_id: params.companyId } : {}),
        transfer_id: transfer.id,
        item_id: params.itemId,
        sku: params.sku,
        status: PENDING_ITEM_STATUS,
        source_order_id: params.orderId,
        source_order_item_id: params.orderItemId,
        source_bin: deduction.bin_code,
        telegram_chat_id: getTelegramForLocation(params.telegramByShop, shop)?.chat_id || null,
        telegram_message_id: getTelegramForLocation(params.telegramByShop, shop)?.message_id || null,
      })
    }
  }

  if (transferRows.length === 0) return []

  const { data, error } = await params.supabase
    .from('stock_transfer_items')
    .insert(transferRows)
    .select('id, transfer_id, sku, source_bin, source_order_id')

  if (error) throw new Error(error.message)

  return data || []
}

function formatShopRequiredLines(deductions: Deduction[]) {
  const grouped = new Map<string, number>()

  for (const deduction of deductions.filter((row) => isShopLocation(row.location_name))) {
    const key = `${canonicalLocation(deduction.location_name)} ${deduction.bin_code}`
    grouped.set(key, (grouped.get(key) || 0) + deduction.quantity)
  }

  return Array.from(grouped.entries())
    .map(([key, qty]) => `Required transfer quantity from ${key}: ${qty}`)
    .join('\n')
}

async function sendShopTelegramMessages(params: {
  sku: string
  brand: string
  category: string
  imageUrl: string
  deductions: Deduction[]
  source: string
  subSource: string
  orderId: string
}) {
  const groupedByShop = new Map<string, Deduction[]>()

  for (const deduction of params.deductions.filter((row) => isShopLocation(row.location_name))) {
    const shop = appStorageLocation(deduction.location_name)
    const existing = groupedByShop.get(shop) || []
    existing.push(deduction)
    groupedByShop.set(shop, existing)
  }

  const resultByShop = new Map<string, any>()

  for (const [shop, deductions] of groupedByShop) {
    try {
      const displayShop = canonicalLocation(shop)
      const message = `🛒 Online order shop transfer required

SKU: ${params.sku}
Brand: ${params.brand || 'Unknown'}
Category: ${params.category || 'Unknown'}
${formatShopRequiredLines(deductions)}
Pickup location: ${displayShop}
Source: ${params.source || 'Unknown'}
Sub source: ${params.subSource || 'Unknown'}
Order ID: ${params.orderId}`

      const telegramResult = params.imageUrl
        ? await sendTelegramPhotoMessage({ imageUrl: params.imageUrl, caption: message })
        : await sendTelegramMessage(message)

      setTelegramForLocation(resultByShop, shop, telegramResult)
    } catch (error: any) {
      setTelegramForLocation(resultByShop, shop, {
        ok: false,
        error: error.message || 'Telegram send failed',
      })
    }
  }

  return resultByShop
}

async function processLinnworksOpenOrders(request: Request, companyId?: string) {
  const startedAt = new Date().toISOString()

  try {
    const supabase = getSupabaseAdmin()
    const integrationConfig = await getLinnworksIntegrationConfig(supabase, companyId)
    const integrationGate = shouldRunLinnworksRoute({
      config: integrationConfig,
      route: 'open_orders',
      manual: new URL(request.url).searchParams.get('manual') === 'true',
    })

    if (!integrationGate.ok) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        message: integrationGate.reason,
        company_id: companyId || null,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      })
    }
    activeLocationMappings = await loadLocationMappings(supabase, companyId)
    const locationSettings = await loadLocationSettings(supabase, companyId)
    const body = await request.json().catch(() => ({}))

    const maxOrdersToCheck = Math.min(Number(body.maxOrders || 200), 200)
    const entriesPerPage = maxOrdersToCheck

    const { server, token } = await authoriseLinnworks()

    const webAppSkus = await getWebAppSkus(supabase, companyId)
    const allOrderIds = await getAllOpenOrderIds(server, token)
    const alreadyCheckedOrderIds = await getAlreadyCheckedOrderIds(supabase, allOrderIds, companyId)

    const uncheckedOrderIds = allOrderIds
      .filter((orderId) => !alreadyCheckedOrderIds.has(orderId))
      .slice(0, entriesPerPage)

    const orders = await getOpenOrdersDetails(server, token, uncheckedOrderIds)

    const results: any[] = []

    for (const order of orders) {
      const orderId = getOrderUuid(order) || getOrderId(order)
      const source = getOrderSource(order)
      const subSource = getOrderSubSource(order)
      const items = getOrderItems(order)

      if (!orderId) {
        results.push({
          ok: false,
          skipped: true,
          reason: 'Missing order ID',
        })
        continue
      }

      if (items.length === 0) {
        await markOrderChecked({
          supabase,
          orderId,
          managedSkuFound: false,
          companyId,
        })

        results.push({
          ok: true,
          skipped: true,
          orderId,
          reason: 'No order items found',
        })
        continue
      }

      let managedSkuFoundForOrder = false
      const groupedBySku = new Map<string, any>()

      for (const item of items) {
        const sku = getItemSku(item)
        const quantity = getItemQuantity(item)
        const orderItemId = getOrderItemId(item)

        if (!sku) continue

        if (!webAppSkus.has(sku.toLowerCase())) {
          results.push({
            ok: true,
            skipped: true,
            orderId,
            sku,
            reason: 'SKU not managed by web app',
          })
          continue
        }

        managedSkuFoundForOrder = true

        const existing = groupedBySku.get(sku)

        if (existing) {
          existing.quantity += quantity
          if (!existing.orderItemId && orderItemId) existing.orderItemId = orderItemId
        } else {
          groupedBySku.set(sku, {
            sku,
            quantity,
            orderItemId,
          })
        }
      }

      for (const groupedItem of groupedBySku.values()) {
        const sku = groupedItem.sku
        const quantity = Math.max(1, Number(groupedItem.quantity || 1))

        let existingSaleQuery = supabase
          .from('linnworks_processed_sales')
          .select('id, stock_deducted, telegram_sent')
          .eq('linnworks_order_id', orderId)
          .eq('sku', sku)

        if (companyId) existingSaleQuery = existingSaleQuery.eq('company_id', companyId)

        const existingSale = await existingSaleQuery
          .maybeSingle()

        if (existingSale.error) throw new Error(existingSale.error.message)

        if (existingSale.data?.stock_deducted) {
          results.push({
            ok: true,
            skipped: true,
            orderId,
            sku,
            reason: 'Already stock deducted',
          })
          continue
        }

        let itemQuery = supabase
          .from('items')
          .select(`
            id,
            sku,
            brand,
            reporting_category,
            stock_level,
            current_location,
            current_bin,
            item_images (
              processed_url,
              original_url,
              image_order
            )
          `)
          .eq('sku', sku)

        if (companyId) itemQuery = itemQuery.eq('company_id', companyId)

        const itemResult = await itemQuery
          .maybeSingle()

        if (itemResult.error) throw new Error(itemResult.error.message)

        const localItem = itemResult.data

        if (!localItem) {
          results.push({
            ok: false,
            skipped: true,
            orderId,
            sku,
            reason: 'SKU not found in Supabase items table',
          })
          continue
        }

        const operationalDeduction = await deductAppBinsForOnlineOrder({
          supabase,
          itemId: localItem.id,
          quantity,
          locationSettings,
          companyId,
        })

        if (Number(operationalDeduction.deducted_quantity || 0) !== quantity) {
          throw new Error(
            `Online order reservation failed for ${sku}. Needed ${quantity}, deducted ${operationalDeduction.deducted_quantity}.`
          )
        }

        const summary = await updateItemSummary(supabase, localItem.id, companyId)

        const telegramByShop = await sendShopTelegramMessages({
          sku,
          brand: normaliseText(localItem.brand),
          category: normaliseText(localItem.reporting_category),
          imageUrl: getFirstItemImageUrl(localItem),
          deductions: operationalDeduction.deductions,
          source,
          subSource,
          orderId,
        })

        const transferItems = await addDeductionsToShopTransfers({
          supabase,
          itemId: localItem.id,
          sku,
          orderId,
          orderItemId: groupedItem.orderItemId || null,
          deductions: operationalDeduction.deductions,
          telegramByShop,
          companyId,
        })

        const telegramSent = Array.from(telegramByShop.values()).some((row) => row?.ok)

        const salePayload = {
          ...(companyId ? { company_id: companyId } : {}),
          linnworks_order_id: orderId,
          linnworks_order_item_id: groupedItem.orderItemId || null,
          sku,
          quantity,
          source,
          sub_source: subSource,
          first_seen_status: 'open',
          current_status: 'open',
          stock_deducted: true,
          stock_deductions: operationalDeduction.deductions,
          telegram_sent: telegramSent,
          updated_at: new Date().toISOString(),
        }

        if (existingSale.data?.id) {
          let updateSaleQuery = supabase
            .from('linnworks_processed_sales')
            .update(salePayload)
            .eq('id', existingSale.data.id)

          if (companyId) updateSaleQuery = updateSaleQuery.eq('company_id', companyId)

          const { error: updateSaleError } = await updateSaleQuery

          if (updateSaleError) throw new Error(updateSaleError.message)
        } else {
          const { error: insertSaleError } = await supabase
            .from('linnworks_processed_sales')
            .insert(salePayload)

          if (insertSaleError) throw new Error(insertSaleError.message)
        }

        results.push({
          ok: true,
          orderId,
          sku,
          quantity,
          operational_deduction: operationalDeduction,
          item_summary: summary,
          transfer_items_created: transferItems.length,
          telegram_sent: telegramSent,
          telegram_results: Object.fromEntries(telegramByShop),
          reason: 'online_sale_reserved_and_transfer_created',
        })
      }

      await markOrderChecked({
        supabase,
        orderId,
        managedSkuFound: managedSkuFoundForOrder,
        companyId,
      })
    }

    return NextResponse.json({
      ok: true,
      message: 'Linnworks open orders checked.',
      company_id: companyId || null,
      started_at: startedAt,
      web_app_sku_count: webAppSkus.size,
      all_open_order_id_count: allOrderIds.length,
      already_checked_order_id_count: alreadyCheckedOrderIds.size,
      unchecked_order_id_count: allOrderIds.length - alreadyCheckedOrderIds.size,
      checked_this_run_count: uncheckedOrderIds.length,
      order_count: orders.length,
      created_queue_rows: 0,
      notification_rows: results.filter((row) => row.telegram_sent).length,
      transfer_items_created: results.reduce(
        (sum, row) => sum + Number(row.transfer_items_created || 0),
        0
      ),
      results,
    })
  } catch (error: any) {
    console.error('LINNWORKS_ORDERS_SYNC_ERROR', error)

    return NextResponse.json(
      {
        ok: false,
        message: error.message || 'Unknown Linnworks orders sync error.',
      },
      { status: 500 }
    )
  }
}

async function processLinnworksOpenOrdersForAllCompanies(request: Request) {
  const startedAt = new Date().toISOString()
  const supabase = getSupabaseAdmin()
  const manual = new URL(request.url).searchParams.get('manual') === 'true'
  const companies = await getEnabledIntegrationCompanies(supabase, 'linnworks', manual)

  if (companies.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      message: 'No active companies have Linnworks open-order sync enabled.',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      results: [],
    })
  }

  const results: any[] = []

  for (const company of companies) {
    const response = await processLinnworksOpenOrders(request.clone(), company.id)
    const payload = await response.json().catch(() => null)
    results.push({
      company_id: company.id,
      company_name: company.name,
      status: response.status,
      payload,
    })
  }

  return NextResponse.json({
    ok: results.every((row) => row.status < 400 && row.payload?.ok !== false),
    message: 'Linnworks open orders checked for active companies.',
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    company_count: companies.length,
    results,
  })
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, message: 'Unauthorised.' }, { status: 401 })
  }

  return processLinnworksOpenOrdersForAllCompanies(request)
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, message: 'Unauthorised.' }, { status: 401 })
  }

  return processLinnworksOpenOrdersForAllCompanies(request)
}

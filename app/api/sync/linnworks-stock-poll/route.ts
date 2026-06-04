import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getLinnworksIntegrationConfig, shouldRunLinnworksRoute } from '@/lib/linnworksIntegrationSettings'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type LocalItem = {
  id: string
  sku: string
  stock_level: number | null
  current_location: string | null
  current_bin: string | null
  linnworks_item_id: string | null
  linnworks_managed: boolean | null
}

type MappedStockRow = {
  locationId: string | null
  locationName: string
  stockLevel: number
  binRack: string
}

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

async function linnworksGet(server: string, token: string, path: string) {
  const response = await fetch(`${server}${path}`, {
    method: 'GET',
    headers: { accept: 'application/json', Authorization: token },
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

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function numberValue(value: any) {
  if (value === null || value === undefined || value === '') return 0
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
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

async function loadLocationMappings(supabase: any) {
  const { data, error } = await supabase
    .from('integration_settings')
    .select('settings')
    .eq('channel', 'linnworks')
    .maybeSingle()

  if (error) return DEFAULT_LOCATION_MAPPINGS

  const saved = data?.settings?.location_mapping || data?.settings?.location_mappings || {}
  const mappings: Record<string, string> = { ...DEFAULT_LOCATION_MAPPINGS }

  for (const [appLocation, linnworksLocation] of Object.entries(saved)) {
    const key = text(appLocation).toUpperCase()
    const value = text(linnworksLocation)
    if (key && value) mappings[key] = value
  }

  return mappings
}

function mapAppLocationToLinnworksLocation(locationName: string) {
  const value = text(locationName)
  const key = value.toUpperCase()

  if (!value) return 'Default'
  if (activeLocationMappings[key]) return activeLocationMappings[key]
  if (key === 'WAREHOUSE') return 'Default'
  return value
}

function mapLinnworksLocationToAppLocation(locationName: string) {
  const value = text(locationName)
  const key = value.toUpperCase()

  if (!value || key === 'DEFAULT' || key === 'WAREHOUSE') {
    const warehouseEntry = Object.entries(activeLocationMappings).find(
      ([appLocation, mapped]) =>
        /^LOCATION-\d+$/i.test(appLocation) &&
        ['default', 'warehouse'].includes(text(mapped).toLowerCase())
    )

    return warehouseEntry?.[0] || 'LOCATION-1'
  }

  if (/^LOCATION-\d+$/i.test(value)) return key

  const locationEntry = Object.entries(activeLocationMappings).find(
    ([appLocation, mapped]) =>
      /^LOCATION-\d+$/i.test(appLocation) && text(mapped).toUpperCase() === key
  )

  if (locationEntry?.[0]) return locationEntry[0]

  const shopMatch = key.match(/^SHOP-(\d+)$/)
  if (shopMatch) return `LOCATION-${Number(shopMatch[1]) + 1}`

  return key
}

function getArrayFromCandidates(data: any, keys: string[]) {
  if (!data) return []
  if (Array.isArray(data)) return data

  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key]
  }

  return []
}

function getStockItemsFromFullResponse(data: any) {
  return getArrayFromCandidates(data, [
    'Data',
    'data',
    'Items',
    'items',
    'StockItems',
    'stockItems',
    'Results',
    'results',
  ])
}

function getStockLevelsFromFullItem(item: any) {
  return getArrayFromCandidates(item, [
    'StockLevels',
    'stockLevels',
    'StockItemLevels',
    'stockItemLevels',
    'Levels',
    'levels',
    'Locations',
    'locations',
    'LocationStockLevels',
    'locationStockLevels',
  ])
}

function getSkuFromFullItem(item: any) {
  return text(
    item?.SKU ||
      item?.Sku ||
      item?.sku ||
      item?.ItemNumber ||
      item?.itemNumber ||
      item?.ItemNumberSKU ||
      item?.itemNumberSKU
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

function getLocationName(row: any) {
  return text(
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

function getStockLevel(row: any) {
  return (
    numberValue(row?.StockLevel) ||
    numberValue(row?.stockLevel) ||
    numberValue(row?.Level) ||
    numberValue(row?.level) ||
    numberValue(row?.Quantity) ||
    numberValue(row?.quantity) ||
    numberValue(row?.OnHand) ||
    numberValue(row?.onHand) ||
    numberValue(row?.InStock) ||
    numberValue(row?.inStock) ||
    0
  )
}

function getAvailableStock(row: any) {
  const value =
    row?.Available ??
    row?.available ??
    row?.AvailableStock ??
    row?.availableStock ??
    row?.AvailableQuantity ??
    row?.availableQuantity ??
    null

  if (value === null || value === undefined || value === '') return null

  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function getBinRack(row: any) {
  return text(
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

function findLocationNameById(locations: any[], locationId: string) {
  const wanted = String(locationId || '').toLowerCase().trim()

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

  const mappedRows: MappedStockRow[] = stockLevelRows.map((stockRow) => {
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
      locationId,
      locationName,
      stockLevel: getAvailableStock(stockRow) ?? getStockLevel(stockRow),
      binRack: getBinRack(stockRow) || getBinRack(matchingLocationRow) || 'Default',
    }
  })

  return mappedRows
}

function chooseDisplayLocation(rows: MappedStockRow[], currentLocation: string | null) {
  const rowsWithStock = rows.filter((row) => row.stockLevel > 0)
  const current = text(currentLocation).toLowerCase()

  if (current) {
    const currentMatch = rowsWithStock.find(
      (row) => row.locationName.toLowerCase() === current
    )

    if (currentMatch) return currentMatch
  }

  if (rowsWithStock.length === 1) return rowsWithStock[0]

  if (rowsWithStock.length > 1) {
    return [...rowsWithStock].sort((a, b) => b.stockLevel - a.stockLevel)[0]
  }

  return rows[0] || null
}

function isShopLocation(locationName: string) {
  return mapAppLocationToLinnworksLocation(locationName).toLowerCase().startsWith('shop')
}

function isWarehouseLocation(locationName: string) {
  const value = mapAppLocationToLinnworksLocation(locationName).toLowerCase()
  return value === 'default' || value === 'warehouse' || value.includes('warehouse')
}

function sumLocationType(rows: MappedStockRow[], type: 'shop' | 'warehouse') {
  return rows.reduce((sum, row) => {
    if (type === 'shop' && isShopLocation(row.locationName)) {
      return sum + Number(row.stockLevel || 0)
    }

    if (type === 'warehouse' && isWarehouseLocation(row.locationName)) {
      return sum + Number(row.stockLevel || 0)
    }

    return sum
  }, 0)
}

async function getLocalItems(supabase: any, limit: number, onlySku: string) {
  let query = supabase
    .from('items')
    .select(`
      id,
      sku,
      stock_level,
      current_location,
      current_bin,
      linnworks_item_id,
      linnworks_managed
    `)
    .eq('linnworks_managed', true)
    .not('sku', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(limit)

  if (onlySku) {
    query = query.eq('sku', onlySku)
  }

  const { data, error } = await query

  if (error) throw new Error(error.message)

  return (data || []) as LocalItem[]
}

async function hasBlockingQueueRows(supabase: any, sku: string) {
  const { data, error } = await supabase
    .from('linnworks_sync_queue')
    .select('id, status, action, created_at')
    .eq('sku', sku)
    .in('status', ['pending', 'processing', 'failed'])
    .limit(1)

  if (error) throw new Error(error.message)

  return Boolean(data && data.length > 0)
}

function mapPollLocationToStoredLocation(locationName: string) {
  return storedLocationName(locationName)
}

function storedLocationName(locationName: string) {
  const value = text(locationName)
  const key = value.toUpperCase()

  if (!value) return 'LOCATION-1'
  if (/^LOCATION-\d+$/i.test(value)) return key
  if (key === 'DEFAULT' || key === 'WAREHOUSE') return 'LOCATION-1'

  const mapped = mapLinnworksLocationToAppLocation(value)
  const mappedKey = text(mapped).toUpperCase()

  if (/^LOCATION-\d+$/i.test(mappedKey)) return mappedKey
  if (mappedKey === 'DEFAULT' || mappedKey === 'WAREHOUSE') return 'LOCATION-1'

  const shopMatch = mappedKey.match(/^SHOP-(\d+)$/)
  if (shopMatch) return `LOCATION-${Number(shopMatch[1]) + 1}`

  return mappedKey || key
}

function canonicalLocationName(locationName: string) {
  return storedLocationName(locationName)
}

function displayLocationName(locationName: string) {
  const stored = storedLocationName(locationName)
  const mapped = mapAppLocationToLinnworksLocation(stored)
  const clean = text(mapped)
  const lower = clean.toLowerCase()

  if (!clean || lower === 'default' || lower === 'warehouse') return 'WAREHOUSE'
  return clean.toUpperCase().startsWith('SHOP-') ? clean.toUpperCase() : clean
}

function isShopPollLocation(locationName: string) {
  return displayLocationName(locationName).toUpperCase().startsWith('SHOP-')
}

function isWarehousePollLocation(locationName: string) {
  const display = displayLocationName(locationName).toLowerCase()
  return display === 'warehouse' || display === 'default'
}

function getOnlinePollDeductionPriority(locationName: string) {
  if (isShopPollLocation(locationName)) return ['STOCK', 'FLOOR', 'Default']
  return ['Default']
}

async function upsertPollLocationRow(params: {
  supabase: any
  item: LocalItem
  locationName: string
  binCode: string
  stockLevel: number
  source: string
}) {
  const { supabase, item, binCode, stockLevel, source } = params
  const locationName = canonicalLocationName(params.locationName)
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
        stock_level: stockLevel,
        source,
        synced_at: now,
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
      stock_level: stockLevel,
      source,
      synced_at: now,
      updated_at: now,
    })

  if (insertError) throw new Error(insertError.message)
}

async function mergeLegacyWarehouseRows(supabase: any, item: LocalItem) {
  const { data, error } = await supabase
    .from('item_stock_locations')
    .select('id, location_name, bin_code, stock_level, source, synced_at')
    .eq('item_id', item.id)

  if (error) throw new Error(error.message)

  const rows = data || []
  const grouped = new Map<string, any[]>()

  for (const row of rows) {
    const storedLocation = storedLocationName(row.location_name)
    const key = `${storedLocation}||${text(row.bin_code) || 'Default'}`
    const existing = grouped.get(key) || []
    existing.push(row)
    grouped.set(key, existing)
  }

  const now = new Date().toISOString()

  for (const [key, groupRows] of grouped.entries()) {
    const [storedLocation, binCode] = key.split('||')
    const total = Math.max(...groupRows.map((row: any) => Number(row.stock_level || 0)), 0)

    const preferred =
      groupRows.find((row: any) => /^LOCATION-\d+$/i.test(text(row.location_name))) ||
      groupRows[0]

    const { error: updateError } = await supabase
      .from('item_stock_locations')
      .update({
        location_name: storedLocation,
        bin_code: binCode || 'Default',
        stock_level: total,
        source: 'linnworks_poll_location_normalise',
        updated_at: now,
      })
      .eq('id', preferred.id)

    if (updateError) throw new Error(updateError.message)

    const duplicateIds = groupRows
      .filter((row: any) => row.id !== preferred.id)
      .map((row: any) => row.id)

    if (duplicateIds.length > 0) {
      const { error: deleteError } = await supabase
        .from('item_stock_locations')
        .delete()
        .in('id', duplicateIds)

      if (deleteError) throw new Error(deleteError.message)
    }
  }
}

async function getReservedOnlineTransferQtyByLocation(supabase: any, item: LocalItem) {
  const reserved = new Map<string, number>()

  const { data, error } = await supabase
    .from('stock_transfer_items')
    .select(`
      id,
      status,
      stock_transfers (
        from_location,
        to_location,
        status,
        reason
      )
    `)
    .eq('item_id', item.id)
    .in('status', ['pending_pick', 'picked', 'in_transfer', 'in_transit'])

  if (error) throw new Error(error.message)

  for (const row of data || []) {
    const transfer = Array.isArray(row.stock_transfers)
      ? row.stock_transfers[0]
      : row.stock_transfers

    if (!transfer) continue

    const reason = text(transfer.reason)
    const transferStatus = text(transfer.status)
    const fromLocation = canonicalLocationName(transfer.from_location)

    if (reason !== 'online_order_pick') continue
    if (['received', 'cancelled', 'canceled'].includes(transferStatus.toLowerCase())) continue
    if (!isShopPollLocation(fromLocation)) continue

    const key = fromLocation.toLowerCase()
    reserved.set(key, (reserved.get(key) || 0) + 1)
  }

  return reserved
}

async function reconcileAppBinsFromLinnworksRows(params: {
  supabase: any
  item: LocalItem
  rows: MappedStockRow[]
}) {
  const { supabase, item, rows } = params
  const changes: any[] = []

  const { data: existingRows, error } = await supabase
    .from('item_stock_locations')
    .select('id, location_name, bin_code, stock_level')
    .eq('item_id', item.id)

  if (error) throw new Error(error.message)

  const appRows = existingRows || []
  const reservedByLocation = await getReservedOnlineTransferQtyByLocation(supabase, item)

  for (const row of rows) {
    const locationName = mapPollLocationToStoredLocation(row.locationName)
    const rawLinnworksStock = Number(row.stockLevel || 0)
    const reservedQty = isShopPollLocation(locationName)
      ? Number(reservedByLocation.get(canonicalLocationName(locationName).toLowerCase()) || 0)
      : 0
    const linnworksStock = Math.max(0, rawLinnworksStock - reservedQty)

    const localRowsForLocation = appRows.filter(
      (appRow: any) =>
        canonicalLocationName(appRow.location_name).toLowerCase() ===
        canonicalLocationName(locationName).toLowerCase()
    )

    const localTotal = localRowsForLocation.reduce(
      (sum: number, appRow: any) => sum + Number(appRow.stock_level || 0),
      0
    )

    let difference = linnworksStock - localTotal

    if (localRowsForLocation.length === 0) {
      const defaultBin = isShopPollLocation(locationName) ? 'STOCK' : 'Default'
      await upsertPollLocationRow({
        supabase,
        item,
        locationName,
        binCode: defaultBin,
        stockLevel: linnworksStock,
        source: 'linnworks_poll_seed',
      })
      changes.push({ locationName, type: 'seed', stockLevel: linnworksStock })
      continue
    }

    if (difference > 0) {
      const defaultBin = isShopPollLocation(locationName) ? 'STOCK' : 'Default'
      const targetRow =
        localRowsForLocation.find((appRow: any) => text(appRow.bin_code).toUpperCase() === defaultBin) ||
        localRowsForLocation[0]

      await upsertPollLocationRow({
        supabase,
        item,
        locationName,
        binCode: targetRow?.bin_code || defaultBin,
        stockLevel: Number(targetRow?.stock_level || 0) + difference,
        source: 'linnworks_poll_increase',
      })

      changes.push({ locationName, type: 'increase', quantity: difference })
      continue
    }

    if (difference < 0) {
      let remaining = Math.abs(difference)
      const priority = getOnlinePollDeductionPriority(locationName)
      const sortedRows = [...localRowsForLocation].sort((a: any, b: any) => {
        const ai = priority.indexOf(text(a.bin_code).toUpperCase())
        const bi = priority.indexOf(text(b.bin_code).toUpperCase())
        const ap = ai === -1 ? 99 : ai
        const bp = bi === -1 ? 99 : bi
        if (ap !== bp) return ap - bp
        return Number(b.stock_level || 0) - Number(a.stock_level || 0)
      })

      for (const appRow of sortedRows) {
        if (remaining <= 0) break
        const currentStock = Number(appRow.stock_level || 0)
        if (currentStock <= 0) continue
        const deduction = Math.min(currentStock, remaining)

        await upsertPollLocationRow({
          supabase,
          item,
          locationName,
          binCode: appRow.bin_code,
          stockLevel: currentStock - deduction,
          source: 'linnworks_poll_decrease',
        })

        remaining -= deduction
      }

      changes.push({ locationName, type: 'decrease', quantity: Math.abs(difference), unapplied: remaining })
    }
  }

  return changes
}

async function readOperationalRows(supabase: any, itemId: string) {
  const { data, error } = await supabase
    .from('item_stock_locations')
    .select('location_name, bin_code, stock_level')
    .eq('item_id', itemId)

  if (error) throw new Error(error.message)

  return data || []
}

function sumOperationalRows(rows: any[], type: 'shop_floor' | 'warehouse') {
  return rows.reduce((sum, row) => {
    const binCode = text(row.bin_code).toUpperCase()

    if (type === 'shop_floor' && isShopPollLocation(row.location_name) && binCode === 'FLOOR') {
      return sum + Number(row.stock_level || 0)
    }

    if (type === 'warehouse' && isWarehousePollLocation(row.location_name)) {
      return sum + Number(row.stock_level || 0)
    }

    return sum
  }, 0)
}

async function processStockPoll(request: Request) {
  const startedAt = new Date().toISOString()
  const url = new URL(request.url)
  const debug = url.searchParams.get('debug') === 'true'
  const onlySku = text(url.searchParams.get('sku')).toUpperCase()
  const limit = Math.min(Number(url.searchParams.get('limit') || 25), 100)

  try {
    const supabase = getSupabaseAdmin()
    const integrationConfig = await getLinnworksIntegrationConfig(supabase)
    const integrationGate = shouldRunLinnworksRoute({
      config: integrationConfig,
      route: 'stock_poll',
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
    activeLocationMappings = await loadLocationMappings(supabase)
    const { server, token } = await authoriseLinnworks()
    const locations = await linnworksGet(server, token, '/api/Inventory/GetStockLocations')

    const items = await getLocalItems(supabase, limit, onlySku)
    const results: any[] = []

    for (const item of items) {
      const sku = text(item.sku)

      if (!sku) continue

      const blockingQueue = await hasBlockingQueueRows(supabase, sku)

      if (blockingQueue) {
        results.push({
          ok: true,
          skipped: true,
          sku,
          reason: 'Skipped because app-to-Linnworks queue is pending/processing/failed for this SKU.',
        })
        continue
      }

      try {
        const stockItemId =
          text(item.linnworks_item_id) ||
          text(await findLinnworksItemBySku(server, token, sku))

        if (!stockItemId) {
          results.push({
            ok: false,
            skipped: true,
            sku,
            reason: 'Could not find Linnworks item id.',
          })
          continue
        }

        const rows = await getLinnworksStockRows({
          server,
          token,
          sku,
          stockItemId,
          locations: Array.isArray(locations) ? locations : [],
        })

        if (rows.length === 0) {
          results.push({
            ok: false,
            skipped: true,
            sku,
            reason: 'No Linnworks stock rows returned.',
          })
          continue
        }

        const totalStockLevel = rows.reduce(
          (sum, row) => sum + Number(row.stockLevel || 0),
          0
        )

        await mergeLegacyWarehouseRows(supabase, item)

        const displayLocation = chooseDisplayLocation(rows, item.current_location)

        const appBinChanges = await reconcileAppBinsFromLinnworksRows({
          supabase,
          item,
          rows,
        })

        await mergeLegacyWarehouseRows(supabase, item)

        const operationalRows = await readOperationalRows(supabase, item.id)
        const displayOperationalRow = operationalRows
          .filter((row: any) => Number(row.stock_level || 0) > 0)
          .sort((a: any, b: any) => Number(b.stock_level || 0) - Number(a.stock_level || 0))[0]

        const updatePayload = {
          stock_level: totalStockLevel,
          shop_floor_stock: sumOperationalRows(operationalRows, 'shop_floor'),
          warehouse_stock: sumOperationalRows(operationalRows, 'warehouse'),
          current_location: displayOperationalRow?.location_name
            ? canonicalLocationName(displayOperationalRow.location_name)
            : displayLocation?.locationName
              ? canonicalLocationName(displayLocation.locationName)
              : item.current_location || null,
          current_bin: displayOperationalRow?.bin_code || item.current_bin || null,
          linnworks_location_sync_status: 'synced',
          linnworks_location_synced_at: new Date().toISOString(),
          linnworks_status: 'synced',
          linnworks_sync_error: null,
          updated_at: new Date().toISOString(),
        }

        const { error: updateError } = await supabase
          .from('items')
          .update(updatePayload)
          .eq('id', item.id)

        if (updateError) throw new Error(updateError.message)

        results.push({
          ok: true,
          sku,
          previous_stock_level: item.stock_level,
          new_stock_level: totalStockLevel,
          location: updatePayload.current_location,
          bin: updatePayload.current_bin,
          shop_floor_stock: updatePayload.shop_floor_stock,
          warehouse_stock: updatePayload.warehouse_stock,
          location_rows_reconciled: rows.length,
          app_bin_changes: appBinChanges,
          rows: debug ? rows : undefined,
        })
      } catch (error: any) {
        results.push({
          ok: false,
          sku,
          error: error.message || 'Unknown stock poll item error.',
        })
      }
    }

    return NextResponse.json({
      ok: true,
      message: 'Linnworks stock poll completed.',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      checked: items.length,
      updated: results.filter((row) => row.ok && !row.skipped).length,
      skipped: results.filter((row) => row.skipped).length,
      failed: results.filter((row) => !row.ok).length,
      debug,
      results,
    })
  } catch (error: any) {
    console.error('LINNWORKS_STOCK_POLL_ERROR', error)

    return NextResponse.json(
      {
        ok: false,
        message: error.message || 'Unknown Linnworks stock poll error.',
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}

function isAuthorised(request: Request) {
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) return true

  const authHeader = request.headers.get('authorization')
  const querySecret = new URL(request.url).searchParams.get('secret')

  return authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret
}

export async function GET(request: Request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ ok: false, message: 'Unauthorised.' }, { status: 401 })
  }

  return processStockPoll(request)
}

export async function POST(request: Request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ ok: false, message: 'Unauthorised.' }, { status: 401 })
  }

  return processStockPoll(request)
}

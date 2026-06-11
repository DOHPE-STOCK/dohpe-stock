import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireCompanyAccess } from '@/lib/serverTenant'

const CHANNEL_SOURCE = 'EBAY'
const CHANNEL_SUBSOURCE = 'dohpe_vintage_UK'

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

function getActiveCompanyIdFromRequest(request: Request) {
  const cookie = request.headers.get('cookie') || ''
  const match = cookie.match(/(?:^|;\s*)active_company_id=([^;]+)/)

  if (!match) return null

  try {
    const companyId = decodeURIComponent(match[1])
    return companyId && companyId !== 'single-company-fallback' ? companyId : null
  } catch {
    return null
  }
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

async function loadLocationMappings(companyId?: string | null) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) return DEFAULT_LOCATION_MAPPINGS

  const supabase = createClient(url, serviceKey)
  let query = supabase
    .from('integration_settings')
    .select('settings')
    .eq('channel', 'linnworks')

  if (companyId) {
    query = query.eq('company_id', companyId)
  }

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

function mapAppLocationToLinnworksLocation(locationName: string) {
  const value = normaliseText(locationName)
  const key = value.toUpperCase()

  if (!value) return 'Default'
  if (DEFAULT_LOCATION_MAPPINGS[key]) return DEFAULT_LOCATION_MAPPINGS[key]

  return value
}

function mapAppLocationWithMappings(locationName: string, mappings: Record<string, string>) {
  const value = normaliseText(locationName)
  const key = value.toUpperCase()

  if (!value) return 'Default'
  if (mappings[key]) return mappings[key]

  return value
}

function normalisePropertyName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(' ', '_')
    .replaceAll('-', '_')
    .replaceAll('/', '_')
    .replaceAll('(', '')
    .replaceAll(')', '')
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
  try {
    const data = await linnworksGet(
      server,
      token,
      `/api/Inventory/GetInventoryItem?sKU=${encodeURIComponent(sku)}`
    )

    return findStockItemIdFromData(data)
  } catch {
    return null
  }
}

async function getLinnworksItem(server: string, token: string, stockItemId: string, sku: string) {
  try {
    return await linnworksGet(
      server,
      token,
      `/api/Inventory/GetInventoryItem?inventoryItemId=${encodeURIComponent(stockItemId)}`
    )
  } catch {
    return await linnworksGet(
      server,
      token,
      `/api/Inventory/GetInventoryItem?sKU=${encodeURIComponent(sku)}`
    )
  }
}

function getInventoryItemObject(data: any) {
  if (!data) return null
  if (data.Item) return data.Item
  if (data.item) return data.item
  return data
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

  return (
    match?.StockLocationId ||
    match?.stockLocationId ||
    match?.pkStockLocationId ||
    match?.LocationId ||
    match?.locationId ||
    match?.Id ||
    match?.id ||
    null
  )
}

function getRowId(row: any) {
  return row?.pkRowId || row?.PkRowId || row?.RowId || row?.Id || row?.id || null
}

function findChannelRow(data: any[]) {
  if (!Array.isArray(data)) return null

  return (
    data.find((row) => {
      const source = normaliseText(row.Source || row.source)
      const subSource = normaliseText(row.SubSource || row.subSource)

      return (
        source.toLowerCase() === CHANNEL_SOURCE.toLowerCase() &&
        subSource.toLowerCase() === CHANNEL_SUBSOURCE.toLowerCase()
      )
    }) || null
  )
}

function getCategoryId(category: any) {
  return (
    category?.CategoryId ||
    category?.categoryId ||
    category?.Id ||
    category?.id ||
    category?.pkCategoryId ||
    category?.PkCategoryId ||
    null
  )
}

function getCategoryName(category: any) {
  return normaliseText(
    category?.CategoryName ||
      category?.categoryName ||
      category?.Name ||
      category?.name ||
      category?.Category ||
      category?.category
  )
}

async function findCategoryId(server: string, token: string, categoryName: string) {
  if (!categoryName) return null

  try {
    const categories = await linnworksGet(server, token, '/api/Inventory/GetCategories')

    if (!Array.isArray(categories)) return null

    const wanted = categoryName.toLowerCase()

    const match =
      categories.find((category) => getCategoryName(category).toLowerCase() === wanted) ||
      categories.find(
        (category) =>
          getCategoryName(category).toLowerCase().replaceAll('-', ' ') ===
          wanted.replaceAll('-', ' ')
      )

    return match ? getCategoryId(match) : null
  } catch {
    return null
  }
}

async function tryUpdateStockField(
  server: string,
  token: string,
  params: {
    stockItemId: string
    fieldName: string
    fieldValue: string | number | null
    locationId?: string | null
  }
) {
  if (
    params.fieldValue === null ||
    params.fieldValue === undefined ||
    params.fieldValue === ''
  ) {
    return { ok: false, skipped: true, reason: 'empty value' }
  }

  const payload: any = {
    inventoryItemId: params.stockItemId,
    fieldName: params.fieldName,
    fieldValue: String(params.fieldValue),
    changeSource: 'Dohpe Stock App',
  }

  if (params.locationId) {
    payload.locationId = params.locationId
  }

  try {
    const data = await linnworksPost(
      server,
      token,
      '/api/Inventory/UpdateInventoryItemStockField',
      payload
    )

    return { ok: true, skipped: false, data, payload }
  } catch (error: any) {
    return {
      ok: false,
      skipped: false,
      reason: error.message || 'Unknown update error',
      payload,
    }
  }
}

async function tryUpdateGeneralItem(
  server: string,
  token: string,
  params: {
    stockItemId: string
    sku: string
    title: string
    sellingPrice: number | null
    costPrice: number | null
    category: string
    weightGrams: number | null
  }
) {
  try {
    const existingRaw = await getLinnworksItem(server, token, params.stockItemId, params.sku)
    const existingItem = getInventoryItemObject(existingRaw)

    if (!existingItem) {
      return { ok: false, skipped: false, reason: 'Could not read existing Linnworks item' }
    }

    const categoryId = await findCategoryId(server, token, params.category)

    const inventoryItem: any = {
      ...existingItem,
      StockItemId: params.stockItemId,
      ItemNumber: params.sku,
      ItemTitle: params.title,
      BarcodeNumber: params.sku,
    }

    if (params.sellingPrice !== null) inventoryItem.RetailPrice = params.sellingPrice
    if (params.costPrice !== null) inventoryItem.PurchasePrice = params.costPrice

    if (params.category) {
      inventoryItem.CategoryName = params.category
      inventoryItem.Category = params.category
      if (categoryId) inventoryItem.CategoryId = categoryId
    }

    if (params.weightGrams !== null) inventoryItem.Weight = params.weightGrams

    const payload = { inventoryItem }

    const data = await linnworksPost(
      server,
      token,
      '/api/Inventory/UpdateInventoryItem',
      payload
    )

    return {
      ok: true,
      skipped: false,
      data,
      payload,
      category_id_found: Boolean(categoryId),
      category_id_used: categoryId,
    }
  } catch (error: any) {
    return {
      ok: false,
      skipped: false,
      reason: error.message || 'Unknown general item update error',
    }
  }
}

async function tryUpsertChannelPrice(
  server: string,
  token: string,
  stockItemId: string,
  sellingPrice: number | null
) {
  if (sellingPrice === null) {
    return { ok: false, skipped: true, reason: 'empty selling price' }
  }

  const basePrice: any = {
    StockItemId: stockItemId,
    Source: CHANNEL_SOURCE,
    SubSource: CHANNEL_SUBSOURCE,
    Price: sellingPrice,
  }

  try {
    const existing = await linnworksGet(
      server,
      token,
      `/api/Inventory/GetInventoryItemPrices?inventoryItemId=${encodeURIComponent(stockItemId)}`
    )

    const existingRow = findChannelRow(existing)
    const existingId = getRowId(existingRow)
    const newPriceId = crypto.randomUUID()

    const priceRow = existingId
      ? { ...basePrice, pkRowId: existingId, PkRowId: existingId }
      : { ...basePrice, pkRowId: newPriceId, PkRowId: newPriceId }

    const endpoint = existingId
      ? '/api/Inventory/UpdateInventoryItemPrices'
      : '/api/Inventory/CreateInventoryItemPrices'

    const payload = { inventoryItemPrices: [priceRow] }
    const data = await linnworksPost(server, token, endpoint, payload)

    return {
      ok: true,
      skipped: false,
      endpoint,
      data,
      existing,
      existing_channel_row_found: Boolean(existingId),
      payload,
    }
  } catch (error: any) {
    return {
      ok: false,
      skipped: false,
      reason: error.message || 'Unknown channel price update error',
      payload: { inventoryItemPrices: [basePrice] },
    }
  }
}

async function tryUpsertChannelDescription(
  server: string,
  token: string,
  stockItemId: string,
  title: string,
  description: string
) {
  if (!description) {
    return { ok: false, skipped: true, reason: 'empty description' }
  }

  const baseDescription: any = {
    StockItemId: stockItemId,
    Source: CHANNEL_SOURCE,
    SubSource: CHANNEL_SUBSOURCE,
    Title: title,
    Description: description,
  }

  try {
    const existing = await linnworksGet(
      server,
      token,
      `/api/Inventory/GetInventoryItemDescriptions?inventoryItemId=${encodeURIComponent(stockItemId)}`
    )

    const existingRow = findChannelRow(existing)
    const existingId = getRowId(existingRow)

    const descriptionRow = existingId
      ? { ...baseDescription, pkRowId: existingId, PkRowId: existingId }
      : baseDescription

    const endpoint = existingId
      ? '/api/Inventory/UpdateInventoryItemDescriptions'
      : '/api/Inventory/CreateInventoryItemDescriptions'

    const payload = { inventoryItemDescriptions: [descriptionRow] }
    const data = await linnworksPost(server, token, endpoint, payload)

    return {
      ok: true,
      skipped: false,
      endpoint,
      data,
      existing,
      existing_channel_row_found: Boolean(existingId),
      payload,
    }
  } catch (error: any) {
    return {
      ok: false,
      skipped: false,
      reason: error.message || 'Unknown channel description update error',
      payload: { inventoryItemDescriptions: [baseDescription] },
    }
  }
}

async function tryUpsertChannelTitle(
  server: string,
  token: string,
  stockItemId: string,
  title: string
) {
  if (!title) {
    return { ok: false, skipped: true, reason: 'empty title' }
  }

  const baseTitle: any = {
    StockItemId: stockItemId,
    Source: CHANNEL_SOURCE,
    SubSource: CHANNEL_SUBSOURCE,
    Title: title,
  }

  try {
    const existing = await linnworksGet(
      server,
      token,
      `/api/Inventory/GetInventoryItemTitles?inventoryItemId=${encodeURIComponent(stockItemId)}`
    )

    const existingRow = findChannelRow(existing)
    const existingId = getRowId(existingRow)

    const titleRow = existingId
      ? { ...baseTitle, pkRowId: existingId, PkRowId: existingId }
      : baseTitle

    const endpoint = existingId
      ? '/api/Inventory/UpdateInventoryItemTitles'
      : '/api/Inventory/CreateInventoryItemTitles'

    const payload = { inventoryItemTitles: [titleRow] }
    const data = await linnworksPost(server, token, endpoint, payload)

    return {
      ok: true,
      skipped: false,
      endpoint,
      data,
      existing,
      existing_channel_row_found: Boolean(existingId),
      payload,
    }
  } catch (error: any) {
    return {
      ok: false,
      skipped: false,
      reason: error.message || 'Unknown channel title update error',
      payload: { inventoryItemTitles: [baseTitle] },
    }
  }
}

async function tryUpsertExtendedProperty(
  server: string,
  token: string,
  stockItemId: string,
  propertyName: string,
  propertyValue: string
) {
  if (!propertyValue) {
    return { ok: false, skipped: true, reason: 'empty value' }
  }

  const baseProperty: any = {
    fkStockItemId: stockItemId,
    ProperyName: propertyName,
    PropertyValue: propertyValue,
    PropertyType: 'Attribute',
  }

  try {
    const existing = await linnworksPost(
      server,
      token,
      '/api/Inventory/GetInventoryItemExtendedProperties',
      {
        inventoryItemId: stockItemId,
        itemNumber: '',
        propertyParams: {},
      }
    )

    const existingProperties = Array.isArray(existing) ? existing : []
    const existingRow =
      existingProperties.find(
        (row) =>
          normaliseText(row.ProperyName || row.PropertyName || row.propertyName).toLowerCase() ===
          propertyName.toLowerCase()
      ) || null

    const existingId = getRowId(existingRow)
    const newPropertyId = crypto.randomUUID()

    const propertyRow = existingId
      ? { ...baseProperty, pkRowId: existingId, PkRowId: existingId }
      : { ...baseProperty, pkRowId: newPropertyId, PkRowId: newPropertyId }

    const endpoint = existingId
      ? '/api/Inventory/UpdateInventoryItemExtendedProperties'
      : '/api/Inventory/CreateInventoryItemExtendedProperties'

    const payload = { inventoryItemExtendedProperties: [propertyRow] }
    const data = await linnworksPost(server, token, endpoint, payload)

    return {
      ok: true,
      skipped: false,
      endpoint,
      existing_property_found: Boolean(existingId),
      data,
      payload,
    }
  } catch (error: any) {
    return {
      ok: false,
      skipped: false,
      reason: error.message || 'Unknown extended property error',
      payload: { inventoryItemExtendedProperties: [baseProperty] },
    }
  }
}

function getImageUrlFromLinnworksImage(image: any) {
  return normaliseText(
    image?.ImageUrl ||
      image?.imageUrl ||
      image?.Source ||
      image?.source ||
      image?.Url ||
      image?.url
  )
}

async function tryGetLinnworksImages(server: string, token: string, stockItemId: string) {
  try {
    const data = await linnworksGet(
      server,
      token,
      `/api/Inventory/GetInventoryItemImages?inventoryItemId=${encodeURIComponent(stockItemId)}`
    )

    const images = Array.isArray(data) ? data : []
    const imageUrls = images.map(getImageUrlFromLinnworksImage).filter(Boolean)

    return {
      ok: true,
      skipped: false,
      images,
      imageUrls,
    }
  } catch (error: any) {
    return {
      ok: false,
      skipped: false,
      reason: error.message || 'Unknown get images error',
      images: [],
      imageUrls: [],
    }
  }
}

async function tryDeleteLinnworksImages(
  server: string,
  token: string,
  stockItemId: string,
  imageUrls: string[]
) {
  if (imageUrls.length === 0) {
    return { ok: true, skipped: true, reason: 'no existing images' }
  }

  const payload = {
    inventoryItemImages: {
      [stockItemId]: imageUrls,
    },
  }

  try {
    const data = await linnworksPost(
      server,
      token,
      '/api/Inventory/DeleteImagesFromInventoryItem',
      payload
    )

    return { ok: true, skipped: false, data, payload }
  } catch (error: any) {
    return {
      ok: false,
      skipped: false,
      reason: error.message || 'Unknown delete images error',
      payload,
    }
  }
}

async function tryAddImage(
  server: string,
  token: string,
  stockItemId: string,
  imageUrl: string,
  isMain: boolean,
  sortOrder: number
) {
  if (!imageUrl) {
    return { ok: false, skipped: true, reason: 'empty image url' }
  }

  try {
    const payload = {
      request: {
        stockItemId,
        imageUrl,
        isMain,
        sortOrder,
      },
    }

    const data = await linnworksPost(
      server,
      token,
      '/api/Inventory/AddImageToInventoryItem',
      payload
    )

    return { ok: true, skipped: false, data, payload }
  } catch (error: any) {
    return {
      ok: false,
      skipped: false,
      reason: error.message || 'Unknown image sync error',
      imageUrl,
    }
  }
}

async function tryReplaceImages(
  server: string,
  token: string,
  stockItemId: string,
  processedImages: string[]
) {
  const existing = await tryGetLinnworksImages(server, token, stockItemId)

  if (!existing.ok) {
    return {
      ok: false,
      skipped: false,
      reason: existing.reason,
      existing,
      deleted: null,
      added: [],
    }
  }

  const deleted = await tryDeleteLinnworksImages(
    server,
    token,
    stockItemId,
    existing.imageUrls
  )

  if (!deleted.ok) {
    return {
      ok: false,
      skipped: false,
      reason: deleted.reason,
      existing,
      deleted,
      added: [],
    }
  }

  const added = []

  for (let i = 0; i < processedImages.length; i++) {
    added.push(
      await tryAddImage(
        server,
        token,
        stockItemId,
        processedImages[i],
        i === 0,
        i + 1
      )
    )
  }

  const failedAdded = added.filter((result: any) => !result.ok && !result.skipped)

  return {
    ok: failedAdded.length === 0,
    skipped: false,
    existing,
    deleted,
    added,
    replaced_existing_count: existing.imageUrls.length,
    added_count: added.filter((result: any) => result.ok).length,
    failed_added_count: failedAdded.length,
  }
}

function addFilledMeasurementProperties(body: any, target: Record<string, any>) {
  const directMeasurementFields = [
    'pit_to_pit_in',
    'collar_to_hem_in',
    'pit_to_cuff_in',
    'sleeve_in',
    'waist_in',
    'inside_leg_in',
    'rise_in',
    'hem_width_in',
  ]

  const measurementPropertyNames: Record<string, string> = {
    pit_to_pit_in: 'measurement_pit_to_pit',
    collar_to_hem_in: 'measurement_collar_to_hem',
    pit_to_cuff_in: 'measurement_pit_to_cuff',
    sleeve_in: 'measurement_sleeve',
    waist_in: 'measurement_waist',
    inside_leg_in: 'measurement_inside_leg',
    rise_in: 'measurement_rise',
    hem_width_in: 'measurement_hem_width',
  }

  for (const field of directMeasurementFields) {
    const value = normaliseText(body[field])

    if (value) {
      const propertyName = measurementPropertyNames[field] || `measurement_${field}`
      target[propertyName] = value
    }
  }

  if (body.measurements && typeof body.measurements === 'object' && !Array.isArray(body.measurements)) {
    for (const [rawKey, rawValue] of Object.entries(body.measurements)) {
      const key = normalisePropertyName(String(rawKey))
      const value = normaliseText(rawValue)

      if (key && value) {
        target[`measurement_${key}`] = value
      }
    }
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const companyId = getActiveCompanyIdFromRequest(request)
    const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member'])
    if (!access.ok) {
      return NextResponse.json({ ok: false, message: access.message }, { status: access.status })
    }

    if (!companyId || companyId !== access.company.id) {
      return NextResponse.json({ ok: false, message: 'Active company required.' }, { status: 400 })
    }

    const sku = normaliseText(body.sku)
    const title = normaliseText(
      body.title || body.final_title || body.ai_title || body.basic_title || sku
    )
    const description = normaliseText(
      body.final_description || body.ai_description || body.basic_description
    )

    if (!sku) {
      return NextResponse.json({ ok: false, message: 'Missing SKU.' }, { status: 400 })
    }

    if (!title) {
      return NextResponse.json({ ok: false, message: 'Missing title.' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { data: item, error: itemError } = await supabase
      .from('items')
      .select('id, sku')
      .eq('sku', sku)
      .eq('company_id', companyId)
      .maybeSingle()

    if (itemError) throw new Error(itemError.message)
    if (!item) {
      return NextResponse.json({ ok: false, message: 'Item not found for active company.' }, { status: 404 })
    }

    const { server, token } = await authoriseLinnworks()
    const existingLinnworksItemId = normaliseText(body.linnworks_item_id)

    let stockItemId = existingLinnworksItemId
    let createdNew = false
    let linkedExisting = false

    if (!stockItemId) {
      stockItemId = await findLinnworksItemBySku(server, token, sku)
      if (stockItemId) linkedExisting = true
    }

    if (!stockItemId) {
      stockItemId = crypto.randomUUID()
      createdNew = true

      await linnworksPost(server, token, '/api/Inventory/AddInventoryItem', {
        inventoryItem: {
          StockItemId: stockItemId,
          ItemNumber: sku,
          ItemTitle: title,
          BarcodeNumber: sku,
        },
      })
    }

    const locationName =
      normaliseText(body.current_location) ||
      normaliseText(body.default_location) ||
      'Default'
    const locationMappings = await loadLocationMappings(companyId)
    const linnworksLocationName = mapAppLocationWithMappings(locationName, locationMappings)

    const binRack =
      normaliseText(body.current_bin) ||
      normaliseText(body.default_binrack) ||
      'Default'

    const locations = await linnworksGet(server, token, '/api/Inventory/GetStockLocations')
    const locationId = Array.isArray(locations)
      ? findLocationId(locations, linnworksLocationName)
      : null

    const sellingPrice = normaliseNumber(body.selling_price)
    const costPrice = normaliseNumber(body.cost_price)
    const stockLevel = normaliseNumber(body.stock_level) ?? 1
    const stockValue =
      costPrice !== null && stockLevel !== null
        ? Number((stockLevel * costPrice).toFixed(2))
        : null
    const weightGrams = normaliseNumber(body.weight_grams)
    const category = normaliseText(body.reporting_category)

    const processedImages = Array.isArray(body.processed_image_urls)
      ? body.processed_image_urls
          .map((url: any) => normaliseText(url))
          .filter(Boolean)
      : []

    const updates = {
      general_item: await tryUpdateGeneralItem(server, token, {
        stockItemId,
        sku,
        title,
        sellingPrice,
        costPrice,
        category,
        weightGrams,
      }),

      channel_title: await tryUpsertChannelTitle(server, token, stockItemId, title),

      channel_description: await tryUpsertChannelDescription(
        server,
        token,
        stockItemId,
        title,
        description
      ),

      channel_price: await tryUpsertChannelPrice(
        server,
        token,
        stockItemId,
        sellingPrice
      ),

      stock_level: locationId
        ? await tryUpdateStockField(server, token, {
            stockItemId,
            fieldName: 'StockLevel',
            fieldValue: stockLevel,
            locationId,
          })
        : { ok: false, skipped: true, reason: `Location not found: ${linnworksLocationName}` },

      stock_value:
        locationId && stockValue !== null
          ? await tryUpdateStockField(server, token, {
              stockItemId,
              fieldName: 'StockValue',
              fieldValue: stockValue,
              locationId,
            })
          : { ok: false, skipped: true, reason: 'Missing location or cost price' },

      binrack: locationId
        ? await tryUpdateStockField(server, token, {
            stockItemId,
            fieldName: 'BinRack',
            fieldValue: binRack,
            locationId,
          })
        : { ok: false, skipped: true, reason: `Location not found: ${linnworksLocationName}` },
    }

    const extendedPropertyValues: Record<string, string> = {
      dohpe_app_managed: 'true',
      brand: normaliseText(body.brand),
      reporting_category: normaliseText(body.reporting_category),
      tagged_size: normaliseText(body.tagged_size || body.size_label),
      condition: normaliseText(body.condition),
      material: normaliseText(body.material),
      colour_primary: normaliseText(
        body.colour_primary || body.primary_colour || body.colour || body.color
      ),
      style: normaliseText(body.style),
      sub_type: normaliseText(body.sub_type || body.subtype || body.item_sub_type),
      era: normaliseText(body.era),
      gender: normaliseText(body.gender),
      flaws: normaliseText(body.flaws),
    }

    addFilledMeasurementProperties(body, extendedPropertyValues)

    const extended_properties: Record<string, any> = {}

    for (const [propertyName, propertyValue] of Object.entries(extendedPropertyValues)) {
      extended_properties[propertyName] = await tryUpsertExtendedProperty(
        server,
        token,
        stockItemId,
        propertyName,
        propertyValue
      )
    }

    const image_replace = await tryReplaceImages(server, token, stockItemId, processedImages)
    const images = image_replace.added || []

    const failedUpdates = Object.entries(updates).filter(
      ([, result]: any) => !result.ok && !result.skipped
    )

    const failedExtended = Object.entries(extended_properties).filter(
      ([, result]: any) => !result.ok && !result.skipped
    )

    const failedImages = !image_replace.ok
      ? [image_replace]
      : images.filter((result: any) => !result.ok && !result.skipped)

    console.log(
      'LINNWORKS_EXPORT_DEBUG',
      JSON.stringify({
        sku,
        stockItemId,
        sellingPrice,
        costPrice,
        stockLevel,
        stockValue,
        descriptionLength: description.length,
        title,
        locationName,
        locationId,
        binRack,
        processedImageCount: processedImages.length,
        channel: {
          source: CHANNEL_SOURCE,
          subSource: CHANNEL_SUBSOURCE,
        },
        updates,
        extended_properties,
        image_replace,
        images,
      })
    )

    return NextResponse.json({
      ok: true,
      message:
        failedUpdates.length > 0 || failedExtended.length > 0 || failedImages.length > 0
          ? `Linnworks item linked/created, but ${failedUpdates.length} field update(s), ${failedExtended.length} extended property update(s), and ${failedImages.length} image sync step(s) failed.`
          : createdNew
            ? 'Linnworks inventory item created and fully synced.'
            : linkedExisting
              ? 'Existing Linnworks inventory item linked and fully synced.'
              : 'Linnworks inventory item fully synced.',
      created_new: createdNew,
      linked_existing: linkedExisting,
      linnworks_item_id: stockItemId,
      linnworks_item_number: sku,
      location_used: locationName,
      location_id_found: Boolean(locationId),
      binrack_used: binRack,
      processed_image_count: processedImages.length,
      updates,
      extended_properties,
      image_replace,
      images,
    })
  } catch (error: any) {
    console.error('LINNWORKS_EXPORT_ERROR', error)

    return NextResponse.json(
      {
        ok: false,
        message: error.message || 'Unknown Linnworks export error.',
      },
      { status: 500 }
    )
  }
}

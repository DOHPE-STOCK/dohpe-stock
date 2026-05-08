import { NextResponse } from 'next/server'

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

function normaliseNumber(value: any) {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
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
  const wanted = locationName.toLowerCase().trim()

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

export async function POST(request: Request) {
  try {
    const body = await request.json()

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

    const binRack =
      normaliseText(body.current_bin) ||
      normaliseText(body.default_binrack) ||
      'Default'

    const locations = await linnworksGet(server, token, '/api/Inventory/GetStockLocations')
    const locationId = Array.isArray(locations)
      ? findLocationId(locations, locationName)
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
        : { ok: false, skipped: true, reason: `Location not found: ${locationName}` },

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
        : { ok: false, skipped: true, reason: `Location not found: ${locationName}` },
    }

    const extended_properties = {
      dohpe_app_managed: await tryUpsertExtendedProperty(
        server,
        token,
        stockItemId,
        'dohpe_app_managed',
        'true'
      ),
      brand: await tryUpsertExtendedProperty(
        server,
        token,
        stockItemId,
        'brand',
        normaliseText(body.brand)
      ),
      reporting_category: await tryUpsertExtendedProperty(
        server,
        token,
        stockItemId,
        'reporting_category',
        normaliseText(body.reporting_category)
      ),
      tagged_size: await tryUpsertExtendedProperty(
        server,
        token,
        stockItemId,
        'tagged_size',
        normaliseText(body.tagged_size || body.size_label)
      ),
      condition: await tryUpsertExtendedProperty(
        server,
        token,
        stockItemId,
        'condition',
        normaliseText(body.condition)
      ),
      material: await tryUpsertExtendedProperty(
        server,
        token,
        stockItemId,
        'material',
        normaliseText(body.material)
      ),
      colour_primary: await tryUpsertExtendedProperty(
        server,
        token,
        stockItemId,
        'colour_primary',
        normaliseText(body.colour_primary || body.primary_colour || body.colour || body.color)
      ),
      style: await tryUpsertExtendedProperty(
        server,
        token,
        stockItemId,
        'style',
        normaliseText(body.style)
      ),
      sub_type: await tryUpsertExtendedProperty(
        server,
        token,
        stockItemId,
        'sub_type',
        normaliseText(body.sub_type || body.subtype || body.item_sub_type)
      ),
      era: await tryUpsertExtendedProperty(
        server,
        token,
        stockItemId,
        'era',
        normaliseText(body.era)
      ),
      gender: await tryUpsertExtendedProperty(
        server,
        token,
        stockItemId,
        'gender',
        normaliseText(body.gender)
      ),
      flaws: await tryUpsertExtendedProperty(
        server,
        token,
        stockItemId,
        'flaws',
        normaliseText(body.flaws)
      ),
    }

    const images = []

    for (let i = 0; i < processedImages.length; i++) {
      images.push(
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

    const failedUpdates = Object.entries(updates).filter(
      ([, result]: any) => !result.ok && !result.skipped
    )

    const failedExtended = Object.entries(extended_properties).filter(
      ([, result]: any) => !result.ok && !result.skipped
    )

    const failedImages = images.filter((result: any) => !result.ok && !result.skipped)

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
        images,
      })
    )

    return NextResponse.json({
      ok: true,
      message:
        failedUpdates.length > 0 || failedExtended.length > 0 || failedImages.length > 0
          ? `Linnworks item linked/created, but ${failedUpdates.length} field update(s), ${failedExtended.length} extended property update(s), and ${failedImages.length} image(s) failed.`
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
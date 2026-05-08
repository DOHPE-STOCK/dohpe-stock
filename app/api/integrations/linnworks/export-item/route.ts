import { NextResponse } from 'next/server'

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
    headers: { accept: 'application/json', 'content-type': 'application/json', Authorization: token },
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

    return { ok: true, skipped: false, data }
  } catch (error: any) {
    return {
      ok: false,
      skipped: false,
      reason: error.message || 'Unknown update error',
      payload,
    }
  }
}

async function tryCreateExtendedProperty(
  server: string,
  token: string,
  stockItemId: string,
  propertyName: string,
  propertyValue: string
) {
  if (!propertyValue) {
    return { ok: false, skipped: true, reason: 'empty value' }
  }

  try {
    const data = await linnworksPost(
      server,
      token,
      '/api/Inventory/CreateInventoryItemExtendedProperties',
      {
        inventoryItemExtendedProperties: [
          {
            StockItemId: stockItemId,
            ProperyName: propertyName,
            PropertyName: propertyName,
            PropertyValue: propertyValue,
            PropertyType: 'Attribute',
          },
        ],
      }
    )

    return { ok: true, skipped: false, data }
  } catch (error: any) {
    return {
      ok: false,
      skipped: false,
      reason: error.message || 'Unknown extended property error',
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
    const data = await linnworksPost(
      server,
      token,
      '/api/Inventory/AddImageToInventoryItem',
      {
        stockItemId,
        imageUrl,
        isMain,
        sortOrder,
      }
    )

    return { ok: true, skipped: false, data }
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
    const weightGrams = normaliseNumber(body.weight_grams)
    const category = normaliseText(body.reporting_category)

    const processedImages = Array.isArray(body.processed_image_urls)
      ? body.processed_image_urls
          .map((url: any) => normaliseText(url))
          .filter(Boolean)
      : []

    const updates = {
      title: await tryUpdateStockField(server, token, {
        stockItemId,
        fieldName: 'Title',
        fieldValue: title,
      }),

      description: await tryUpdateStockField(server, token, {
        stockItemId,
        fieldName: 'Description',
        fieldValue: description,
      }),

      category: await tryUpdateStockField(server, token, {
        stockItemId,
        fieldName: 'Category',
        fieldValue: category,
      }),

      retail_price: await tryUpdateStockField(server, token, {
        stockItemId,
        fieldName: 'RetailPrice',
        fieldValue: sellingPrice,
      }),

      purchase_price: await tryUpdateStockField(server, token, {
        stockItemId,
        fieldName: 'PurchasePrice',
        fieldValue: costPrice,
      }),

      weight: await tryUpdateStockField(server, token, {
        stockItemId,
        fieldName: 'Weight',
        fieldValue: weightGrams,
      }),

      stock_level: locationId
        ? await tryUpdateStockField(server, token, {
            stockItemId,
            fieldName: 'StockLevel',
            fieldValue: stockLevel,
            locationId,
          })
        : { ok: false, skipped: true, reason: `Location not found: ${locationName}` },

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
      dohpe_app_managed: await tryCreateExtendedProperty(
        server,
        token,
        stockItemId,
        'dohpe_app_managed',
        'true'
      ),
      brand: await tryCreateExtendedProperty(
        server,
        token,
        stockItemId,
        'brand',
        normaliseText(body.brand)
      ),
      reporting_category: await tryCreateExtendedProperty(
        server,
        token,
        stockItemId,
        'reporting_category',
        normaliseText(body.reporting_category)
      ),
      tagged_size: await tryCreateExtendedProperty(
        server,
        token,
        stockItemId,
        'tagged_size',
        normaliseText(body.tagged_size)
      ),
      condition: await tryCreateExtendedProperty(
        server,
        token,
        stockItemId,
        'condition',
        normaliseText(body.condition)
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
    return NextResponse.json(
      {
        ok: false,
        message: error.message || 'Unknown Linnworks export error.',
      },
      { status: 500 }
    )
  }
}
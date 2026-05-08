import { NextResponse } from 'next/server'

async function authoriseLinnworks() {
  const applicationId = process.env.LINNWORKS_APP_ID
  const applicationSecret = process.env.LINNWORKS_APP_SECRET
  const token = process.env.LINNWORKS_APP_TOKEN

  if (!applicationId || !applicationSecret || !token) {
    throw new Error('Missing Linnworks environment variables.')
  }

  const response = await fetch(
    'https://api.linnworks.net/api/Auth/AuthorizeByApplication',
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ApplicationId: applicationId,
        ApplicationSecret: applicationSecret,
        Token: token,
      }),
    }
  )

  const data = await response.json()

  if (!response.ok || !data?.Token || !data?.Server) {
    throw new Error('Linnworks authorisation failed.')
  }

  return {
    server: data.Server,
    token: data.Token,
  }
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
    throw new Error(
      `${path} failed: ${typeof data === 'string' ? data : JSON.stringify(data)}`
    )
  }

  return data
}

async function linnworksGet(server: string, token: string, path: string) {
  const response = await fetch(`${server}${path}`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      Authorization: token,
    },
  })

  const text = await response.text()

  let data: any = null

  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }

  if (!response.ok) {
    throw new Error(
      `${path} failed: ${typeof data === 'string' ? data : JSON.stringify(data)}`
    )
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
    const encodedSku = encodeURIComponent(sku)

    const data = await linnworksGet(
      server,
      token,
      `/api/Inventory/GetInventoryItem?sKU=${encodedSku}`
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

async function updatePrices(
  server: string,
  token: string,
  stockItemId: string,
  sellingPrice: number | null,
  costPrice: number | null
) {
  if (sellingPrice === null && costPrice === null) return false

  await linnworksPost(server, token, '/api/Inventory/UpdateInventoryItemPrices', {
    inventoryItemPrices: [
      {
        StockItemId: stockItemId,
        Source: 'Default',
        SubSource: '',
        Price: sellingPrice ?? 0,
        Cost: costPrice ?? 0,
      },
    ],
  })

  return true
}

async function updateLocationAndBinRack(
  server: string,
  token: string,
  stockItemId: string,
  locationId: string,
  stockLevel: number,
  binRack: string
) {
  await linnworksPost(server, token, '/api/Inventory/UpdateItemLocations', {
    inventoryItemLocations: [
      {
        StockItemId: stockItemId,
        LocationId: locationId,
        StockLevel: stockLevel,
        BinRack: binRack,
      },
    ],
  })

  return true
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const sku = normaliseText(body.sku)
    const title = normaliseText(
      body.title || body.final_title || body.ai_title || body.basic_title || sku
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

      if (stockItemId) {
        linkedExisting = true
      }
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

    const sellingPrice = normaliseNumber(body.selling_price)
    const costPrice = normaliseNumber(body.cost_price)
    const stockLevel = normaliseNumber(body.stock_level) ?? 1

    const locationName =
      normaliseText(body.current_location) ||
      normaliseText(body.default_location) ||
      'Default'

    const binRack =
      normaliseText(body.current_bin) ||
      normaliseText(body.default_binrack) ||
      'Default'

    let prices_updated = false
    let location_updated = false
    let location_id_found = false

    prices_updated = await updatePrices(
      server,
      token,
      stockItemId,
      sellingPrice,
      costPrice
    )

    const locations = await linnworksGet(server, token, '/api/Inventory/GetStockLocations')
    const locationId = Array.isArray(locations)
      ? findLocationId(locations, locationName)
      : null

    if (locationId) {
      location_id_found = true

      location_updated = await updateLocationAndBinRack(
        server,
        token,
        stockItemId,
        locationId,
        stockLevel,
        binRack
      )
    }

    return NextResponse.json({
      ok: true,
      message: createdNew
        ? 'Linnworks inventory item created, then price/location sync attempted.'
        : linkedExisting
          ? 'Existing Linnworks item linked, then price/location sync attempted.'
          : 'Linnworks inventory item updated.',
      created_new: createdNew,
      linked_existing: linkedExisting,
      linnworks_item_id: stockItemId,
      linnworks_item_number: sku,
      prices_updated,
      location_updated,
      location_used: locationName,
      location_id_found,
      binrack_used: binRack,
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
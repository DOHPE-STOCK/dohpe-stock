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

    return NextResponse.json({
      ok: true,
      message: createdNew
        ? 'Linnworks inventory item created.'
        : linkedExisting
          ? 'Existing Linnworks inventory item linked.'
          : 'Linnworks inventory item already linked.',
      created_new: createdNew,
      linked_existing: linkedExisting,
      linnworks_item_id: stockItemId,
      linnworks_item_number: sku,
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
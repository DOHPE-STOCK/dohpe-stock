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

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const sku = String(body.sku || '').trim()
    const title = String(body.title || body.sku || '').trim()

    if (!sku) {
      return NextResponse.json(
        { ok: false, message: 'Missing SKU.' },
        { status: 400 }
      )
    }

    if (!title) {
      return NextResponse.json(
        { ok: false, message: 'Missing title.' },
        { status: 400 }
      )
    }

    const { server, token } = await authoriseLinnworks()
    const stockItemId = crypto.randomUUID()

    const response = await fetch(`${server}/api/Inventory/AddInventoryItem`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        Authorization: token,
      },
      body: JSON.stringify({
        inventoryItem: {
          StockItemId: stockItemId,
          ItemNumber: sku,
          ItemTitle: title,
          BarcodeNumber: sku,
        },
      }),
    })

    const text = await response.text()

    let data: any = null

    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: 'Linnworks inventory export failed.',
          status: response.status,
          details: data,
        },
        { status: response.status }
      )
    }

    return NextResponse.json({
      ok: true,
      message: 'Linnworks inventory export complete.',
      linnworks_item_id: stockItemId,
      linnworks_item_number: sku,
      details: data,
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
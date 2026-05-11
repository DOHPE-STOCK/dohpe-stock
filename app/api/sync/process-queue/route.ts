import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

  return await linnworksPost(
    server,
    token,
    '/api/Inventory/UpdateInventoryItemStockField',
    payload
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

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Telegram send failed: ${text}`)
  }

  return { ok: true }
}

function isShopLocation(locationName: string) {
  const value = locationName.toLowerCase()
  return value.startsWith('shop') || value.includes('shop-')
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
    .select('id, sku, cost_price, stock_level, current_location, current_bin')
    .eq('sku', sku)
    .maybeSingle()

  if (itemResult.error) throw new Error(itemResult.error.message)

  const item = itemResult.data

  const stockLevel =
    normaliseNumber(payload.stock_level) ??
    normaliseNumber(item?.stock_level) ??
    0

  const costPrice = normaliseNumber(item?.cost_price) ?? 0
  const stockValue = Number((stockLevel * costPrice).toFixed(2))

  const locationName =
    normaliseText(payload.location) ||
    normaliseText(item?.current_location) ||
    'Default'

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

  if (binRack) {
    results.binrack = await updateStockField(server, token, {
      stockItemId,
      fieldName: 'BinRack',
      fieldValue: binRack,
      locationId,
    })
  }

  if (isShopLocation(locationName)) {
    try {
      results.telegram = await sendTelegramMessage(
        `Stock sync: ${sku}\nLocation: ${locationName}\nBin: ${binRack}\nStock level: ${stockLevel}\nReason: ${payload.reason || 'update_stock'}`
      )
    } catch (error: any) {
      results.telegram = { ok: false, error: error.message }
    }
  }

  await supabase
    .from('items')
    .update({
      stock_level: stockLevel,
      current_location: locationName,
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
    stockLevel,
    stockValue,
    locationName,
    locationId,
    binRack,
    results,
  }
}

export async function POST(request: Request) {
  const startedAt = new Date().toISOString()

  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.SYNC_CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, message: 'Unauthorised.' }, { status: 401 })
  }

  try {
    const supabase = getSupabaseAdmin()

    const body = await request.json().catch(() => ({}))
    const limit = Math.min(Number(body.limit || 10), 50)

    const { data: queueRows, error: queueError } = await supabase
      .from('linnworks_sync_queue')
      .select('*')
      .eq('status', 'pending')
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

        if (row.action === 'update_stock') {
          result = await processUpdateStockQueueRow({
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
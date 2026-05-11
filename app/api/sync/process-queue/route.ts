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

function getLocationName(row: any) {
  return normaliseText(
    row.LocationName ||
      row.locationName ||
      row.StockLocationName ||
      row.stockLocationName ||
      row.Name ||
      row.name
  )
}

function getLocationId(row: any) {
  return (
    row.StockLocationId ||
    row.stockLocationId ||
    row.pkStockLocationId ||
    row.LocationId ||
    row.locationId ||
    row.Id ||
    row.id ||
    null
  )
}

function getStockLevel(row: any) {
  return (
    normaliseNumber(row.StockLevel) ??
    normaliseNumber(row.stockLevel) ??
    normaliseNumber(row.Quantity) ??
    normaliseNumber(row.quantity) ??
    normaliseNumber(row.Available) ??
    normaliseNumber(row.available) ??
    0
  )
}

function getBinRack(row: any) {
  return normaliseText(
    row.BinRack ||
      row.binRack ||
      row.Binrack ||
      row.binrack ||
      row.Bin ||
      row.bin
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

  if (!Array.isArray(data)) return []

  return data
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

function normaliseAction(value: any) {
  return normaliseText(value).toLowerCase()
}

function getLocationPriority(locationName: string, payload: any, item: any) {
  const value = locationName.toLowerCase()
  const payloadLocation = normaliseText(payload.location).toLowerCase()
  const itemLocation = normaliseText(item?.current_location).toLowerCase()
  const saleLocation = normaliseText(payload.sale_location).toLowerCase()

  if (saleLocation && value === saleLocation) return 0
  if (payloadLocation && value === payloadLocation) return 1
  if (itemLocation && value === itemLocation) return 2

  if (value.startsWith('shop') || value.includes('shop-')) return 3
  if (value.includes('warehouse')) return 4
  if (value === 'default') return 5
  if (value.includes('transit')) return 9

  return 6
}

function chooseLocationForAdjustment(params: {
  linnworksLocationRows: any[]
  locations: any[]
  payload: any
  item: any
  delta: number
}) {
  const { linnworksLocationRows, locations, payload, item, delta } = params

  const rows = linnworksLocationRows.map((row) => {
    const locationId = getLocationId(row)
    const locationName =
      getLocationName(row) ||
      (locationId ? findLocationNameById(locations, locationId) : '') ||
      ''
    const stockLevel = getStockLevel(row)
    const binRack = getBinRack(row)

    return {
      raw: row,
      locationId,
      locationName,
      stockLevel,
      binRack,
    }
  })

  const wantedLocation =
    normaliseText(payload.location) ||
    normaliseText(payload.sale_location) ||
    ''

  const wantedLocationLower = wantedLocation.toLowerCase()

  const rowsWithStock = rows.filter((row) => row.locationId && row.stockLevel > 0)

  if (delta < 0) {
    if (wantedLocationLower) {
      const exactWanted = rows.find(
        (row) => row.locationName.toLowerCase() === wantedLocationLower
      )

      if (exactWanted && exactWanted.stockLevel > 0) {
        return {
          ...exactWanted,
          newStockLevel: Math.max(0, exactWanted.stockLevel + delta),
          selectionReason: 'wanted_location_had_stock',
        }
      }

      if (payload.strict_location === true) {
        throw new Error(
          `Wanted location ${wantedLocation} has no stock for ${payload.sku || item?.sku}. Refusing to deduct from another location.`
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
        selectionReason: 'best_location_with_stock',
      }
    }

    throw new Error(`No Linnworks location has stock available to deduct.`)
  }

  if (delta > 0) {
    if (wantedLocationLower) {
      const exactWanted = rows.find(
        (row) => row.locationName.toLowerCase() === wantedLocationLower
      )

      if (exactWanted) {
        return {
          ...exactWanted,
          newStockLevel: exactWanted.stockLevel + delta,
          selectionReason: 'wanted_location_for_increment',
        }
      }
    }

    const itemLocation = normaliseText(item?.current_location).toLowerCase()

    if (itemLocation) {
      const itemLocationRow = rows.find(
        (row) => row.locationName.toLowerCase() === itemLocation
      )

      if (itemLocationRow) {
        return {
          ...itemLocationRow,
          newStockLevel: itemLocationRow.stockLevel + delta,
          selectionReason: 'item_current_location_for_increment',
        }
      }
    }

    const defaultRow =
      rows.find((row) => row.locationName.toLowerCase() === 'default') ||
      rows[0]

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

  const linnworksLocationRows = await getInventoryItemLocations(server, token, stockItemId)

  const selected = chooseLocationForAdjustment({
    linnworksLocationRows,
    locations,
    payload: { ...payload, sku },
    item,
    delta,
  })

  const costPrice = normaliseNumber(item?.cost_price) ?? 0
  const stockValue = Number((selected.newStockLevel * costPrice).toFixed(2))

  const binRack =
    normaliseText(payload.bin) ||
    selected.binRack ||
    normaliseText(item?.current_bin) ||
    selected.locationName ||
    'Default'

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

  if (binRack) {
    results.binrack = await updateStockField(server, token, {
      stockItemId,
      fieldName: 'BinRack',
      fieldValue: binRack,
      locationId: selected.locationId,
    })
  }

  const updatedLocationRows = linnworksLocationRows.map((row) => {
    const rowLocationId = getLocationId(row)

    if (
      rowLocationId &&
      selected.locationId &&
      String(rowLocationId).toLowerCase() === String(selected.locationId).toLowerCase()
    ) {
      return {
        ...row,
        StockLevel: selected.newStockLevel,
      }
    }

    return row
  })

  const totalStockLevel = updatedLocationRows.reduce((sum, row) => {
    return sum + getStockLevel(row)
  }, 0)

  if (isShopLocation(selected.locationName) || isShopLocation(normaliseText(payload.sale_location))) {
    try {
      results.telegram = await sendTelegramMessage(
        `Stock adjusted: ${sku}\nDelta: ${delta}\nLocation: ${selected.locationName}\nBin: ${binRack}\nLocation stock: ${selected.stockLevel} → ${selected.newStockLevel}\nTotal stock: ${totalStockLevel}\nReason: ${payload.reason || 'adjust_stock'}`
      )
    } catch (error: any) {
      results.telegram = { ok: false, error: error.message }
    }
  }

  await supabase
    .from('items')
    .update({
      stock_level: totalStockLevel,
      current_location: selected.locationName,
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
    action: 'adjust_stock',
    delta,
    previousLocationStock: selected.stockLevel,
    newLocationStock: selected.newStockLevel,
    totalStockLevel,
    stockValue,
    locationName: selected.locationName,
    locationId: selected.locationId,
    binRack,
    selectionReason: selected.selectionReason,
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
        `Stock set: ${sku}\nLocation: ${locationName}\nBin: ${binRack}\nStock level: ${stockLevel}\nReason: ${payload.reason || 'update_stock'}`
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
    action: 'update_stock',
    stockLevel,
    stockValue,
    locationName,
    locationId,
    binRack,
    results,
  }
}

async function processQueue(request: Request) {
  const startedAt = new Date().toISOString()

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
        const action = normaliseAction(row.action)

        if (action === 'adjust_stock') {
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

export async function POST(request: Request) {
  // Auth temporarily disabled for browser testing.
  // Re-enable this before using Vercel Cron/public production access.
  //
  // const authHeader = request.headers.get('authorization')
  // const cronSecret = process.env.SYNC_CRON_SECRET
  //
  // if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
  //   return NextResponse.json({ ok: false, message: 'Unauthorised.' }, { status: 401 })
  // }

  return processQueue(request)
}

export async function GET(request: Request) {
  return processQueue(request)
}
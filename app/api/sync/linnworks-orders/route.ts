import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const DEFAULT_LOCATION_ID = '00000000-0000-0000-0000-000000000000'

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

function normaliseText(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function normaliseNumber(value: any) {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function getArrayFromCandidates(data: any, keys: string[]) {
  if (!data) return []
  if (Array.isArray(data)) return data

  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key]
  }

  return []
}

function getOpenOrderRows(data: any) {
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
      order?.referenceNum
  )
}

function getOrderSource(order: any) {
  return normaliseText(
    order?.Source ||
      order?.source ||
      order?.Channel ||
      order?.channel
  )
}

function getOrderSubSource(order: any) {
  return normaliseText(
    order?.SubSource ||
      order?.subSource ||
      order?.Subsource ||
      order?.subsource
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

async function getOpenOrders(server: string, token: string, entriesPerPage: number, pageNumber: number) {
  return await linnworksPost(server, token, '/api/OpenOrders/GetOpenOrders', {
    ViewId: 0,
    LocationId: DEFAULT_LOCATION_ID,
    EntriesPerPage: entriesPerPage,
    PageNumber: pageNumber,
    OrderIds: [],
  })
}

async function getOpenOrdersDetails(server: string, token: string, orderIds: string[]) {
  if (orderIds.length === 0) return []

  const data = await linnworksPost(server, token, '/api/OpenOrders/GetOpenOrdersDetails', {
    OrderIds: orderIds,
    DetailLevel: [],
  })

  return getOpenOrderDetailRows(data)
}

async function createQueueRow(params: {
  supabase: any
  sku: string
  newStockLevel: number
  location: string
  bin: string
  orderId: string
  quantity: number
  source: string
  subSource: string
}) {
  const payload = {
    sku: params.sku,
    stock_level: params.newStockLevel,
    location: params.location,
    bin: params.bin,
    reason: 'online_sale',
    linnworks_order_id: params.orderId,
    quantity: params.quantity,
    source: params.source,
    sub_source: params.subSource,
  }

  const { error } = await params.supabase
    .from('linnworks_sync_queue')
    .insert({
      sku: params.sku,
      action: 'update_stock',
      payload,
      status: 'pending',
    })

  if (error) throw new Error(error.message)
}

async function processLinnworksOpenOrders(request: Request) {
  const startedAt = new Date().toISOString()

  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json().catch(() => ({}))

    const entriesPerPage = Math.min(Number(body.entriesPerPage || 50), 100)
    const pageNumber = Math.max(Number(body.pageNumber || 1), 1)

    const { server, token } = await authoriseLinnworks()

    const openOrdersRaw = await getOpenOrders(server, token, entriesPerPage, pageNumber)
    const openOrderRows = getOpenOrderRows(openOrdersRaw)

    const orderIds = openOrderRows
      .map(getOrderId)
      .filter(Boolean)

    const detailedOrders = await getOpenOrdersDetails(server, token, orderIds)

    const orders = detailedOrders.length > 0 ? detailedOrders : openOrderRows

    const results: any[] = []

    for (const order of orders) {
      const orderId = getOrderId(order)
      const source = getOrderSource(order)
      const subSource = getOrderSubSource(order)
      const items = getOrderItems(order)

      if (!orderId) {
        results.push({
          ok: false,
          skipped: true,
          reason: 'Missing order ID',
          order,
        })
        continue
      }

      if (items.length === 0) {
        results.push({
          ok: true,
          skipped: true,
          orderId,
          reason: 'No order items found',
        })
        continue
      }

      const groupedBySku = new Map<string, any>()

      for (const item of items) {
        const sku = getItemSku(item)
        const quantity = getItemQuantity(item)
        const orderItemId = getOrderItemId(item)

        if (!sku) continue

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

        const existingSale = await supabase
          .from('linnworks_processed_sales')
          .select('id, stock_deducted')
          .eq('linnworks_order_id', orderId)
          .eq('sku', sku)
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

        const itemResult = await supabase
          .from('items')
          .select('id, sku, stock_level, current_location, current_bin')
          .eq('sku', sku)
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

        const currentStockLevel = normaliseNumber(localItem.stock_level) ?? 0
        const newStockLevel = Math.max(0, currentStockLevel - quantity)

        const location =
          normaliseText(localItem.current_location) ||
          normaliseText(body.default_location) ||
          'SHOP-1'

        const bin =
          normaliseText(localItem.current_bin) ||
          normaliseText(body.default_bin) ||
          location

        const salePayload = {
          linnworks_order_id: orderId,
          linnworks_order_item_id: groupedItem.orderItemId || null,
          sku,
          quantity,
          source,
          sub_source: subSource,
          first_seen_status: 'open',
          current_status: 'open',
          stock_deducted: true,
          telegram_sent: false,
          updated_at: new Date().toISOString(),
        }

        if (existingSale.data?.id) {
          const { error: updateSaleError } = await supabase
            .from('linnworks_processed_sales')
            .update(salePayload)
            .eq('id', existingSale.data.id)

          if (updateSaleError) throw new Error(updateSaleError.message)
        } else {
          const { error: insertSaleError } = await supabase
            .from('linnworks_processed_sales')
            .insert(salePayload)

          if (insertSaleError) throw new Error(insertSaleError.message)
        }

        await createQueueRow({
          supabase,
          sku,
          newStockLevel,
          location,
          bin,
          orderId,
          quantity,
          source,
          subSource,
        })

        results.push({
          ok: true,
          orderId,
          sku,
          quantity,
          previousStockLevel: currentStockLevel,
          newStockLevel,
          queueAction: 'update_stock',
          reason: 'online_sale',
        })
      }
    }

    return NextResponse.json({
      ok: true,
      message: 'Linnworks open orders checked.',
      started_at: startedAt,
      raw_open_order_count: openOrderRows.length,
      detailed_order_count: detailedOrders.length,
      order_count: orders.length,
      created_queue_rows: results.filter((row) => row.queueAction === 'update_stock').length,
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

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, message: 'Unauthorised.' }, { status: 401 })
  }

  return processLinnworksOpenOrders(request)
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, message: 'Unauthorised.' }, { status: 401 })
  }

  return processLinnworksOpenOrders(request)
}
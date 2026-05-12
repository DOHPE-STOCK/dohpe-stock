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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function getArrayFromCandidates(data: any, keys: string[]) {
  if (!data) return []
  if (Array.isArray(data)) return data

  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key]
  }

  return []
}

function getOpenOrderIdRows(data: any) {
  return getArrayFromCandidates(data, [
    'Data',
    'data',
    'OrderIds',
    'orderIds',
    'Orders',
    'orders',
    'Items',
    'items',
    'Results',
    'results',
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
      order?.referenceNum ||
      order
  )
}

function getOrderUuid(order: any) {
  const value = normaliseText(
    order?.pkOrderId ||
      order?.PkOrderId ||
      order?.OrderId ||
      order?.orderId ||
      order?.OrderID ||
      order?.orderID ||
      order
  )

  return isUuid(value) ? value : ''
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

function getStockItemsFromFullResponse(data: any) {
  if (!data) return []
  if (Array.isArray(data)) return data

  const candidates = [
    data.Data,
    data.data,
    data.Items,
    data.items,
    data.StockItems,
    data.stockItems,
    data.Results,
    data.results,
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
  }

  return [data]
}

function getStockLevelsFromFullItem(item: any) {
  const candidates = [
    item?.StockLevels,
    item?.stockLevels,
    item?.StockItemLevels,
    item?.stockItemLevels,
    item?.Levels,
    item?.levels,
    item?.Locations,
    item?.locations,
    item?.LocationStockLevels,
    item?.locationStockLevels,
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
  }

  return []
}

function getSkuFromFullItem(item: any) {
  return normaliseText(
    item?.SKU ||
      item?.Sku ||
      item?.sku ||
      item?.ItemNumber ||
      item?.itemNumber ||
      item?.ItemNumberSKU ||
      item?.itemNumberSKU
  )
}

function getStockLevel(row: any) {
  return (
    normaliseNumber(row?.StockLevel) ??
    normaliseNumber(row?.stockLevel) ??
    normaliseNumber(row?.Level) ??
    normaliseNumber(row?.level) ??
    normaliseNumber(row?.Quantity) ??
    normaliseNumber(row?.quantity) ??
    normaliseNumber(row?.OnHand) ??
    normaliseNumber(row?.onHand) ??
    normaliseNumber(row?.InStock) ??
    normaliseNumber(row?.inStock) ??
    0
  )
}

function getAvailableStock(row: any) {
  return (
    normaliseNumber(row?.Available) ??
    normaliseNumber(row?.available) ??
    normaliseNumber(row?.AvailableStock) ??
    normaliseNumber(row?.availableStock) ??
    null
  )
}

async function getAllOpenOrderIds(server: string, token: string) {
  const data = await linnworksPost(server, token, '/api/Orders/GetAllOpenOrders', {
    filters: {},
    sorting: [],
    fulfilmentCenter: DEFAULT_LOCATION_ID,
    additionalFilter: '',
    exactMatch: false,
  })

  const rows = getOpenOrderIdRows(data)

  return [...new Set(rows.map(getOrderUuid).filter(Boolean))]
}

async function getOpenOrdersDetails(server: string, token: string, orderIds: string[]) {
  if (orderIds.length === 0) return []

  const data = await linnworksPost(server, token, '/api/OpenOrders/GetOpenOrdersDetails', {
    OrderIds: orderIds,
    DetailLevel: [],
  })

  return getOpenOrderDetailRows(data)
}

async function getLiveLinnworksStock(server: string, token: string, sku: string) {
  const data = await linnworksPost(server, token, '/api/Stock/GetStockItemsFull', {
    keyword: sku,
    searchTypes: ['SKU'],
    dataRequirements: ['StockLevels'],
    entriesPerPage: 1,
    pageNumber: 1,
    loadCompositeParents: false,
    loadVariationParents: false,
  })

  const fullItems = getStockItemsFromFullResponse(data)
  const fullItem =
    fullItems.find((item) => getSkuFromFullItem(item).toLowerCase() === sku.toLowerCase()) ||
    fullItems[0] ||
    null

  const stockRows = fullItem ? getStockLevelsFromFullItem(fullItem) : []

  const totalStockLevel = stockRows.reduce((sum, row) => {
    return sum + getStockLevel(row)
  }, 0)

  const availableValues = stockRows
    .map(getAvailableStock)
    .filter((value) => value !== null) as number[]

  const totalAvailable =
    availableValues.length > 0
      ? availableValues.reduce((sum, value) => sum + value, 0)
      : null

  return {
    stockFullRaw: data,
    stockRows,
    totalStockLevel,
    totalAvailable,
  }
}

async function getWebAppSkus(supabase: any) {
  const skus = new Set<string>()
  let from = 0
  const pageSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from('items')
      .select('sku')
      .not('sku', 'is', null)
      .range(from, from + pageSize - 1)

    if (error) throw new Error(error.message)

    const rows = data || []

    for (const row of rows) {
      const sku = normaliseText(row.sku).toLowerCase()
      if (sku) skus.add(sku)
    }

    if (rows.length < pageSize) break
    from += pageSize
  }

  return skus
}

async function getAlreadyCheckedOrderIds(supabase: any, orderIds: string[]) {
  if (orderIds.length === 0) return new Set<string>()

  const checked = new Set<string>()

  for (let i = 0; i < orderIds.length; i += 100) {
    const batch = orderIds.slice(i, i + 100)

    const { data, error } = await supabase
      .from('linnworks_checked_open_orders')
      .select('linnworks_order_id')
      .in('linnworks_order_id', batch)

    if (error) throw new Error(error.message)

    for (const row of data || []) {
      const id = normaliseText(row.linnworks_order_id)
      if (id) checked.add(id)
    }
  }

  return checked
}

async function markOrderChecked(params: {
  supabase: any
  orderId: string
  managedSkuFound: boolean
}) {
  const { error } = await params.supabase
    .from('linnworks_checked_open_orders')
    .upsert(
      {
        linnworks_order_id: params.orderId,
        managed_sku_found: params.managedSkuFound,
        checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'linnworks_order_id',
      }
    )

  if (error) throw new Error(error.message)
}

async function createQueueRow(params: {
  supabase: any
  sku: string
  previousStockLevel: number
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
    previous_stock_level: params.previousStockLevel,
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

    const maxOrdersToCheck = Math.min(Number(body.maxOrders || 200), 200)
    const entriesPerPage = maxOrdersToCheck

    const { server, token } = await authoriseLinnworks()

    const webAppSkus = await getWebAppSkus(supabase)
    const allOrderIds = await getAllOpenOrderIds(server, token)
    const alreadyCheckedOrderIds = await getAlreadyCheckedOrderIds(supabase, allOrderIds)

    const uncheckedOrderIds = allOrderIds
      .filter((orderId) => !alreadyCheckedOrderIds.has(orderId))
      .slice(0, entriesPerPage)

    const orders = await getOpenOrdersDetails(server, token, uncheckedOrderIds)

    const results: any[] = []

    for (const order of orders) {
      const orderId = getOrderUuid(order) || getOrderId(order)
      const source = getOrderSource(order)
      const subSource = getOrderSubSource(order)
      const items = getOrderItems(order)

      if (!orderId) {
        results.push({
          ok: false,
          skipped: true,
          reason: 'Missing order ID',
        })
        continue
      }

      if (items.length === 0) {
        await markOrderChecked({
          supabase,
          orderId,
          managedSkuFound: false,
        })

        results.push({
          ok: true,
          skipped: true,
          orderId,
          reason: 'No order items found',
        })
        continue
      }

      let managedSkuFoundForOrder = false
      const groupedBySku = new Map<string, any>()

      for (const item of items) {
        const sku = getItemSku(item)
        const quantity = getItemQuantity(item)
        const orderItemId = getOrderItemId(item)

        if (!sku) continue

        if (!webAppSkus.has(sku.toLowerCase())) {
          results.push({
            ok: true,
            skipped: true,
            orderId,
            sku,
            reason: 'SKU not managed by web app',
          })
          continue
        }

        managedSkuFoundForOrder = true

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

        const liveStock = await getLiveLinnworksStock(server, token, sku)

        const previousStockLevel = liveStock.totalStockLevel
        const newStockLevel =
          liveStock.totalAvailable !== null
            ? liveStock.totalAvailable
            : Math.max(0, previousStockLevel - quantity)

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
          previousStockLevel,
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
          previousStockLevel,
          newStockLevel,
          liveLinnworksStockLevel: liveStock.totalStockLevel,
          liveLinnworksAvailable: liveStock.totalAvailable,
          queueAction: 'update_stock',
          reason: 'online_sale',
        })
      }

      await markOrderChecked({
        supabase,
        orderId,
        managedSkuFound: managedSkuFoundForOrder,
      })
    }

    return NextResponse.json({
      ok: true,
      message: 'Linnworks open orders checked.',
      started_at: startedAt,
      web_app_sku_count: webAppSkus.size,
      all_open_order_id_count: allOrderIds.length,
      already_checked_order_id_count: alreadyCheckedOrderIds.size,
      unchecked_order_id_count: allOrderIds.length - alreadyCheckedOrderIds.size,
      checked_this_run_count: uncheckedOrderIds.length,
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
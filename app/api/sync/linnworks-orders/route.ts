import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const DEFAULT_LOCATION_ID = '00000000-0000-0000-0000-000000000000'
const WAREHOUSE_LOCATION = 'WAREHOUSE'
const WAREHOUSE_BIN = 'Default'
const TRANSFER_REASON = 'online_order_pick'
const PENDING_TRANSFER_STATUS = 'pending_pick'
const PICKED_ITEM_STATUS = 'picked'
const PENDING_ITEM_STATUS = 'pending_pick'

type AppStockRow = {
  id: string
  item_id: string
  sku: string
  location_name: string
  bin_code: string
  stock_level: number
}

type Deduction = {
  location_name: string
  bin_code: string
  quantity: number
  row_id: string
}

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

  const responseText = await response.text()
  let data: any = null

  try {
    data = responseText ? JSON.parse(responseText) : null
  } catch {
    data = responseText
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

function canonicalLocation(value: any) {
  const clean = normaliseText(value)
  const lower = clean.toLowerCase()

  if (!clean) return WAREHOUSE_LOCATION
  if (lower === 'default' || lower === 'warehouse') return WAREHOUSE_LOCATION

  return clean.toUpperCase().startsWith('SHOP-') ? clean.toUpperCase() : clean
}

function isShopLocation(value: any) {
  return canonicalLocation(value).toUpperCase().startsWith('SHOP-')
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
  return normaliseText(order?.Source || order?.source || order?.Channel || order?.channel)
}

function getOrderSubSource(order: any) {
  return normaliseText(
    order?.SubSource || order?.subSource || order?.Subsource || order?.subsource
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

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(`Telegram send failed: ${JSON.stringify(data)}`)
  }

  return {
    ok: true,
    chat_id: chatId,
    message_id: data?.result?.message_id || null,
  }
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

async function getAppStockRows(supabase: any, itemId: string) {
  const { data, error } = await supabase
    .from('item_stock_locations')
    .select('id, item_id, sku, location_name, bin_code, stock_level')
    .eq('item_id', itemId)

  if (error) throw new Error(error.message)

  return (data || []) as AppStockRow[]
}

function sortOnlineDeductionRows(rows: AppStockRow[]) {
  const priority = (row: AppStockRow) => {
    const location = canonicalLocation(row.location_name)
    const bin = normaliseText(row.bin_code).toUpperCase()

    if (location === WAREHOUSE_LOCATION) return 10
    if (isShopLocation(location) && bin === 'STOCK') return 20
    if (isShopLocation(location) && bin === 'FLOOR') return 30
    if (isShopLocation(location)) return 40

    return 90
  }

  return [...rows].sort((a, b) => {
    const ap = priority(a)
    const bp = priority(b)
    if (ap !== bp) return ap - bp
    return Number(b.stock_level || 0) - Number(a.stock_level || 0)
  })
}

async function updateStockRow(supabase: any, rowId: string, stockLevel: number, source: string) {
  const { error } = await supabase
    .from('item_stock_locations')
    .update({
      stock_level: stockLevel,
      source,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId)

  if (error) throw new Error(error.message)
}

async function deductAppBinsForOnlineOrder(params: {
  supabase: any
  itemId: string
  quantity: number
}) {
  const rows = await getAppStockRows(params.supabase, params.itemId)
  let remaining = Math.max(0, Number(params.quantity || 0))
  const deductions: any[] = []

  for (const row of sortOnlineDeductionRows(rows)) {
    if (remaining <= 0) break

    const current = Number(row.stock_level || 0)
    if (current <= 0) continue

    const deduct = Math.min(current, remaining)
    const next = current - deduct

    await updateStockRow(params.supabase, row.id, next, 'linnworks_open_order_reserved')

    deductions.push({
      row_id: row.id,
      location_name: canonicalLocation(row.location_name),
      bin_code: normaliseText(row.bin_code) || WAREHOUSE_BIN,
      quantity: deduct,
    })

    remaining -= deduct
  }

  return {
    requested_quantity: params.quantity,
    deducted_quantity: params.quantity - remaining,
    remaining_quantity: remaining,
    deductions,
  }
}

async function updateItemSummary(supabase: any, itemId: string) {
  const rows = await getAppStockRows(supabase, itemId)

  const stockLevel = rows.reduce((sum, row) => sum + Number(row.stock_level || 0), 0)
  const warehouseStock = rows
    .filter((row) => canonicalLocation(row.location_name) === WAREHOUSE_LOCATION)
    .reduce((sum, row) => sum + Number(row.stock_level || 0), 0)
  const shopFloorStock = rows
    .filter(
      (row) =>
        isShopLocation(row.location_name) &&
        normaliseText(row.bin_code).toUpperCase() === 'FLOOR'
    )
    .reduce((sum, row) => sum + Number(row.stock_level || 0), 0)

  const displayRow =
    rows
      .filter((row) => Number(row.stock_level || 0) > 0)
      .sort((a, b) => Number(b.stock_level || 0) - Number(a.stock_level || 0))[0] || null

  const { error } = await supabase
    .from('items')
    .update({
      stock_level: stockLevel,
      warehouse_stock: warehouseStock,
      shop_floor_stock: shopFloorStock,
      current_location: displayRow ? canonicalLocation(displayRow.location_name) : null,
      current_bin: displayRow?.bin_code || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)

  if (error) throw new Error(error.message)

  return {
    stockLevel,
    warehouseStock,
    shopFloorStock,
  }
}

function todayRange() {
  const now = new Date()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)

  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

async function getNextTransferNumber(supabase: any) {
  const { data, error } = await supabase
    .from('stock_transfers')
    .select('transfer_number')
    .order('transfer_number', { ascending: false })
    .limit(1)

  if (error) throw new Error(error.message)

  return Number(data?.[0]?.transfer_number || 0) + 1
}

async function getOrCreatePendingTransfer(params: {
  supabase: any
  fromLocation: string
}) {
  const { start, end } = todayRange()

  const { data: existing, error: existingError } = await params.supabase
    .from('stock_transfers')
    .select('id, transfer_number')
    .eq('from_location', params.fromLocation)
    .eq('to_location', WAREHOUSE_LOCATION)
    .eq('status', PENDING_TRANSFER_STATUS)
    .eq('reason', TRANSFER_REASON)
    .gte('created_at', start)
    .lt('created_at', end)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existingError) throw new Error(existingError.message)

  if (existing?.id) {
    return existing
  }

  const transferNumber = await getNextTransferNumber(params.supabase)

  const { data: created, error: createError } = await params.supabase
    .from('stock_transfers')
    .insert({
      transfer_number: transferNumber,
      from_location: params.fromLocation,
      to_location: WAREHOUSE_LOCATION,
      status: PENDING_TRANSFER_STATUS,
      reason: TRANSFER_REASON,
    })
    .select('id, transfer_number')
    .single()

  if (createError) throw new Error(createError.message)

  return created
}

function expandDeductions(deductions: Deduction[]) {
  const rows: Deduction[] = []

  for (const deduction of deductions) {
    for (let i = 0; i < deduction.quantity; i += 1) {
      rows.push({
        ...deduction,
        quantity: 1,
      })
    }
  }

  return rows
}

async function addDeductionsToShopTransfers(params: {
  supabase: any
  itemId: string
  sku: string
  orderId: string
  orderItemId: string | null
  deductions: Deduction[]
  telegramByShop: Map<string, any>
}) {
  const shopDeductions = params.deductions.filter((deduction) =>
    isShopLocation(deduction.location_name)
  )

  const transferRows: any[] = []
  const groupedByShop = new Map<string, Deduction[]>()

  for (const deduction of shopDeductions) {
    const shop = canonicalLocation(deduction.location_name)
    const existing = groupedByShop.get(shop) || []
    existing.push(deduction)
    groupedByShop.set(shop, existing)
  }

  for (const [shop, deductions] of groupedByShop) {
    const transfer = await getOrCreatePendingTransfer({
      supabase: params.supabase,
      fromLocation: shop,
    })

    const expanded = expandDeductions(deductions)

    for (const deduction of expanded) {
      transferRows.push({
        transfer_id: transfer.id,
        item_id: params.itemId,
        sku: params.sku,
        status: PENDING_ITEM_STATUS,
        source_order_id: params.orderId,
        source_order_item_id: params.orderItemId,
        source_bin: deduction.bin_code,
        telegram_chat_id: params.telegramByShop.get(shop)?.chat_id || null,
        telegram_message_id: params.telegramByShop.get(shop)?.message_id || null,
      })
    }
  }

  if (transferRows.length === 0) return []

  const { data, error } = await params.supabase
    .from('stock_transfer_items')
    .insert(transferRows)
    .select('id, transfer_id, sku, source_bin, source_order_id')

  if (error) throw new Error(error.message)

  return data || []
}

function formatShopRequiredLines(deductions: Deduction[]) {
  const grouped = new Map<string, number>()

  for (const deduction of deductions.filter((row) => isShopLocation(row.location_name))) {
    const key = `${canonicalLocation(deduction.location_name)} ${deduction.bin_code}`
    grouped.set(key, (grouped.get(key) || 0) + deduction.quantity)
  }

  return Array.from(grouped.entries())
    .map(([key, qty]) => `Required transfer quantity from ${key}: ${qty}`)
    .join('\n')
}

async function sendShopTelegramMessages(params: {
  sku: string
  brand: string
  category: string
  deductions: Deduction[]
  source: string
  subSource: string
  orderId: string
}) {
  const groupedByShop = new Map<string, Deduction[]>()

  for (const deduction of params.deductions.filter((row) => isShopLocation(row.location_name))) {
    const shop = canonicalLocation(deduction.location_name)
    const existing = groupedByShop.get(shop) || []
    existing.push(deduction)
    groupedByShop.set(shop, existing)
  }

  const resultByShop = new Map<string, any>()

  for (const [shop, deductions] of groupedByShop) {
    try {
      const message = `🛒 Online order shop transfer required

SKU: ${params.sku}
Brand: ${params.brand || 'Unknown'}
Category: ${params.category || 'Unknown'}
${formatShopRequiredLines(deductions)}
Source: ${params.source || 'Unknown'}
Sub source: ${params.subSource || 'Unknown'}
Order ID: ${params.orderId}`

      const telegramResult = await sendTelegramMessage(message)
      resultByShop.set(shop, telegramResult)
    } catch (error: any) {
      resultByShop.set(shop, {
        ok: false,
        error: error.message || 'Telegram send failed',
      })
    }
  }

  return resultByShop
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
          .select('id, stock_deducted, telegram_sent')
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
          .select('id, sku, brand, reporting_category, stock_level, current_location, current_bin')
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

        const operationalDeduction = await deductAppBinsForOnlineOrder({
          supabase,
          itemId: localItem.id,
          quantity,
        })

        const summary = await updateItemSummary(supabase, localItem.id)

        const telegramByShop = await sendShopTelegramMessages({
          sku,
          brand: normaliseText(localItem.brand),
          category: normaliseText(localItem.reporting_category),
          deductions: operationalDeduction.deductions,
          source,
          subSource,
          orderId,
        })

        const transferItems = await addDeductionsToShopTransfers({
          supabase,
          itemId: localItem.id,
          sku,
          orderId,
          orderItemId: groupedItem.orderItemId || null,
          deductions: operationalDeduction.deductions,
          telegramByShop,
        })

        const telegramSent = Array.from(telegramByShop.values()).some((row) => row?.ok)

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
          telegram_sent: telegramSent,
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

        results.push({
          ok: true,
          orderId,
          sku,
          quantity,
          operational_deduction: operationalDeduction,
          item_summary: summary,
          transfer_items_created: transferItems.length,
          telegram_sent: telegramSent,
          reason: 'online_sale_reserved_and_transfer_created',
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
      created_queue_rows: 0,
      notification_rows: results.filter((row) => row.telegram_sent).length,
      transfer_items_created: results.reduce(
        (sum, row) => sum + Number(row.transfer_items_created || 0),
        0
      ),
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

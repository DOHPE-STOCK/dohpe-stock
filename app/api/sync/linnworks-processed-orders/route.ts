import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const WAREHOUSE_LOCATION = 'WAREHOUSE'
const WAREHOUSE_BIN = 'Default'
const TRANSFER_REASON = 'online_order_pick'
const ACTIVE_TRANSFER_ITEM_STATUSES = ['pending_pick', 'picked']

type TrackedSale = {
  id: string
  linnworks_order_id: string | null
  sku: string | null
  current_status: string | null
  stock_deducted: boolean | null
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
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
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

function normaliseText(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function canonicalLocation(value: any) {
  const clean = normaliseText(value)
  const lower = clean.toLowerCase()

  if (!clean) return WAREHOUSE_LOCATION
  if (lower === 'default' || lower === 'warehouse') return WAREHOUSE_LOCATION

  return clean.toUpperCase().startsWith('SHOP-') ? clean.toUpperCase() : clean
}

function getArrayFromCandidates(data: any, keys: string[]) {
  if (!data) return []
  if (Array.isArray(data)) return data

  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key]
  }

  return []
}

function getOrderRows(data: any) {
  return getArrayFromCandidates(data, [
    'Data',
    'data',
    'Orders',
    'orders',
    'Items',
    'items',
    'Results',
    'results',
  ])
}

function getOrderUuid(order: any) {
  const value = normaliseText(
    order?.OrderId ||
      order?.orderId ||
      order?.pkOrderId ||
      order?.PkOrderId ||
      order?.OrderID ||
      order?.orderID
  )

  return isUuid(value) ? value : ''
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

function getItemSku(item: any) {
  return normaliseText(
    item?.SKU ||
      item?.Sku ||
      item?.sku ||
      item?.ItemNumber ||
      item?.itemNumber ||
      item?.ItemSKU ||
      item?.itemSku
  )
}

function getProcessedDate(order: any) {
  return normaliseText(
    order?.ProcessedDateTime ||
      order?.processedDateTime ||
      order?.ProcessedOn ||
      order?.processedOn ||
      order?.ProcessedDate ||
      order?.processedDate
  )
}

function getRawStatus(order: any) {
  return normaliseText(
    order?.Status ||
      order?.status ||
      order?.GeneralInfo?.Status ||
      order?.GeneralInfo?.StatusName ||
      order?.generalInfo?.status ||
      order?.generalInfo?.statusName
  )
}

function getPaymentStatus(order: any) {
  return normaliseText(
    order?.PaymentStatus ||
      order?.paymentStatus ||
      order?.PaymentStatusName ||
      order?.paymentStatusName ||
      order?.GeneralInfo?.PaymentStatus ||
      order?.GeneralInfo?.paymentStatus ||
      order?.TotalsInfo?.PaymentStatus ||
      order?.TotalsInfo?.paymentStatus ||
      order?.PaymentInfo?.PaymentStatus ||
      order?.PaymentInfo?.paymentStatus
  )
}

function getTrackingNumber(order: any) {
  return normaliseText(
    order?.ShippingInfo?.TrackingNumber ||
      order?.ShippingInfo?.PostalTrackingNumber ||
      order?.TrackingNumber
  )
}

function getShippingVendor(order: any) {
  return normaliseText(
    order?.ShippingInfo?.Vendor ||
      order?.ShippingInfo?.PostalServiceVendor
  )
}

function getShippingMethod(order: any) {
  return normaliseText(
    order?.ShippingInfo?.PostalServiceName ||
      order?.ShippingMethod
  )
}

function processedOrderContainsSku(order: any, sku: string) {
  const wanted = sku.toLowerCase()
  const items = getOrderItems(order)

  if (items.length === 0) return true

  return items.some((item: any) => getItemSku(item).toLowerCase() === wanted)
}

function orderHasCancellationReference(order: any) {
  const raw = JSON.stringify(order || {}).toLowerCase()

  return (
    raw.includes('cxl_reference') ||
    raw.includes('cancellation reference') ||
    raw.includes('cancel reference')
  )
}

function orderLooksCancelled(order: any) {
  const rawStatus = getRawStatus(order).toLowerCase()
  const paymentStatus = getPaymentStatus(order).toLowerCase()

  return (
    order?.Cancelled === true ||
    order?.cancelled === true ||
    order?.IsCancelled === true ||
    order?.isCancelled === true ||
    paymentStatus.includes('cancel') ||
    rawStatus.includes('cancel') ||
    rawStatus.includes('refund') ||
    rawStatus.includes('return') ||
    rawStatus.includes('void') ||
    orderHasCancellationReference(order)
  )
}

function orderLooksProcessed(order: any) {
  const processedAt = getProcessedDate(order)
  const rawStatus = getRawStatus(order).toLowerCase()

  return (
    order?.Processed === true ||
    order?.processed === true ||
    Boolean(processedAt) ||
    rawStatus === '1' ||
    rawStatus.includes('processed') ||
    rawStatus.includes('dispatch') ||
    rawStatus.includes('shipped') ||
    rawStatus.includes('complete')
  )
}

async function getTrackedOpenSales(
  supabase: any,
  limit: number
): Promise<TrackedSale[]> {
  const { data, error } = await supabase
    .from('linnworks_processed_sales')
    .select('id, linnworks_order_id, sku, current_status, stock_deducted')
    .eq('stock_deducted', true)
    .not('current_status', 'in', '(processed,cancelled)')
    .limit(limit)

  if (error) throw new Error(error.message)

  return (data || []) as TrackedSale[]
}

async function getOrdersById(server: string, token: string, orderIds: string[]) {
  if (orderIds.length === 0) return []

  const data = await linnworksPost(server, token, '/api/Orders/GetOrdersById', {
    pkOrderIds: orderIds,
  })

  return getOrderRows(data)
}

async function sendTelegramReply(params: {
  chatId: string | null
  messageId: string | number | null
  text: string
}) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  if (!botToken || !params.chatId || !params.messageId) {
    return { skipped: true, reason: 'Telegram reply details missing.' }
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: params.chatId,
      reply_to_message_id: params.messageId,
      text: params.text,
    }),
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(`Telegram reply failed: ${JSON.stringify(data)}`)
  }

  return { ok: true }
}

async function sendTelegramMessage(message: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!botToken || !chatId) {
    return { skipped: true, reason: 'Telegram env vars missing.' }
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

  return { ok: true }
}

async function restoreAppStockLocation(params: {
  supabase: any
  itemId: string
  sku: string
  locationName: string
  binCode: string
  quantity: number
}) {
  const locationName = canonicalLocation(params.locationName)
  const binCode = normaliseText(params.binCode) || WAREHOUSE_BIN
  const now = new Date().toISOString()

  const { data, error } = await params.supabase
    .from('item_stock_locations')
    .select('id, stock_level')
    .eq('item_id', params.itemId)
    .eq('location_name', locationName)
    .eq('bin_code', binCode)
    .limit(1)

  if (error) throw new Error(error.message)

  const existing = data?.[0]
  const nextStock = Number(existing?.stock_level || 0) + params.quantity

  if (existing) {
    const { error: updateError } = await params.supabase
      .from('item_stock_locations')
      .update({
        stock_level: nextStock,
        source: 'linnworks_cancelled_order_release',
        updated_at: now,
      })
      .eq('id', existing.id)

    if (updateError) throw new Error(updateError.message)
    return
  }

  const { error: insertError } = await params.supabase
    .from('item_stock_locations')
    .insert({
      item_id: params.itemId,
      sku: params.sku,
      location_name: locationName,
      location_id: null,
      bin_code: binCode,
      stock_level: params.quantity,
      source: 'linnworks_cancelled_order_release',
      synced_at: null,
      updated_at: now,
    })

  if (insertError) throw new Error(insertError.message)
}

async function updateItemSummary(supabase: any, itemId: string) {
  const { data, error } = await supabase
    .from('item_stock_locations')
    .select('location_name, bin_code, stock_level')
    .eq('item_id', itemId)

  if (error) throw new Error(error.message)

  const rows = data || []
  const stockLevel = rows.reduce((sum: number, row: any) => sum + Number(row.stock_level || 0), 0)
  const warehouseStock = rows
    .filter((row: any) => canonicalLocation(row.location_name) === WAREHOUSE_LOCATION)
    .reduce((sum: number, row: any) => sum + Number(row.stock_level || 0), 0)
  const shopFloorStock = rows
    .filter(
      (row: any) =>
        canonicalLocation(row.location_name).startsWith('SHOP-') &&
        normaliseText(row.bin_code).toUpperCase() === 'FLOOR'
    )
    .reduce((sum: number, row: any) => sum + Number(row.stock_level || 0), 0)

  const displayRow =
    rows
      .filter((row: any) => Number(row.stock_level || 0) > 0)
      .sort((a: any, b: any) => Number(b.stock_level || 0) - Number(a.stock_level || 0))[0] || null

  const { error: updateError } = await supabase
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

  if (updateError) throw new Error(updateError.message)

  return { stockLevel, warehouseStock, shopFloorStock }
}

async function updateTransferStatusAfterCancellation(supabase: any, transferId: string) {
  const { data, error } = await supabase
    .from('stock_transfer_items')
    .select('id, status')
    .eq('transfer_id', transferId)

  if (error) throw new Error(error.message)

  const rows = data || []
  if (rows.length === 0) return { updated: false }

  const activeRows = rows.filter((row: any) =>
    !['cancelled', 'canceled', 'received', 'missing'].includes(normaliseText(row.status).toLowerCase())
  )

  if (activeRows.length > 0) return { updated: false }

  const { error: updateError } = await supabase
    .from('stock_transfers')
    .update({ status: 'cancelled' })
    .eq('id', transferId)
    .eq('reason', TRANSFER_REASON)

  if (updateError) throw new Error(updateError.message)

  return { updated: true }
}

async function releaseCancelledShopTransferItems(params: {
  supabase: any
  orderId: string
  sku: string
}) {
  const { data, error } = await params.supabase
    .from('stock_transfer_items')
    .select(`
      id,
      item_id,
      sku,
      status,
      source_bin,
      source_order_id,
      telegram_chat_id,
      telegram_message_id,
      stock_transfers (
        id,
        transfer_number,
        from_location,
        to_location,
        status,
        reason
      )
    `)
    .eq('source_order_id', params.orderId)
    .eq('sku', params.sku)

  if (error) throw new Error(error.message)

  const rows = data || []
  const released: any[] = []
  const leftAlone: any[] = []
  const telegramResults: any[] = []
  const affectedTransferIds = new Set<string>()

  for (const row of rows) {
    const transfer = Array.isArray(row.stock_transfers)
      ? row.stock_transfers[0]
      : row.stock_transfers

    if (!transfer || normaliseText(transfer.reason) !== TRANSFER_REASON) continue

    const status = normaliseText(row.status).toLowerCase()
    const fromLocation = canonicalLocation(transfer.from_location)
    const sourceBin = normaliseText(row.source_bin) || 'STOCK'

    if (ACTIVE_TRANSFER_ITEM_STATUSES.includes(status)) {
      await restoreAppStockLocation({
        supabase: params.supabase,
        itemId: row.item_id,
        sku: row.sku,
        locationName: fromLocation,
        binCode: sourceBin,
        quantity: 1,
      })

      const { error: updateError } = await params.supabase
        .from('stock_transfer_items')
        .update({ status: 'cancelled' })
        .eq('id', row.id)

      if (updateError) throw new Error(updateError.message)

      await updateItemSummary(params.supabase, row.item_id)
      affectedTransferIds.add(transfer.id)

      const message = `🚫 Previous shop pick cancelled

SKU: ${row.sku}
Transfer: #${String(transfer.transfer_number).padStart(7, '0')}
Action: remove item from transfer batch and allocate back to ${fromLocation} / ${sourceBin}`

      let telegram: any = { skipped: true }

      try {
        if (row.telegram_chat_id && row.telegram_message_id) {
          telegram = await sendTelegramReply({
            chatId: row.telegram_chat_id,
            messageId: row.telegram_message_id,
            text: message,
          })
        } else {
          telegram = await sendTelegramMessage(message)
        }
      } catch (telegramError: any) {
        telegram = { ok: false, error: telegramError.message || 'Telegram cancellation message failed.' }
      }

      telegramResults.push(telegram)
      released.push({
        transfer_id: transfer.id,
        transfer_number: transfer.transfer_number,
        transfer_item_id: row.id,
        sku: row.sku,
        restored_to: `${fromLocation} / ${sourceBin}`,
        previous_status: row.status,
      })

      continue
    }

    leftAlone.push({
      transfer_id: transfer.id,
      transfer_number: transfer.transfer_number,
      transfer_item_id: row.id,
      sku: row.sku,
      status: row.status,
      reason: 'Transfer item already in transit/received/cancelled, no app stock release applied.',
    })
  }

  const transferStatusUpdates: any[] = []
  for (const transferId of affectedTransferIds) {
    transferStatusUpdates.push(await updateTransferStatusAfterCancellation(params.supabase, transferId))
  }

  return { released, left_alone: leftAlone, telegram: telegramResults, transfer_status_updates: transferStatusUpdates }
}

async function processProcessedOrders(request: Request) {
  const startedAt = new Date().toISOString()

  try {
    const supabase = getSupabaseAdmin()
    const url = new URL(request.url)
    const debug = url.searchParams.get('debug') === 'true'

    const trackedSales = await getTrackedOpenSales(supabase, 200)
    const { server, token } = await authoriseLinnworks()

    const orderIds = trackedSales
      .map((sale: TrackedSale) => normaliseText(sale.linnworks_order_id))
      .filter((id: string) => isUuid(id))

    const orders = await getOrdersById(server, token, orderIds)
    const results: any[] = []

    for (const sale of trackedSales) {
      const sku = normaliseText(sale.sku)
      const orderId = normaliseText(sale.linnworks_order_id)

      const order = orders.find((candidate: any) => {
        return getOrderUuid(candidate).toLowerCase() === orderId.toLowerCase()
      })

      if (!order) {
        results.push({
          ok: true,
          skipped: true,
          sku,
          linnworks_order_id: sale.linnworks_order_id,
          reason: 'Order not returned; no cancellation assumed.',
        })
        continue
      }

      if (!processedOrderContainsSku(order, sku)) {
        results.push({
          ok: true,
          skipped: true,
          sku,
          linnworks_order_id: sale.linnworks_order_id,
          reason: 'SKU not found on returned order.',
        })
        continue
      }

      if (orderLooksCancelled(order)) {
        const releaseResult = await releaseCancelledShopTransferItems({
          supabase,
          orderId,
          sku,
        })

        const { error: saleError } = await supabase
          .from('linnworks_processed_sales')
          .update({
            current_status: 'cancelled',
            stock_deducted: false,
            updated_at: new Date().toISOString(),
          })
          .eq('id', sale.id)

        if (saleError) throw new Error(saleError.message)

        results.push({
          ok: true,
          sku,
          linnworks_order_id: sale.linnworks_order_id,
          current_status: 'cancelled',
          payment_status: getPaymentStatus(order),
          raw_status: getRawStatus(order),
          cancellation_reference_found: orderHasCancellationReference(order),
          release_result: releaseResult,
          debug_order: debug ? order : undefined,
        })

        continue
      }

      if (!orderLooksProcessed(order)) {
        results.push({
          ok: true,
          skipped: true,
          sku,
          linnworks_order_id: sale.linnworks_order_id,
          reason: 'Order returned but does not look processed/cancelled yet.',
          raw_status: getRawStatus(order),
          payment_status: getPaymentStatus(order),
          processed_at: getProcessedDate(order),
          debug_order: debug ? order : undefined,
        })
        continue
      }

      const processedAt = getProcessedDate(order) || new Date().toISOString()
      const trackingNumber = getTrackingNumber(order)
      const shippingVendor = getShippingVendor(order)
      const shippingMethod = getShippingMethod(order)

      const { error: saleError } = await supabase
        .from('linnworks_processed_sales')
        .update({
          current_status: 'processed',
          processed_at: processedAt,
          tracking_number: trackingNumber || null,
          shipping_vendor: shippingVendor || null,
          shipping_method: shippingMethod || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sale.id)

      if (saleError) throw new Error(saleError.message)

      const { error: itemError } = await supabase
        .from('items')
        .update({
          status: 'processed',
          updated_at: new Date().toISOString(),
        })
        .eq('sku', sku)

      if (itemError) throw new Error(itemError.message)

      results.push({
        ok: true,
        sku,
        linnworks_order_id: sale.linnworks_order_id,
        item_status: 'processed',
        current_status: 'processed',
        processed_at: processedAt,
        tracking_number: trackingNumber || null,
        shipping_vendor: shippingVendor || null,
        shipping_method: shippingMethod || null,
      })
    }

    return NextResponse.json({
      ok: true,
      message: 'Linnworks processed orders checked.',
      started_at: startedAt,
      tracked_sale_count: trackedSales.length,
      processed: results.filter((x: any) => x.ok && !x.skipped && x.current_status === 'processed').length,
      cancelled: results.filter((x: any) => x.ok && x.current_status === 'cancelled').length,
      skipped: results.filter((x: any) => x.skipped).length,
      failed: 0,
      debug,
      results,
    })
  } catch (error: any) {
    console.error('LINNWORKS_PROCESSED_ORDERS_SYNC_ERROR', error)

    return NextResponse.json(
      {
        ok: false,
        message: error.message || 'Unknown Linnworks processed orders sync error.',
      },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, message: 'Unauthorised.' }, { status: 401 })
  }

  return processProcessedOrders(request)
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, message: 'Unauthorised.' }, { status: 401 })
  }

  return processProcessedOrders(request)
}

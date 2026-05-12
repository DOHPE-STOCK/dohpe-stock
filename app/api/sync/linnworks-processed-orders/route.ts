import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

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
    order?.pkOrderId ||
      order?.PkOrderId ||
      order?.OrderId ||
      order?.orderId ||
      order?.OrderID ||
      order?.orderID ||
      order?.Id ||
      order?.id ||
      order?.GeneralInfo?.OrderId ||
      order?.generalInfo?.orderId ||
      order?.GeneralInfo?.pkOrderId ||
      order?.generalInfo?.pkOrderId
  )

  return isUuid(value) ? value : ''
}

function getOrderNumber(order: any) {
  return normaliseText(
    order?.nOrderId ||
      order?.NumOrderId ||
      order?.numOrderId ||
      order?.OrderNumber ||
      order?.orderNumber ||
      order?.GeneralInfo?.OrderNumber ||
      order?.generalInfo?.orderNumber ||
      order?.GeneralInfo?.NumOrderId ||
      order?.generalInfo?.numOrderId
  )
}

function getOrderReference(order: any) {
  return normaliseText(
    order?.ReferenceNum ||
      order?.referenceNum ||
      order?.ReferenceNumber ||
      order?.referenceNumber ||
      order?.ExternalReference ||
      order?.externalReference ||
      order?.GeneralInfo?.ReferenceNum ||
      order?.generalInfo?.referenceNum
  )
}

function getProcessedDate(order: any) {
  return normaliseText(
    order?.dProcessedOn ||
      order?.ProcessedOn ||
      order?.processedOn ||
      order?.ProcessedDate ||
      order?.processedDate ||
      order?.ProcessDate ||
      order?.processDate ||
      order?.GeneralInfo?.ProcessedOn ||
      order?.generalInfo?.processedOn ||
      order?.GeneralInfo?.dProcessedOn ||
      order?.generalInfo?.dProcessedOn
  )
}

function getRawStatus(order: any) {
  return normaliseText(
    order?.Status ||
      order?.status ||
      order?.OrderStatus ||
      order?.orderStatus ||
      order?.GeneralInfo?.Status ||
      order?.generalInfo?.status ||
      order?.GeneralInfo?.OrderStatus ||
      order?.generalInfo?.orderStatus
  )
}

function getTrackingNumber(order: any) {
  return normaliseText(
    order?.PostalTrackingNumber ||
      order?.postalTrackingNumber ||
      order?.TrackingNumber ||
      order?.trackingNumber ||
      order?.TrackingNo ||
      order?.trackingNo ||
      order?.ShippingInfo?.TrackingNumber ||
      order?.shippingInfo?.trackingNumber ||
      order?.ShippingInfo?.PostalTrackingNumber ||
      order?.shippingInfo?.postalTrackingNumber
  )
}

function getTrackingUrl(order: any) {
  return normaliseText(
    order?.TrackingUrl ||
      order?.trackingUrl ||
      order?.PostalTrackingUrl ||
      order?.postalTrackingUrl ||
      order?.ShippingInfo?.TrackingUrl ||
      order?.shippingInfo?.trackingUrl
  )
}

function getShippingVendor(order: any) {
  return normaliseText(
    order?.ShippingVendor ||
      order?.shippingVendor ||
      order?.PostalServiceVendor ||
      order?.postalServiceVendor ||
      order?.Vendor ||
      order?.vendor ||
      order?.Courier ||
      order?.courier ||
      order?.ShippingInfo?.Vendor ||
      order?.shippingInfo?.vendor ||
      order?.ShippingInfo?.PostalServiceVendor ||
      order?.shippingInfo?.postalServiceVendor
  )
}

function getShippingMethod(order: any) {
  return normaliseText(
    order?.ShippingMethod ||
      order?.shippingMethod ||
      order?.PostalServiceName ||
      order?.postalServiceName ||
      order?.PostalService ||
      order?.postalService ||
      order?.ShippingInfo?.PostalServiceName ||
      order?.shippingInfo?.postalServiceName ||
      order?.ShippingInfo?.PostalService ||
      order?.shippingInfo?.postalService
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

async function getTrackedOpenSales(supabase: any, limit: number): Promise<TrackedSale[]> {
  const { data, error } = await supabase
    .from('linnworks_processed_sales')
    .select('id, linnworks_order_id, sku, current_status, stock_deducted')
    .eq('stock_deducted', true)
    .neq('current_status', 'processed')
    .order('updated_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(error.message)

  return (data || []) as TrackedSale[]
}

async function getOrdersById(server: string, token: string, orderIds: string[]) {
  if (orderIds.length === 0) {
    return { raw: [], rows: [] }
  }

  const data = await linnworksPost(server, token, '/api/Orders/GetOrdersById', {
    pkOrderIds: orderIds,
  })

  return {
    raw: data,
    rows: getOrderRows(data),
  }
}

function processedOrderContainsSku(order: any, sku: string) {
  const wanted = sku.toLowerCase()
  const items = getOrderItems(order)

  if (items.length === 0) return true

  return items.some((item: any) => getItemSku(item).toLowerCase() === wanted)
}

function makeDebugCandidate(order: any, sku: string) {
  return {
    keys: Object.keys(order || {}),
    order_uuid: getOrderUuid(order),
    order_number: getOrderNumber(order),
    order_reference: getOrderReference(order),
    raw_status: getRawStatus(order) || null,
    processed_at: getProcessedDate(order) || null,
    tracking_number: getTrackingNumber(order) || null,
    tracking_url: getTrackingUrl(order) || null,
    shipping_vendor: getShippingVendor(order) || null,
    shipping_method: getShippingMethod(order) || null,
    contains_sku: processedOrderContainsSku(order, sku),
    item_count: getOrderItems(order).length,
    item_skus: getOrderItems(order).map((item: any) => getItemSku(item)).filter(Boolean).slice(0, 20),
    raw_preview: order,
  }
}

function orderLooksProcessed(order: any) {
  const processedAt = getProcessedDate(order)
  const rawStatus = getRawStatus(order).toLowerCase()

  return (
    Boolean(processedAt) ||
    rawStatus.includes('processed') ||
    rawStatus.includes('dispatch') ||
    rawStatus.includes('dispatched') ||
    rawStatus.includes('shipped') ||
    rawStatus.includes('complete') ||
    rawStatus.includes('completed')
  )
}

async function processProcessedOrders(request: Request) {
  const startedAt = new Date().toISOString()

  try {
    const supabase = getSupabaseAdmin()
    const url = new URL(request.url)
    const body = await request.json().catch(() => ({}))

    const debug = url.searchParams.get('debug') === 'true' || body.debug === true
    const limit = Math.min(Number(body.limit || 100), 200)

    const trackedSales = await getTrackedOpenSales(supabase, limit)

    if (trackedSales.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No tracked open sales waiting for processed status.',
        started_at: startedAt,
        processed: 0,
        skipped: 0,
        failed: 0,
        debug,
        results: [],
      })
    }

    const { server, token } = await authoriseLinnworks()

    const trackedOrderIds: string[] = [
      ...new Set(
        trackedSales
          .map((sale: TrackedSale): string => normaliseText(sale.linnworks_order_id))
          .filter((id: string): boolean => isUuid(id))
      ),
    ]

    const orderDetailsResult = await getOrdersById(server, token, trackedOrderIds)
    const orderDetails = orderDetailsResult.rows

    const results: any[] = []

    for (const sale of trackedSales) {
      const sku = normaliseText(sale.sku)
      const wantedOrderId = normaliseText(sale.linnworks_order_id).toLowerCase()

      const matchedOrder =
        orderDetails.find((order: any) => {
          const orderUuid = getOrderUuid(order).toLowerCase()
          return orderUuid && orderUuid === wantedOrderId
        }) || null

      if (!matchedOrder) {
        results.push({
          ok: true,
          skipped: true,
          sku,
          linnworks_order_id: sale.linnworks_order_id,
          reason: 'Order not returned by Orders/GetOrdersById',
          order_details_count: orderDetails.length,
          debug_raw_keys:
            debug && orderDetailsResult.raw && typeof orderDetailsResult.raw === 'object'
              ? Object.keys(orderDetailsResult.raw)
              : undefined,
          debug_raw_preview: debug ? orderDetailsResult.raw : undefined,
        })
        continue
      }

      const containsSku = processedOrderContainsSku(matchedOrder, sku)

      if (!containsSku) {
        results.push({
          ok: true,
          skipped: true,
          sku,
          linnworks_order_id: sale.linnworks_order_id,
          reason: 'Order returned but SKU not found on order',
          debug_matched_order: debug ? makeDebugCandidate(matchedOrder, sku) : undefined,
        })
        continue
      }

      const processedAt = getProcessedDate(matchedOrder)
      const rawStatus = getRawStatus(matchedOrder)
      const looksProcessed = orderLooksProcessed(matchedOrder)

      if (!looksProcessed) {
        results.push({
          ok: true,
          skipped: true,
          sku,
          linnworks_order_id: sale.linnworks_order_id,
          reason: 'Order returned but does not look processed yet',
          raw_status: rawStatus || null,
          processed_at: processedAt || null,
          debug_matched_order: debug ? makeDebugCandidate(matchedOrder, sku) : undefined,
        })
        continue
      }

      const finalProcessedAt = processedAt || new Date().toISOString()
      const trackingNumber = getTrackingNumber(matchedOrder)
      const trackingUrl = getTrackingUrl(matchedOrder)
      const shippingVendor = getShippingVendor(matchedOrder)
      const shippingMethod = getShippingMethod(matchedOrder)

      const { error: updateSaleError } = await supabase
        .from('linnworks_processed_sales')
        .update({
          current_status: 'processed',
          processed_at: finalProcessedAt,
          tracking_number: trackingNumber || null,
          tracking_url: trackingUrl || null,
          shipping_vendor: shippingVendor || null,
          shipping_method: shippingMethod || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sale.id)

      if (updateSaleError) throw new Error(updateSaleError.message)

      const { error: updateItemError } = await supabase
        .from('items')
        .update({
          status: 'sold',
          updated_at: new Date().toISOString(),
        })
        .eq('sku', sku)

      if (updateItemError) throw new Error(updateItemError.message)

      results.push({
        ok: true,
        sku,
        linnworks_order_id: sale.linnworks_order_id,
        order_uuid_found: getOrderUuid(matchedOrder),
        order_number: getOrderNumber(matchedOrder),
        order_reference: getOrderReference(matchedOrder),
        raw_status: rawStatus || null,
        current_status: 'processed',
        processed_at: finalProcessedAt,
        tracking_number: trackingNumber || null,
        tracking_url: trackingUrl || null,
        shipping_vendor: shippingVendor || null,
        shipping_method: shippingMethod || null,
        debug_matched_order: debug ? makeDebugCandidate(matchedOrder, sku) : undefined,
      })
    }

    return NextResponse.json({
      ok: true,
      message: 'Linnworks processed orders checked.',
      started_at: startedAt,
      tracked_sale_count: trackedSales.length,
      tracked_order_id_count: trackedOrderIds.length,
      order_details_count: orderDetails.length,
      processed: results.filter((row: any) => row.ok && !row.skipped).length,
      skipped: results.filter((row: any) => row.skipped).length,
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

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, message: 'Unauthorised.' }, { status: 401 })
  }

  return processProcessedOrders(request)
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, message: 'Unauthorised.' }, { status: 401 })
  }

  return processProcessedOrders(request)
}
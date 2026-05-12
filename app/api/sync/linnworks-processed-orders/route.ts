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

function getArrayFromCandidates(data: any, keys: string[]) {
  if (!data) return []

  if (Array.isArray(data)) return data

  for (const key of keys) {
    if (Array.isArray(data?.[key])) {
      return data[key]
    }
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
      order?.PkOrderId
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
      item?.itemNumber
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
      order?.GeneralInfo?.Status
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

  return items.some((item: any) => {
    return getItemSku(item).toLowerCase() === wanted
  })
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
    .neq('current_status', 'processed')
    .limit(limit)

  if (error) {
    throw new Error(error.message)
  }

  return (data || []) as TrackedSale[]
}

async function getOrdersById(
  server: string,
  token: string,
  orderIds: string[]
) {
  if (orderIds.length === 0) {
    return []
  }

  const data = await linnworksPost(
    server,
    token,
    '/api/Orders/GetOrdersById',
    {
      pkOrderIds: orderIds,
    }
  )

  return getOrderRows(data)
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
      .map((sale) => normaliseText(sale.linnworks_order_id))
      .filter((id) => isUuid(id))

    const orders = await getOrdersById(server, token, orderIds)

    const results: any[] = []

    for (const sale of trackedSales) {
      const sku = normaliseText(sale.sku)

      const order = orders.find((candidate: any) => {
        return (
          getOrderUuid(candidate).toLowerCase() ===
          normaliseText(sale.linnworks_order_id).toLowerCase()
        )
      })

      if (!order) {
        results.push({
          ok: true,
          skipped: true,
          sku,
          linnworks_order_id: sale.linnworks_order_id,
          reason: 'Order not returned',
        })

        continue
      }

      if (!processedOrderContainsSku(order, sku)) {
        results.push({
          ok: true,
          skipped: true,
          sku,
          linnworks_order_id: sale.linnworks_order_id,
          reason: 'SKU not found on returned order',
        })

        continue
      }

      if (!orderLooksProcessed(order)) {
        results.push({
          ok: true,
          skipped: true,
          sku,
          linnworks_order_id: sale.linnworks_order_id,
          reason: 'Order returned but does not look processed yet',
          raw_status: getRawStatus(order),
          processed_at: getProcessedDate(order),
          debug_order: debug ? order : undefined,
        })

        continue
      }

      const processedAt =
        getProcessedDate(order) || new Date().toISOString()

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

      if (saleError) {
        throw new Error(saleError.message)
      }

      const { error: itemError } = await supabase
        .from('items')
        .update({
          status: 'sold',
          updated_at: new Date().toISOString(),
        })
        .eq('sku', sku)

      if (itemError) {
        throw new Error(itemError.message)
      }

      results.push({
        ok: true,
        sku,
        linnworks_order_id: sale.linnworks_order_id,
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
      processed: results.filter((x) => x.ok && !x.skipped).length,
      skipped: results.filter((x) => x.skipped).length,
      failed: 0,
      debug,
      results,
    })
  } catch (error: any) {
    console.error('LINNWORKS_PROCESSED_ORDERS_SYNC_ERROR', error)

    return NextResponse.json(
      {
        ok: false,
        message:
          error.message || 'Unknown Linnworks processed orders sync error.',
      },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { ok: false, message: 'Unauthorised.' },
      { status: 401 }
    )
  }

  return processProcessedOrders(request)
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { ok: false, message: 'Unauthorised.' },
      { status: 401 }
    )
  }

  return processProcessedOrders(request)
}
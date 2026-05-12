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

function isoDaysAgo(days: number) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString()
}

function getArrayFromCandidates(data: any, keys: string[]) {
  if (!data) return []
  if (Array.isArray(data)) return data

  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key]
  }

  return []
}

function getProcessedOrderRows(data: any) {
  return getArrayFromCandidates(data, [
    'Data',
    'data',
    'Orders',
    'orders',
    'ProcessedOrders',
    'processedOrders',
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
      order?.id
  )

  return isUuid(value) ? value : ''
}

function getOrderNumber(order: any) {
  return normaliseText(
    order?.nOrderId ||
      order?.NumOrderId ||
      order?.numOrderId ||
      order?.OrderNumber ||
      order?.orderNumber
  )
}

function getOrderReference(order: any) {
  return normaliseText(
    order?.ReferenceNum ||
      order?.referenceNum ||
      order?.ReferenceNumber ||
      order?.referenceNumber ||
      order?.ExternalReference ||
      order?.externalReference
  )
}

function getProcessedDate(order: any) {
  return normaliseText(
    order?.dProcessedOn ||
      order?.ProcessedOn ||
      order?.processedOn ||
      order?.ProcessDate ||
      order?.processDate ||
      order?.ProcessedDate ||
      order?.processedDate
  )
}

function getTrackingNumber(order: any) {
  return normaliseText(
    order?.PostalTrackingNumber ||
      order?.postalTrackingNumber ||
      order?.TrackingNumber ||
      order?.trackingNumber ||
      order?.TrackingNo ||
      order?.trackingNo
  )
}

function getTrackingUrl(order: any) {
  return normaliseText(
    order?.TrackingUrl ||
      order?.trackingUrl ||
      order?.PostalTrackingUrl ||
      order?.postalTrackingUrl
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
      order?.courier
  )
}

function getShippingMethod(order: any) {
  return normaliseText(
    order?.ShippingMethod ||
      order?.shippingMethod ||
      order?.PostalServiceName ||
      order?.postalServiceName ||
      order?.PostalService ||
      order?.postalService
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

async function getTrackedOpenSales(supabase: any, limit: number) {
  const { data, error } = await supabase
    .from('linnworks_processed_sales')
    .select('id, linnworks_order_id, sku, current_status, stock_deducted')
    .eq('stock_deducted', true)
    .neq('current_status', 'processed')
    .order('updated_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(error.message)

  return data || []
}

async function searchProcessedOrdersBySku(params: {
  server: string
  token: string
  sku: string
  from: string
  to: string
  pageNum: number
  entriesPerPage: number
}) {
  const data = await linnworksPost(
    params.server,
    params.token,
    '/api/ProcessedOrders/SearchProcessedOrdersPaged',
    {
      from: params.from,
      to: params.to,
      dateType: 'PROCESSED',
      searchField: 'SKU',
      exactMatch: true,
      searchTerm: params.sku,
      pageNum: params.pageNum,
      numEntriesPerPage: params.entriesPerPage,
    }
  )

  return getProcessedOrderRows(data)
}

function processedOrderContainsSku(order: any, sku: string) {
  const wanted = sku.toLowerCase()
  const items = getOrderItems(order)

  if (items.length === 0) {
    return true
  }

  return items.some((item) => getItemSku(item).toLowerCase() === wanted)
}

async function processProcessedOrders(request: Request) {
  const startedAt = new Date().toISOString()

  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json().catch(() => ({}))

    const limit = Math.min(Number(body.limit || 100), 200)
    const lookbackDays = Math.min(Number(body.lookbackDays || 30), 90)
    const entriesPerPage = Math.min(Number(body.entriesPerPage || 200), 200)

    const from = normaliseText(body.from) || isoDaysAgo(lookbackDays)
    const to = normaliseText(body.to) || new Date().toISOString()

    const trackedSales = await getTrackedOpenSales(supabase, limit)

    if (trackedSales.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No tracked open sales waiting for processed status.',
        started_at: startedAt,
        processed: 0,
        failed: 0,
        results: [],
      })
    }

    const { server, token } = await authoriseLinnworks()

    const salesBySku = new Map<string, any[]>()

    for (const sale of trackedSales) {
      const sku = normaliseText(sale.sku)
      if (!sku) continue

      const key = sku.toLowerCase()
      const existing = salesBySku.get(key) || []
      existing.push(sale)
      salesBySku.set(key, existing)
    }

    const results: any[] = []

    for (const [skuKey, sales] of salesBySku.entries()) {
      const sku = sales[0].sku

      const processedOrders = await searchProcessedOrdersBySku({
        server,
        token,
        sku,
        from,
        to,
        pageNum: 1,
        entriesPerPage,
      })

      for (const sale of sales) {
        const wantedOrderId = normaliseText(sale.linnworks_order_id).toLowerCase()

        const matchedOrder =
          processedOrders.find((order) => {
            const orderUuid = getOrderUuid(order).toLowerCase()
            return orderUuid && orderUuid === wantedOrderId && processedOrderContainsSku(order, sku)
          }) || null

        if (!matchedOrder) {
          results.push({
            ok: true,
            skipped: true,
            sku,
            linnworks_order_id: sale.linnworks_order_id,
            reason: 'Not processed yet',
          })
          continue
        }

        const processedAt = getProcessedDate(matchedOrder) || new Date().toISOString()
        const trackingNumber = getTrackingNumber(matchedOrder)
        const trackingUrl = getTrackingUrl(matchedOrder)
        const shippingVendor = getShippingVendor(matchedOrder)
        const shippingMethod = getShippingMethod(matchedOrder)

        const { error: updateSaleError } = await supabase
          .from('linnworks_processed_sales')
          .update({
            current_status: 'processed',
            processed_at: processedAt,
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
          current_status: 'processed',
          processed_at: processedAt,
          tracking_number: trackingNumber || null,
          tracking_url: trackingUrl || null,
          shipping_vendor: shippingVendor || null,
          shipping_method: shippingMethod || null,
        })
      }
    }

    return NextResponse.json({
      ok: true,
      message: 'Linnworks processed orders checked.',
      started_at: startedAt,
      tracked_sale_count: trackedSales.length,
      processed: results.filter((row) => row.ok && !row.skipped).length,
      skipped: results.filter((row) => row.skipped).length,
      failed: 0,
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
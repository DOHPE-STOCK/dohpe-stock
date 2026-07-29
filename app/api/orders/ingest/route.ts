import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { upsertLoopbaseOrder, upsertLoopbaseOrderLine } from '@/lib/orderManagement'
import { recalculateStockSummaryForSku, upsertStockReservation } from '@/lib/stockSummary'

export const dynamic = 'force-dynamic'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('Missing Supabase admin environment variables.')
  }

  return createClient(url, serviceKey)
}

function text(value: unknown) {
  return String(value || '').trim()
}

function numberValue(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

async function findItemBySku(supabase: any, companyId: string, sku: string) {
  const { data, error } = await supabase
    .from('items')
    .select('id, company_id, sku')
    .eq('company_id', companyId)
    .eq('sku', sku)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data || null
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, message: 'Unauthorised.' }, { status: 401 })
  }

  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json().catch(() => ({}))

    const companyId = text(body.company_id || body.companyId)
    const source = text(body.order_source || body.source)
    const externalOrderId = text(body.external_order_id || body.externalOrderId || body.order_id)
    const stockMode = text(body.stock_mode || body.stockMode) || 'reservation_only'
    const lines = Array.isArray(body.lines) ? body.lines : []

    if (!companyId || !source || !externalOrderId) {
      return NextResponse.json(
        { ok: false, message: 'company_id, source and external_order_id are required.' },
        { status: 400 }
      )
    }

    if (!['reservation_only', 'physical_deducted', 'external_managed'].includes(stockMode)) {
      return NextResponse.json({ ok: false, message: 'Invalid stock_mode.' }, { status: 400 })
    }

    const order = await upsertLoopbaseOrder(supabase, {
      companyId,
      source,
      externalOrderId,
      externalOrderNumber: body.external_order_number || body.externalOrderNumber || null,
      channel: body.channel || source,
      subChannel: body.sub_channel || body.subChannel || null,
      status: body.status || 'open',
      paymentStatus: body.payment_status || body.paymentStatus || null,
      fulfilmentStatus: body.fulfilment_status || body.fulfilmentStatus || null,
      stockMode: stockMode as 'reservation_only' | 'physical_deducted' | 'external_managed',
      buyerName: body.buyer_name || body.buyerName || null,
      buyerEmail: body.buyer_email || body.buyerEmail || null,
      buyerUsername: body.buyer_username || body.buyerUsername || null,
      shippingAddress: body.shipping_address || body.shippingAddress || null,
      shippingCountry: body.shipping_country || body.shippingCountry || null,
      currency: body.currency || null,
      totalAmount: body.total_amount || body.totalAmount || null,
      shippingCost: body.shipping_cost || body.shippingCost || null,
      orderedAt: body.ordered_at || body.orderedAt || null,
      rawPayload: body.raw_payload || body.rawPayload || {},
    })

    if (!order?.id) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        message: 'Loopbase order tables are not migrated yet.',
      })
    }

    const results = []

    for (const line of lines) {
      const sku = text(line.sku).toUpperCase()
      const quantity = Math.max(0, numberValue(line.quantity, 1))
      const externalLineId = text(line.external_line_id || line.externalLineId) || sku

      if (!sku || quantity <= 0) {
        results.push({ sku, ok: false, message: 'Line skipped because SKU or quantity is missing.' })
        continue
      }

      const item = await findItemBySku(supabase, companyId, sku)
      const reservation =
        item?.id && stockMode !== 'external_managed'
          ? await upsertStockReservation(supabase, {
              companyId,
              itemId: item.id,
              sku,
              channel: body.channel || source,
              source,
              externalOrderId,
              externalOrderReference: externalLineId,
              quantity,
              stockAlreadyDeducted: stockMode === 'physical_deducted',
              metadata: {
                order_source: source,
                external_line_id: externalLineId,
              },
            })
          : null

      const orderLine = await upsertLoopbaseOrderLine(supabase, {
        companyId,
        orderId: order.id,
        itemId: item?.id || null,
        sku,
        externalLineId,
        status: item?.id ? 'reserved' : 'failed',
        quantity,
        reservedQuantity: item?.id && stockMode !== 'external_managed' ? quantity : 0,
        reservationId: reservation?.id || null,
        unitPrice: line.unit_price || line.unitPrice || null,
        rawPayload: line.raw_payload || line.rawPayload || line,
      })

      if (item?.id) await recalculateStockSummaryForSku(supabase, companyId, sku)

      results.push({
        sku,
        ok: Boolean(item?.id),
        item_id: item?.id || null,
        order_line_id: orderLine?.id || null,
        reservation_id: reservation?.id || null,
        message: item?.id ? 'Order line ingested.' : 'Item was not found for this company.',
      })
    }

    return NextResponse.json({
      ok: results.every((result) => result.ok),
      order_id: order.id,
      stock_mode: stockMode,
      lines: results,
    })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'Order ingest failed.' },
      { status: 500 }
    )
  }
}

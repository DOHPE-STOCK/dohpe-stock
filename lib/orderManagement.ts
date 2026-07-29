import type { SupabaseLike } from '@/lib/stockSummary'

function text(value: unknown) {
  return String(value || '').trim()
}

function numberValue(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function missingTable(error: any, table: string) {
  const message = String(error?.message || '')
  const code = String(error?.code || '')
  return code === '42P01' || message.includes(table)
}

export type LoopbaseOrderInput = {
  companyId: string
  source: string
  externalOrderId: string
  externalOrderNumber?: string | null
  channel?: string | null
  subChannel?: string | null
  status?: string | null
  paymentStatus?: string | null
  fulfilmentStatus?: string | null
  stockMode?: 'reservation_only' | 'physical_deducted' | 'external_managed'
  buyerName?: string | null
  buyerEmail?: string | null
  buyerUsername?: string | null
  shippingAddress?: Record<string, any> | null
  shippingCountry?: string | null
  currency?: string | null
  totalAmount?: number | string | null
  shippingCost?: number | string | null
  orderedAt?: string | null
  rawPayload?: Record<string, any>
}

export type LoopbaseOrderLineInput = {
  companyId: string
  orderId: string
  itemId?: string | null
  sku: string
  externalLineId?: string | null
  status?: string | null
  quantity?: number | string | null
  reservedQuantity?: number | string | null
  pickedQuantity?: number | string | null
  dispatchedQuantity?: number | string | null
  cancelledQuantity?: number | string | null
  reservationId?: string | null
  transferItemIds?: string[]
  unitPrice?: number | string | null
  rawPayload?: Record<string, any>
}

export async function upsertLoopbaseOrder(
  supabase: SupabaseLike,
  input: LoopbaseOrderInput
) {
  const companyId = text(input.companyId)
  const source = text(input.source)
  const externalOrderId = text(input.externalOrderId)
  if (!companyId || !source || !externalOrderId) return null

  const now = new Date().toISOString()
  const payload = {
    company_id: companyId,
    order_source: source,
    external_order_id: externalOrderId,
    external_order_number: input.externalOrderNumber || null,
    channel: text(input.channel) || 'unknown',
    sub_channel: input.subChannel || null,
    order_status: text(input.status) || 'open',
    payment_status: input.paymentStatus || null,
    fulfilment_status: input.fulfilmentStatus || null,
    stock_mode: input.stockMode || 'reservation_only',
    buyer_name: input.buyerName || null,
    buyer_email: input.buyerEmail || null,
    buyer_username: input.buyerUsername || null,
    shipping_address: input.shippingAddress || {},
    shipping_country: input.shippingCountry || null,
    currency: input.currency || null,
    total_amount:
      input.totalAmount === null || input.totalAmount === undefined || input.totalAmount === ''
        ? null
        : numberValue(input.totalAmount),
    shipping_cost:
      input.shippingCost === null || input.shippingCost === undefined || input.shippingCost === ''
        ? null
        : numberValue(input.shippingCost),
    ordered_at: input.orderedAt || null,
    raw_payload: input.rawPayload || {},
    updated_at: now,
  }

  const { data: existing, error: existingError } = await supabase
    .from('loopbase_orders')
    .select('id')
    .eq('company_id', companyId)
    .eq('order_source', source)
    .eq('external_order_id', externalOrderId)
    .limit(1)

  if (existingError) {
    if (missingTable(existingError, 'loopbase_orders')) return null
    throw new Error(existingError.message)
  }

  if (existing?.[0]?.id) {
    const { data, error } = await supabase
      .from('loopbase_orders')
      .update(payload)
      .eq('id', existing[0].id)
      .select('id')
      .maybeSingle()

    if (error) throw new Error(error.message)
    return data
  }

  const { data, error } = await supabase
    .from('loopbase_orders')
    .insert({ ...payload, created_at: now })
    .select('id')
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data
}

export async function upsertLoopbaseOrderLine(
  supabase: SupabaseLike,
  input: LoopbaseOrderLineInput
) {
  const companyId = text(input.companyId)
  const orderId = text(input.orderId)
  const sku = text(input.sku).toUpperCase()
  if (!companyId || !orderId || !sku) return null

  const externalLineId = text(input.externalLineId) || sku
  const now = new Date().toISOString()
  const quantity = Math.max(0, numberValue(input.quantity, 1))
  const payload = {
    company_id: companyId,
    order_id: orderId,
    item_id: input.itemId || null,
    sku,
    external_line_id: externalLineId,
    line_status: text(input.status) || 'open',
    quantity,
    reserved_quantity: Math.max(0, numberValue(input.reservedQuantity, quantity)),
    picked_quantity: Math.max(0, numberValue(input.pickedQuantity)),
    dispatched_quantity: Math.max(0, numberValue(input.dispatchedQuantity)),
    cancelled_quantity: Math.max(0, numberValue(input.cancelledQuantity)),
    reservation_id: input.reservationId || null,
    transfer_item_ids: input.transferItemIds || [],
    unit_price:
      input.unitPrice === null || input.unitPrice === undefined || input.unitPrice === ''
        ? null
        : numberValue(input.unitPrice),
    raw_payload: input.rawPayload || {},
    updated_at: now,
  }

  const { data: existing, error: existingError } = await supabase
    .from('loopbase_order_lines')
    .select('id')
    .eq('company_id', companyId)
    .eq('order_id', orderId)
    .eq('sku', sku)
    .eq('external_line_id', externalLineId)
    .limit(1)

  if (existingError) {
    if (missingTable(existingError, 'loopbase_order_lines')) return null
    throw new Error(existingError.message)
  }

  if (existing?.[0]?.id) {
    const { data, error } = await supabase
      .from('loopbase_order_lines')
      .update(payload)
      .eq('id', existing[0].id)
      .select('id')
      .maybeSingle()

    if (error) throw new Error(error.message)
    return data
  }

  const { data, error } = await supabase
    .from('loopbase_order_lines')
    .insert({ ...payload, created_at: now })
    .select('id')
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data
}

export async function updateLoopbaseOrderLineStatus(params: {
  supabase: SupabaseLike
  companyId: string
  source: string
  externalOrderId: string
  sku: string
  status: 'open' | 'reserved' | 'picking' | 'picked' | 'dispatched' | 'cancelled' | 'failed' | 'on_hold'
  quantity?: number | string | null
}) {
  const order = await findLoopbaseOrder(params.supabase, {
    companyId: params.companyId,
    source: params.source,
    externalOrderId: params.externalOrderId,
  })
  if (!order?.id) return { updated: 0 }

  const sku = text(params.sku).toUpperCase()
  const now = new Date().toISOString()
  const quantity = Math.max(0, numberValue(params.quantity))
  const payload: Record<string, any> = {
    line_status: params.status,
    updated_at: now,
  }

  if (params.status === 'dispatched' && quantity > 0) payload.dispatched_quantity = quantity
  if (params.status === 'cancelled' && quantity > 0) payload.cancelled_quantity = quantity

  const { data, error } = await params.supabase
    .from('loopbase_order_lines')
    .update(payload)
    .eq('company_id', params.companyId)
    .eq('order_id', order.id)
    .eq('sku', sku)
    .select('id')

  if (error) {
    if (missingTable(error, 'loopbase_order_lines')) return { updated: 0 }
    throw new Error(error.message)
  }

  await refreshLoopbaseOrderStatus(params.supabase, params.companyId, order.id)
  return { updated: data?.length || 0 }
}

async function findLoopbaseOrder(
  supabase: SupabaseLike,
  input: { companyId: string; source: string; externalOrderId: string }
) {
  const { data, error } = await supabase
    .from('loopbase_orders')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('order_source', input.source)
    .eq('external_order_id', input.externalOrderId)
    .maybeSingle()

  if (error) {
    if (missingTable(error, 'loopbase_orders')) return null
    throw new Error(error.message)
  }

  return data
}

export async function refreshLoopbaseOrderStatus(
  supabase: SupabaseLike,
  companyId: string,
  orderId: string
) {
  const { data: lines, error } = await supabase
    .from('loopbase_order_lines')
    .select('line_status')
    .eq('company_id', companyId)
    .eq('order_id', orderId)

  if (error) {
    if (missingTable(error, 'loopbase_order_lines')) return null
    throw new Error(error.message)
  }

  const statuses: string[] = (lines || []).map((line: any) => text(line.line_status))
  if (statuses.length === 0) return null

  let orderStatus = 'open'
  if (statuses.every((status) => status === 'cancelled')) orderStatus = 'cancelled'
  else if (statuses.every((status) => status === 'dispatched')) orderStatus = 'dispatched'
  else if (statuses.some((status) => status === 'picked')) orderStatus = 'part_picked'
  else if (statuses.some((status) => status === 'picking')) orderStatus = 'picking'
  else if (statuses.some((status) => status === 'reserved')) orderStatus = 'reserved'
  else if (statuses.some((status) => status === 'failed')) orderStatus = 'failed'

  const now = new Date().toISOString()
  const updatePayload: Record<string, any> = {
    order_status: orderStatus,
    updated_at: now,
  }
  if (orderStatus === 'dispatched') updatePayload.processed_at = now
  if (orderStatus === 'cancelled') updatePayload.cancelled_at = now

  const { error: updateError } = await supabase
    .from('loopbase_orders')
    .update(updatePayload)
    .eq('company_id', companyId)
    .eq('id', orderId)

  if (updateError) {
    if (missingTable(updateError, 'loopbase_orders')) return null
    throw new Error(updateError.message)
  }

  return orderStatus
}

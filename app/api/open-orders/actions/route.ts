import { NextResponse } from 'next/server'
import { getSupabaseAdmin, requireCompanyAccess } from '@/lib/serverTenant'

export const dynamic = 'force-dynamic'

function jsonError(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, message, ...extra }, { status })
}

function text(value: unknown) {
  return String(value || '').trim()
}

function numberValue(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function arrayOfText(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : []
}

function isMissingSchema(error: any) {
  const code = String(error?.code || '')
  const message = String(error?.message || '').toLowerCase()
  return code === '42P01' || code === '42703' || message.includes('does not exist')
}

function pickwaveName() {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15)
  return `PW-${stamp}`
}

async function loadOrderLines(supabase: any, companyId: string, orderIds: string[]) {
  if (orderIds.length === 0) return []

  const { data, error } = await supabase
    .from('loopbase_order_lines')
    .select('id, order_id, item_id, sku, quantity, picked_quantity, dispatched_quantity, cancelled_quantity, line_status')
    .eq('company_id', companyId)
    .in('order_id', orderIds)
    .not('line_status', 'in', '("cancelled","dispatched")')
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  return data || []
}

async function sourceRowsByItemId(supabase: any, companyId: string, itemIds: string[]) {
  const rowsByItem = new Map<string, any[]>()
  if (itemIds.length === 0) return rowsByItem

  const { data, error } = await supabase
    .from('item_stock_locations')
    .select('item_id, location_name, bin_code, stock_level')
    .eq('company_id', companyId)
    .in('item_id', itemIds)
    .gt('stock_level', 0)
    .order('location_name', { ascending: true })
    .order('bin_code', { ascending: true })

  if (error) throw new Error(error.message)

  for (const row of data || []) {
    const key = String(row.item_id)
    rowsByItem.set(key, [...(rowsByItem.get(key) || []), row])
  }

  return rowsByItem
}

function sourceForLine(line: any, rowsByItem: Map<string, any[]>, requestedLocation: string) {
  const itemRows = line.item_id ? rowsByItem.get(String(line.item_id)) || [] : []
  const filteredRows =
    requestedLocation && requestedLocation !== 'all'
      ? itemRows.filter((row) => text(row.location_name) === requestedLocation)
      : itemRows

  const sortedRows = filteredRows.sort((a, b) => {
    const aDefault = text(a.bin_code).toLowerCase() === 'default' ? 0 : 1
    const bDefault = text(b.bin_code).toLowerCase() === 'default' ? 0 : 1
    if (aDefault !== bDefault) return aDefault - bDefault
    return `${text(a.location_name)}:${text(a.bin_code)}`.localeCompare(
      `${text(b.location_name)}:${text(b.bin_code)}`
    )
  })

  return sortedRows[0] || null
}

export async function POST(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member'])
  if (!access.ok) return jsonError(access.message, access.status)

  const body = await request.json().catch(() => null)
  const action = text(body?.action)
  const orderIds = arrayOfText(body?.order_ids || body?.orderIds)
  const now = new Date().toISOString()
  const supabase = getSupabaseAdmin()

  if (orderIds.length === 0) return jsonError('Select at least one open order.')

  if (action === 'park' || action === 'unpark' || action === 'lock' || action === 'unlock') {
    const updates: Record<string, unknown> = { updated_at: now }
    if (action === 'park') {
      updates.is_parked = true
      updates.parked_reason = text(body?.reason) || 'Manually parked'
    }
    if (action === 'unpark') {
      updates.is_parked = false
      updates.parked_reason = null
    }
    if (action === 'lock') {
      updates.is_locked = true
      updates.locked_reason = text(body?.reason) || 'Manually locked'
    }
    if (action === 'unlock') {
      updates.is_locked = false
      updates.locked_reason = null
    }

    const { data, error } = await supabase
      .from('loopbase_orders')
      .update(updates)
      .eq('company_id', access.company.id)
      .in('id', orderIds)
      .select('id')

    if (error) return jsonError(error.message, 500)
    return NextResponse.json({ ok: true, updated: data?.length || 0 })
  }

  if (action === 'assign_shipping') {
    const serviceName = text(body?.postal_service_name || body?.postalServiceName)
    const serviceCode = text(body?.postal_service_code || body?.postalServiceCode)
    if (!serviceName && !serviceCode) return jsonError('Enter a shipping method or service code.')

    const { data, error } = await supabase
      .from('loopbase_orders')
      .update({
        postal_service_name: serviceName || serviceCode,
        postal_service_code: serviceCode || serviceName,
        updated_at: now,
      })
      .eq('company_id', access.company.id)
      .in('id', orderIds)
      .select('id')

    if (error) return jsonError(error.message, 500)
    return NextResponse.json({ ok: true, updated: data?.length || 0 })
  }

  if (action === 'print_documents') {
    const includeInvoice = body?.include_invoice !== false
    const includePackingSlip = body?.include_packing_slip === true
    const updates: Record<string, unknown> = { updated_at: now }
    if (includeInvoice) updates.invoice_status = 'printed'
    if (includePackingSlip) updates.pick_list_status = 'printed'

    const { data, error } = await supabase
      .from('loopbase_orders')
      .update(updates)
      .eq('company_id', access.company.id)
      .in('id', orderIds)
      .select('id')

    if (error) return jsonError(error.message, 500)
    return NextResponse.json({ ok: true, updated: data?.length || 0 })
  }

  if (action === 'add_note') {
    const note = text(body?.note)
    const staffId = text(body?.staff_id || body?.staffId) || null
    if (!note) return jsonError('Enter a note before saving.')

    const noteRows = orderIds.map((orderId) => ({
      company_id: access.company.id,
      order_id: orderId,
      note,
      is_internal: true,
      is_processing_note: false,
      created_by_staff_id: staffId,
      created_by_user_id: access.user.id,
      updated_at: now,
    }))

    const { error } = await supabase.from('loopbase_order_notes').insert(noteRows)
    if (error) return jsonError(error.message, 500)

    const ordersResult = await supabase
      .from('loopbase_orders')
      .select('id, notes_count')
      .eq('company_id', access.company.id)
      .in('id', orderIds)

    if (ordersResult.error) return jsonError(ordersResult.error.message, 500)

    for (const order of ordersResult.data || []) {
      const update = await supabase
        .from('loopbase_orders')
        .update({ notes_count: numberValue(order.notes_count) + 1, updated_at: now })
        .eq('company_id', access.company.id)
        .eq('id', order.id)

      if (update.error) return jsonError(update.error.message, 500)
    }

    return NextResponse.json({ ok: true, updated: orderIds.length })
  }

  if (action !== 'start_pick') return jsonError('Unsupported Open Orders action.')

  const staffId = text(body?.staff_id || body?.staffId)
  const groupingType = text(body?.grouping_type || body?.groupingType) === 'orders' ? 'orders' : 'items'
  const sortingType = text(body?.sorting_type || body?.sortingType) === 'order_view' ? 'order_view' : 'bin_priority'
  const locationName = text(body?.location_name || body?.locationName)

  if (!staffId) return jsonError('Choose the staff member who is claiming this pick.')

  const staffResult = await supabase
    .from('staff_users')
    .select('id, name')
    .eq('company_id', access.company.id)
    .eq('id', staffId)
    .eq('is_active', true)
    .maybeSingle()

  if (staffResult.error) return jsonError(staffResult.error.message, 500)
  if (!staffResult.data?.id) return jsonError('Selected staff member is not active for this company.', 403)

  const ordersResult = await supabase
    .from('loopbase_orders')
    .select('id, external_order_number, order_status, is_locked, is_parked, pickwave_id')
    .eq('company_id', access.company.id)
    .in('id', orderIds)

  if (ordersResult.error) {
    if (isMissingSchema(ordersResult.error)) {
      return jsonError('Open Orders database tables are not migrated yet.', 409)
    }
    return jsonError(ordersResult.error.message, 500)
  }

  const orders = ordersResult.data || []
  const blocked = orders.filter((order) => order.is_locked || order.pickwave_id)
  if (blocked.length > 0) {
    return jsonError('One or more orders are locked or already assigned to a pickwave.', 409, {
      blocked_orders: blocked.map((order) => order.external_order_number || order.id),
    })
  }

  const lines = await loadOrderLines(supabase, access.company.id, orders.map((order) => order.id))
  if (lines.length === 0) return jsonError('No pickable order lines were found.')

  const rowsByItem = await sourceRowsByItemId(
    supabase,
    access.company.id,
    Array.from(new Set(lines.map((line: any) => text(line.item_id)).filter(Boolean)))
  )

  const pickwaveInsert = await supabase
    .from('loopbase_pickwaves')
    .insert({
      company_id: access.company.id,
      name: pickwaveName(),
      location_name: locationName || null,
      grouping_type: groupingType,
      sorting_type: sortingType,
      status: 'picking',
      assigned_staff_id: staffId,
      claimed_by_staff_id: staffId,
      started_at: now,
      updated_at: now,
      metadata: {
        claimed_from: 'open_orders_grid',
        selected_order_count: orders.length,
      },
    })
    .select('id, pickwave_number, name')
    .single()

  if (pickwaveInsert.error) return jsonError(pickwaveInsert.error.message, 500)

  const pickwave = pickwaveInsert.data
  const pickItems = lines.map((line: any) => {
    const remaining = Math.max(
      numberValue(line.quantity) - numberValue(line.picked_quantity) - numberValue(line.dispatched_quantity) - numberValue(line.cancelled_quantity),
      0
    )
    const source = sourceForLine(line, rowsByItem, locationName)
    const routeKey = `${text(source?.location_name) || 'ZZ'}:${text(source?.bin_code) || 'ZZ'}:${text(line.sku)}`

    return {
      company_id: access.company.id,
      pickwave_id: pickwave.id,
      order_id: line.order_id,
      order_line_id: line.id,
      item_id: line.item_id || null,
      sku: line.sku,
      quantity_to_pick: remaining || numberValue(line.quantity, 1),
      source_location_name: source?.location_name || null,
      source_bin_code: source?.bin_code || null,
      route_sort_key: sortingType === 'bin_priority' ? routeKey : `${orderIds.indexOf(String(line.order_id))}:${text(line.sku)}`,
      status: 'picking',
      claimed_by_staff_id: staffId,
      claimed_at: now,
      updated_at: now,
      metadata: {
        source_inferred: Boolean(source),
        source_stock_level: source ? numberValue(source.stock_level) : null,
      },
    }
  })

  const { error: itemInsertError } = await supabase.from('loopbase_pickwave_items').insert(pickItems)
  if (itemInsertError) return jsonError(itemInsertError.message, 500)

  const orderUpdate = await supabase
    .from('loopbase_orders')
    .update({
      order_status: 'picking',
      assigned_picker_staff_id: staffId,
      pickwave_id: pickwave.id,
      pick_claimed_at: now,
      updated_at: now,
    })
    .eq('company_id', access.company.id)
    .in('id', orders.map((order) => order.id))

  if (orderUpdate.error) return jsonError(orderUpdate.error.message, 500)

  const lineUpdate = await supabase
    .from('loopbase_order_lines')
    .update({
      line_status: 'picking',
      updated_at: now,
    })
    .eq('company_id', access.company.id)
    .in('id', lines.map((line: any) => line.id))

  if (lineUpdate.error) return jsonError(lineUpdate.error.message, 500)

  return NextResponse.json({
    ok: true,
    pickwave,
    picked_staff: staffResult.data,
    orders: orders.length,
    lines: pickItems.length,
    missing_sources: pickItems.filter((item: any) => !item.source_location_name || !item.source_bin_code).length,
  })
}

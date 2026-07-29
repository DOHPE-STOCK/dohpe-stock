import { NextResponse } from 'next/server'
import { calculateStockSummaryForItem } from '@/lib/stockSummary'
import { getSupabaseAdmin, requireCompanyAccess } from '@/lib/serverTenant'

export const dynamic = 'force-dynamic'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status })
}

function text(value: unknown) {
  return String(value || '').trim()
}

function isMissingTable(error: any, tableName: string) {
  const code = String(error?.code || '')
  const message = String(error?.message || '').toLowerCase()
  return code === '42P01' || message.includes(tableName.toLowerCase())
}

async function safeSelect(
  query: any,
  tableName: string
): Promise<{ data: any[]; warning: string | null }> {
  const { data, error } = await query

  if (error) {
    if (isMissingTable(error, tableName)) {
      return { data: [], warning: `${tableName} is not migrated yet.` }
    }

    throw new Error(error.message)
  }

  return { data: data || [], warning: null }
}

export async function GET(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member', 'viewer'])
  if (!access.ok) return jsonError(access.message, access.status)

  const url = new URL(request.url)
  const sku = text(url.searchParams.get('sku')).toUpperCase()
  const itemId = text(url.searchParams.get('item_id') || url.searchParams.get('itemId'))

  if (!sku && !itemId) {
    return jsonError('SKU or item_id is required.')
  }

  const supabase = getSupabaseAdmin()
  let itemQuery = supabase
    .from('items')
    .select(
      `id, sku, barcode, title, brand, reporting_category, sub_category, current_location,
      current_bin, stock_level, physical_stock, available_stock, open_order_stock,
      inbound_stock, quarantine_stock, channel_exposed_stock, stock_buffer,
      max_channel_exposed_stock, minimum_stock_alert_level, updated_at`
    )
    .eq('company_id', access.company.id)

  if (itemId) itemQuery = itemQuery.eq('id', itemId)
  else itemQuery = itemQuery.eq('sku', sku)

  const { data: item, error: itemError } = await itemQuery.maybeSingle()
  if (itemError) return jsonError(itemError.message, 500)
  if (!item?.id) return jsonError('Item not found for active company.', 404)

  const summary = await calculateStockSummaryForItem(supabase, access.company.id, item)
  const warnings: string[] = []

  const stockRows = await safeSelect(
    supabase
      .from('item_stock_locations')
      .select('id, location_name, bin_code, stock_level, source, updated_at, synced_at')
      .eq('company_id', access.company.id)
      .eq('item_id', item.id)
      .order('location_name', { ascending: true })
      .order('bin_code', { ascending: true }),
    'item_stock_locations'
  )
  if (stockRows.warning) warnings.push(stockRows.warning)

  const reservations = await safeSelect(
    supabase
      .from('stock_reservations')
      .select(
        `id, channel, source, external_order_id, external_order_reference,
        reservation_status, quantity, stock_already_deducted, location_name,
        bin_code, reserved_at, deducted_at, released_at, release_reason, metadata, updated_at`
      )
      .eq('company_id', access.company.id)
      .eq('item_id', item.id)
      .order('updated_at', { ascending: false })
      .limit(30),
    'stock_reservations'
  )
  if (reservations.warning) warnings.push(reservations.warning)

  const orderLines = await safeSelect(
    supabase
      .from('loopbase_order_lines')
      .select(
        `id, order_id, sku, external_line_id, line_status, quantity, reserved_quantity,
        picked_quantity, dispatched_quantity, cancelled_quantity, reservation_id,
        unit_price, raw_payload, created_at, updated_at,
        order:loopbase_orders(id, order_source, external_order_id, external_order_number,
          channel, sub_channel, order_status, stock_mode, ordered_at, processed_at, cancelled_at)`
      )
      .eq('company_id', access.company.id)
      .eq('item_id', item.id)
      .order('updated_at', { ascending: false })
      .limit(30),
    'loopbase_order_lines'
  )
  if (orderLines.warning) warnings.push(orderLines.warning)

  const alerts = await safeSelect(
    supabase
      .from('stock_alerts')
      .select(
        `id, alert_type, severity, status, location_name, bin_code, quantity,
        title, message, task_required, task_status, created_at, updated_at, resolved_at`
      )
      .eq('company_id', access.company.id)
      .eq('item_id', item.id)
      .order('created_at', { ascending: false })
      .limit(30),
    'stock_alerts'
  )
  if (alerts.warning) warnings.push(alerts.warning)

  return NextResponse.json({
    ok: true,
    company: access.company,
    item,
    summary: {
      ...summary,
      stock_level_difference: summary.physical_stock - summary.current_stock_level,
      has_negative_stock: summary.negative_locations.length > 0,
    },
    stock_rows: stockRows.data,
    reservations: reservations.data,
    order_lines: orderLines.data,
    alerts: alerts.data,
    warnings,
  })
}

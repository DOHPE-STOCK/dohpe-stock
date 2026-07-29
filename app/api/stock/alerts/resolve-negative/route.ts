import { NextResponse } from 'next/server'
import { getSupabaseAdmin, requireCompanyAccess } from '@/lib/serverTenant'
import { recalculateStockSummaryForSku } from '@/lib/stockSummary'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function text(value: unknown) {
  return String(value || '').trim()
}

function numberValue(value: unknown) {
  const valueNumber = Number(value)
  return Number.isFinite(valueNumber) ? valueNumber : 0
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status })
}

export async function POST(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member'])
  if (!access.ok) return jsonError(access.message, access.status)

  const body = await request.json().catch(() => ({}))
  const alertId = text(body.alert_id || body.alertId)
  const sourceRowId = text(body.source_row_id || body.sourceRowId)
  const quantity = numberValue(body.quantity)

  if (!alertId) return jsonError('Missing alert_id.')
  if (!sourceRowId) return jsonError('Missing source_row_id.')
  if (!quantity || quantity <= 0) return jsonError('Quantity must be greater than zero.')

  const supabase = getSupabaseAdmin()
  const { data: alert, error: alertError } = await supabase
    .from('stock_alerts')
    .select('id, company_id, item_id, sku, location_name, bin_code, quantity, status')
    .eq('id', alertId)
    .eq('company_id', access.company.id)
    .maybeSingle()

  if (alertError) return jsonError(alertError.message, 500)
  if (!alert) return jsonError('Stock alert not found.', 404)
  if (!alert.item_id || !alert.sku) return jsonError('Stock alert is missing item/SKU details.', 409)
  if (!['open', 'acknowledged'].includes(text(alert.status).toLowerCase())) {
    return jsonError('Stock alert is already closed.', 409)
  }

  const { data: targetRows, error: targetError } = await supabase
    .from('item_stock_locations')
    .select('id, stock_level')
    .eq('company_id', access.company.id)
    .eq('item_id', alert.item_id)
    .eq('location_name', alert.location_name)
    .eq('bin_code', alert.bin_code || 'Default')
    .limit(1)

  if (targetError) return jsonError(targetError.message, 500)

  const targetRow = targetRows?.[0]
  if (!targetRow) return jsonError('Negative stock row was not found.', 404)

  const { data: sourceRow, error: sourceError } = await supabase
    .from('item_stock_locations')
    .select('id, item_id, sku, location_name, bin_code, stock_level')
    .eq('company_id', access.company.id)
    .eq('id', sourceRowId)
    .maybeSingle()

  if (sourceError) return jsonError(sourceError.message, 500)
  if (!sourceRow) return jsonError('Source stock row not found.', 404)
  if (sourceRow.item_id !== alert.item_id) return jsonError('Source row belongs to a different item.', 409)

  const sourceStock = numberValue(sourceRow.stock_level)
  if (sourceStock <= 0) return jsonError('Source bin has no positive stock.', 409)

  const targetStock = numberValue(targetRow.stock_level)
  const needed = Math.abs(Math.min(0, targetStock))
  const moveQuantity = Math.min(quantity, sourceStock, needed || quantity)

  if (moveQuantity <= 0) return jsonError('No negative stock needs covering.', 409)

  const now = new Date().toISOString()
  const { error: sourceUpdateError } = await supabase
    .from('item_stock_locations')
    .update({
      stock_level: sourceStock - moveQuantity,
      source: 'negative_stock_rebalance_source',
      updated_at: now,
    })
    .eq('id', sourceRow.id)
    .eq('company_id', access.company.id)

  if (sourceUpdateError) return jsonError(sourceUpdateError.message, 500)

  const nextTargetStock = targetStock + moveQuantity
  const { error: targetUpdateError } = await supabase
    .from('item_stock_locations')
    .update({
      stock_level: nextTargetStock,
      source: 'negative_stock_rebalance_target',
      updated_at: now,
    })
    .eq('id', targetRow.id)
    .eq('company_id', access.company.id)

  if (targetUpdateError) return jsonError(targetUpdateError.message, 500)

  const alertUpdate =
    nextTargetStock >= 0
      ? {
          status: 'resolved',
          resolved_at: now,
          resolved_by: access.user.id,
          updated_at: now,
          metadata: {
            resolved_by_rebalance: true,
            source_row_id: sourceRow.id,
            moved_quantity: moveQuantity,
          },
        }
      : {
          status: 'acknowledged',
          updated_at: now,
          quantity: nextTargetStock,
          message: `${alert.sku} is ${nextTargetStock} at ${alert.location_name || 'Unknown'} / ${alert.bin_code || 'Unknown'}.`,
        }

  const { error: alertUpdateError } = await supabase
    .from('stock_alerts')
    .update(alertUpdate)
    .eq('id', alert.id)
    .eq('company_id', access.company.id)

  if (alertUpdateError) return jsonError(alertUpdateError.message, 500)

  let summary: any = null
  try {
    summary = await recalculateStockSummaryForSku(supabase, access.company.id, alert.sku)
  } catch {
    summary = null
  }

  return NextResponse.json({
    ok: true,
    moved_quantity: moveQuantity,
    source: {
      id: sourceRow.id,
      location_name: sourceRow.location_name,
      bin_code: sourceRow.bin_code,
      stock_level: sourceStock - moveQuantity,
    },
    target: {
      id: targetRow.id,
      location_name: alert.location_name,
      bin_code: alert.bin_code,
      stock_level: nextTargetStock,
    },
    resolved: nextTargetStock >= 0,
    summary,
  })
}

import { NextResponse } from 'next/server'
import { calculateStockSummaryForItem } from '@/lib/stockSummary'
import { getSupabaseAdmin, requireCompanyAccess } from '@/lib/serverTenant'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status })
}

export async function GET(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager'])
  if (!access.ok) return jsonError(access.message, access.status)

  const url = new URL(request.url)
  const sku = String(url.searchParams.get('sku') || '').trim().toUpperCase()
  const itemId = String(url.searchParams.get('item_id') || url.searchParams.get('itemId') || '').trim()
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)))
  const supabase = getSupabaseAdmin()

  let query = supabase
    .from('items')
    .select('id, sku, stock_level, stock_buffer, max_channel_exposed_stock, minimum_stock_alert_level')
    .eq('company_id', access.company.id)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (sku) query = query.eq('sku', sku)
  if (itemId) query = query.eq('id', itemId)

  const { data: items, error } = await query
  if (error) return jsonError(error.message, 500)

  const summaries = []
  for (const item of items || []) {
    const summary = await calculateStockSummaryForItem(supabase, access.company.id, item)
    summaries.push({
      ...summary,
      stock_level_difference: summary.physical_stock - summary.current_stock_level,
      has_negative_stock: summary.negative_locations.length > 0,
    })
  }

  return NextResponse.json({
    ok: true,
    company_id: access.company.id,
    count: summaries.length,
    summaries,
  })
}

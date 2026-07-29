import { NextResponse } from 'next/server'
import { calculateStockSummaryForItem, createStockAlertsForSummary, writeStockSummary } from '@/lib/stockSummary'
import { getSupabaseAdmin, requireCompanyAccess } from '@/lib/serverTenant'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status })
}

export async function POST(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager'])
  if (!access.ok) return jsonError(access.message, access.status)

  const body = await request.json().catch(() => ({}))
  const itemId = String(body?.item_id || '').trim()
  const sku = String(body?.sku || '').trim().toUpperCase()
  const dryRun = body?.dry_run === true
  const limit = Math.min(500, Math.max(1, Number(body?.limit || 100)))
  const supabase = getSupabaseAdmin()

  let query = supabase
    .from('items')
    .select('id, sku, stock_level, stock_buffer, max_channel_exposed_stock, minimum_stock_alert_level')
    .eq('company_id', access.company.id)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (itemId) query = query.eq('id', itemId)
  if (sku) query = query.eq('sku', sku)

  const { data: items, error } = await query
  if (error) return jsonError(error.message, 500)

  const summaries = []
  for (const item of items || []) {
    const summary = await calculateStockSummaryForItem(supabase, access.company.id, item)
    if (!dryRun) {
      await writeStockSummary(supabase, access.company.id, summary)
      await createStockAlertsForSummary(supabase, access.company.id, summary)
    }
    summaries.push(summary)
  }

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    company_id: access.company.id,
    updated: dryRun ? 0 : summaries.length,
    summaries,
  })
}

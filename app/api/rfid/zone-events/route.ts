import { NextResponse } from 'next/server'
import {
  companyHasOperationalAccess,
  getSupabaseAdmin,
  requireCompanyAccess,
} from '@/lib/serverTenant'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function failure(status: number, message: string) {
  return NextResponse.json({ ok: false, message }, { status })
}

export async function GET(request: Request) {
  const access = await requireCompanyAccess(request)
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) return failure(402, 'Company subscription is not active.')

  const url = new URL(request.url)
  const zoneId = url.searchParams.get('zone_id') || url.searchParams.get('zoneId') || ''
  const alarmOnly = url.searchParams.get('alarm_only') === 'true'
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)))

  const supabase = getSupabaseAdmin()
  let query = supabase
    .from('rfid_zone_events')
    .select(
      `id, company_id, zone_id, item_id, tag_key, epc, tid, event_type, direction,
      first_side, last_side, last_antenna, max_rssi, read_count, known_item,
      paid_or_sold, alarm_triggered, alarm_status, metadata, event_at,
      rfid_zones(name, code, zone_type)`
    )
    .eq('company_id', access.company.id)
    .order('event_at', { ascending: false })
    .limit(limit)

  if (zoneId) query = query.eq('zone_id', zoneId)
  if (alarmOnly) query = query.eq('alarm_triggered', true)

  const { data, error } = await query
  if (error) {
    if (error.code === '42P01') return failure(400, 'RFID zone migration has not been run yet.')
    return failure(500, error.message)
  }

  return NextResponse.json({ ok: true, events: data || [] })
}

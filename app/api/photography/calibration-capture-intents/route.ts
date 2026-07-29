import { NextResponse } from 'next/server'
import {
  companyHasOperationalAccess,
  getSupabaseAdmin,
  requireCompanyAccess,
} from '@/lib/serverTenant'

function failure(status: number, message: string) {
  return NextResponse.json({ ok: false, message }, { status })
}

function text(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

export async function POST(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager'])
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) {
    return failure(402, 'Company subscription is not active.')
  }

  const body = await request.json().catch(() => ({}))
  const stationId = text(body.station_id || body.stationId)
  const sourceId = text(body.source_id || body.sourceId) || null
  const staffId = text(body.staff_id || body.staffId) || null

  if (!stationId) return failure(400, 'Station is required.')

  const supabase = getSupabaseAdmin()
  const { data: station, error: stationError } = await supabase
    .from('photography_stations')
    .select('id')
    .eq('company_id', access.company.id)
    .eq('id', stationId)
    .maybeSingle()

  if (stationError) return failure(500, stationError.message)
  if (!station) return failure(404, 'Station not found for active company.')

  if (sourceId) {
    const { data: source, error: sourceError } = await supabase
      .from('photo_sources')
      .select('id')
      .eq('company_id', access.company.id)
      .eq('station_id', stationId)
      .eq('id', sourceId)
      .maybeSingle()

    if (sourceError) return failure(500, sourceError.message)
    if (!source) return failure(404, 'Source not found for selected station.')
  }

  await supabase
    .from('photo_station_capture_intents')
    .update({
      status: 'cancelled',
      metadata: { superseded_by: 'new_station_calibration_request' },
    })
    .eq('company_id', access.company.id)
    .eq('station_id', stationId)
    .eq('intent_type', 'station_calibration')
    .eq('status', 'queued')

  const { data, error } = await supabase
    .from('photo_station_capture_intents')
    .insert({
      company_id: access.company.id,
      station_id: stationId,
      source_id: sourceId,
      intent_type: 'station_calibration',
      status: 'queued',
      requested_by_staff_id: staffId,
      created_by: access.user.id,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      metadata: {
        requested_from: 'photo_monitor',
        note: 'Next capture should become the station calibration image, not an item image.',
      },
    })
    .select('*')
    .single()

  if (error) return failure(500, error.message)
  return NextResponse.json({ ok: true, intent: data })
}

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

function stationCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export async function GET(request: Request) {
  const access = await requireCompanyAccess(request)
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) {
    return failure(402, 'Company subscription is not active.')
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('photography_stations')
    .select(
      `id, company_id, location_id, name, code, description, status,
      active_photo_session_id, auto_start_from_rfid, auto_start_from_barcode,
      last_activity_at, created_at, updated_at,
      active_session:photo_sessions!photography_stations_active_photo_session_fkey(
        id,
        item_id,
        station_id,
        status,
        start_method,
        measurement_source_capture_id,
        measurement_status,
        measurement_started_at,
        measurement_completed_at,
        measurement_stale_at,
        started_at,
        ended_at,
        item:items(id, sku, final_title, ai_title, basic_title, website_title, brand, reporting_category, sub_category, status, review_return_reason, review_return_type, review_returned_at)
      )`
    )
    .eq('company_id', access.company.id)
    .neq('status', 'archived')
    .order('name', { ascending: true })

  if (error) return failure(500, error.message)

  return NextResponse.json({ ok: true, stations: data || [] })
}

export async function POST(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager'])
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) {
    return failure(402, 'Company subscription is not active.')
  }

  const body = await request.json().catch(() => ({}))
  const name = text(body.name)
  const code = stationCode(text(body.code) || name)

  if (!name) return failure(400, 'Station name is required.')
  if (!code) return failure(400, 'Station code is required.')

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('photography_stations')
    .insert({
      company_id: access.company.id,
      name,
      code,
      description: String(body.description || '').trim() || null,
      location_id: body.location_id || null,
      auto_start_from_rfid: body.auto_start_from_rfid === true,
      auto_start_from_barcode: body.auto_start_from_barcode === true,
      created_by: access.user.id,
    })
    .select('*')
    .single()

  if (error) return failure(500, error.message)

  return NextResponse.json({ ok: true, station: data })
}

export async function PATCH(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager'])
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) {
    return failure(402, 'Company subscription is not active.')
  }

  const body = await request.json().catch(() => ({}))
  const stationId = text(body.id || body.station_id || body.stationId)
  const action = text(body.action)

  if (!stationId) return failure(400, 'Station is required.')

  const supabase = getSupabaseAdmin()

  if (action === 'archive') {
    const { data: activeSession, error: sessionError } = await supabase
      .from('photo_sessions')
      .select('id')
      .eq('company_id', access.company.id)
      .eq('station_id', stationId)
      .eq('status', 'active')
      .maybeSingle()

    if (sessionError) return failure(500, sessionError.message)
    if (activeSession) return failure(409, 'End the active photo session before archiving this station.')

    const { data, error } = await supabase
      .from('photography_stations')
      .update({
        status: 'archived',
        active_photo_session_id: null,
      })
      .eq('company_id', access.company.id)
      .eq('id', stationId)
      .select('*')
      .single()

    if (error) return failure(500, error.message)
    return NextResponse.json({ ok: true, station: data })
  }

  const updates: Record<string, unknown> = {}
  if (body.name !== undefined) updates.name = text(body.name)
  if (body.code !== undefined) updates.code = stationCode(text(body.code))
  if (body.description !== undefined) updates.description = text(body.description) || null
  if (body.location_id !== undefined || body.locationId !== undefined) {
    updates.location_id = text(body.location_id || body.locationId) || null
  }
  if (body.status !== undefined && ['active', 'disabled'].includes(text(body.status))) {
    updates.status = text(body.status)
  }
  if (body.auto_start_from_rfid !== undefined) {
    updates.auto_start_from_rfid = body.auto_start_from_rfid === true
  }
  if (body.auto_start_from_barcode !== undefined) {
    updates.auto_start_from_barcode = body.auto_start_from_barcode === true
  }

  if (updates.name === '') return failure(400, 'Station name is required.')
  if (updates.code === '') return failure(400, 'Station code is required.')

  const { data, error } = await supabase
    .from('photography_stations')
    .update(updates)
    .eq('company_id', access.company.id)
    .eq('id', stationId)
    .select('*')
    .single()

  if (error) return failure(500, error.message)

  return NextResponse.json({ ok: true, station: data })
}

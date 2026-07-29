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

const profileTypes = [
  'station_daily_reference',
  'colour_white_balance',
  'calibrite_colour_checker',
  'geometry_scale',
  'lens_geometry',
]
const statuses = ['active', 'disabled', 'archived']

export async function GET(request: Request) {
  const access = await requireCompanyAccess(request)
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) {
    return failure(402, 'Company subscription is not active.')
  }

  const url = new URL(request.url)
  const stationId = text(url.searchParams.get('station_id'))
  const sourceId = text(url.searchParams.get('source_id'))

  const supabase = getSupabaseAdmin()
  let query = supabase
    .from('photography_calibration_profiles')
    .select(
      `id, company_id, station_id, source_id, name, profile_type, status, profile_version,
      manufacturer, camera_model, lens_model, measured_reference, calibration_data,
      created_by, created_at, updated_at,
      source:photo_sources(id, name, source_type),
      station:photography_stations(id, name, code)`
    )
    .eq('company_id', access.company.id)
    .neq('status', 'archived')
    .order('profile_type', { ascending: true })
    .order('updated_at', { ascending: false })

  if (stationId) query = query.eq('station_id', stationId)
  if (sourceId) query = query.eq('source_id', sourceId)

  const { data, error } = await query
  if (error) return failure(500, error.message)

  return NextResponse.json({ ok: true, profiles: data || [] })
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
  const name = text(body.name)
  const profileType = text(body.profile_type || body.profileType)

  if (!stationId) return failure(400, 'Station is required.')
  if (!name) return failure(400, 'Calibration profile name is required.')
  if (!profileTypes.includes(profileType)) return failure(400, 'Invalid calibration profile type.')

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

  const { data, error } = await supabase
    .from('photography_calibration_profiles')
    .insert({
      company_id: access.company.id,
      station_id: stationId,
      source_id: sourceId,
      name,
      profile_type: profileType,
      manufacturer: text(body.manufacturer) || null,
      camera_model: text(body.camera_model || body.cameraModel) || null,
      lens_model: text(body.lens_model || body.lensModel) || null,
      measured_reference:
        body.measured_reference && typeof body.measured_reference === 'object'
          ? body.measured_reference
          : {},
      calibration_data:
        body.calibration_data && typeof body.calibration_data === 'object'
          ? body.calibration_data
          : {},
      created_by: access.user.id,
    })
    .select('*')
    .single()

  if (error) return failure(500, error.message)
  return NextResponse.json({ ok: true, profile: data })
}

export async function PATCH(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager'])
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) {
    return failure(402, 'Company subscription is not active.')
  }

  const body = await request.json().catch(() => ({}))
  const profileId = text(body.id || body.profile_id || body.profileId)
  if (!profileId) return failure(400, 'Calibration profile is required.')

  const updates: Record<string, unknown> = {}
  if (body.name !== undefined) updates.name = text(body.name)
  if (body.status !== undefined && statuses.includes(text(body.status))) updates.status = text(body.status)
  if (body.manufacturer !== undefined) updates.manufacturer = text(body.manufacturer) || null
  if (body.camera_model !== undefined || body.cameraModel !== undefined) {
    updates.camera_model = text(body.camera_model || body.cameraModel) || null
  }
  if (body.lens_model !== undefined || body.lensModel !== undefined) {
    updates.lens_model = text(body.lens_model || body.lensModel) || null
  }
  if (body.measured_reference && typeof body.measured_reference === 'object') {
    updates.measured_reference = body.measured_reference
  }
  if (body.calibration_data && typeof body.calibration_data === 'object') {
    updates.calibration_data = body.calibration_data
  }

  if (updates.name === '') return failure(400, 'Calibration profile name is required.')

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('photography_calibration_profiles')
    .update(updates)
    .eq('company_id', access.company.id)
    .eq('id', profileId)
    .select('*')
    .single()

  if (error) return failure(500, error.message)
  return NextResponse.json({ ok: true, profile: data })
}

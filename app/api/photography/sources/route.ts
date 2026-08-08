import crypto from 'crypto'
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

function tokenHash(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function makeSourceToken() {
  return `phsrc_live_${crypto.randomBytes(32).toString('base64url')}`
}

async function revokeStalePhoneSources(companyId: string, stationId: string) {
  const supabase = getSupabaseAdmin()
  const staleBefore = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()

  await supabase
    .from('photo_sources')
    .update({
      enabled: false,
      token_hash: null,
      token_revoked_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)
    .eq('station_id', stationId)
    .eq('source_type', 'phone')
    .eq('enabled', true)
    .is('token_revoked_at', null)
    .or(`last_activity_at.is.null,last_activity_at.lt.${staleBefore}`)
}

export async function GET(request: Request) {
  const access = await requireCompanyAccess(request)
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) {
    return failure(402, 'Company subscription is not active.')
  }

  const url = new URL(request.url)
  const stationId = text(url.searchParams.get('station_id'))

  const supabase = getSupabaseAdmin()
  if (stationId) await revokeStalePhoneSources(access.company.id, stationId)

  let query = supabase
    .from('photo_sources')
    .select(
      `id, company_id, station_id, name, source_type, manufacturer, camera_model,
      enabled, timezone, clock_offset_seconds, capture_tolerance_seconds,
      source_file_policy, token_last_four, token_created_at, token_revoked_at,
      last_activity_at, local_reference, created_at, updated_at,
      station:photography_stations(id, name, code)`
    )
    .eq('company_id', access.company.id)
    .order('created_at', { ascending: false })

  if (stationId) query = query.eq('station_id', stationId)

  const { data, error } = await query

  if (error) return failure(500, error.message)

  return NextResponse.json({ ok: true, sources: data || [] })
}

export async function POST(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager'])
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) {
    return failure(402, 'Company subscription is not active.')
  }

  const body = await request.json().catch(() => ({}))
  const stationId = text(body.station_id || body.stationId)
  const name = text(body.name)
  const sourceType = text(body.source_type || body.sourceType) || 'watched_folder'
  const issueToken = body.issue_token !== false

  if (!stationId) return failure(400, 'Station is required.')
  if (!name) return failure(400, 'Source name is required.')
  if (!['watched_folder', 'phone', 'manual', 'api'].includes(sourceType)) {
    return failure(400, 'Invalid source type.')
  }

  const supabase = getSupabaseAdmin()
  const { data: station, error: stationError } = await supabase
    .from('photography_stations')
    .select('id')
    .eq('company_id', access.company.id)
    .eq('id', stationId)
    .maybeSingle()

  if (stationError) return failure(500, stationError.message)
  if (!station) return failure(404, 'Station not found for active company.')

  const token = issueToken ? makeSourceToken() : ''
  const now = new Date().toISOString()

  const { data: source, error } = await supabase
    .from('photo_sources')
    .insert({
      company_id: access.company.id,
      station_id: stationId,
      name,
      source_type: sourceType,
      manufacturer: text(body.manufacturer) || null,
      camera_model: text(body.camera_model || body.cameraModel) || null,
      enabled: body.enabled !== false,
      timezone: text(body.timezone) || 'Europe/London',
      clock_offset_seconds: Number(body.clock_offset_seconds ?? body.clockOffsetSeconds ?? 0) || 0,
      capture_tolerance_seconds: Number(body.capture_tolerance_seconds ?? body.captureToleranceSeconds ?? 90) || 90,
      source_file_policy: text(body.source_file_policy || body.sourceFilePolicy) || 'keep_source_file',
      token_hash: token ? tokenHash(token) : null,
      token_last_four: token ? token.slice(-4) : null,
      token_created_at: token ? now : null,
    })
    .select(
      `id, company_id, station_id, name, source_type, manufacturer, camera_model,
      enabled, timezone, clock_offset_seconds, capture_tolerance_seconds,
      source_file_policy, token_last_four, token_created_at, token_revoked_at,
      last_activity_at, created_at, updated_at`
    )
    .single()

  if (error) return failure(500, error.message)

  return NextResponse.json({
    ok: true,
    source,
    token: token || null,
    token_note: token ? 'Store this source token now. It will not be shown again.' : null,
  })
}

export async function PATCH(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager'])
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) {
    return failure(402, 'Company subscription is not active.')
  }

  const body = await request.json().catch(() => ({}))
  const sourceId = text(body.id || body.source_id || body.sourceId)
  const action = text(body.action)

  if (!sourceId) return failure(400, 'Source is required.')

  const supabase = getSupabaseAdmin()

  if (action === 'rotate_token') {
    const token = makeSourceToken()
    const { data, error } = await supabase
      .from('photo_sources')
      .update({
        token_hash: tokenHash(token),
        token_last_four: token.slice(-4),
        token_created_at: new Date().toISOString(),
        token_revoked_at: null,
      })
      .eq('company_id', access.company.id)
      .eq('id', sourceId)
      .select('id, token_last_four, token_created_at')
      .single()

    if (error) return failure(500, error.message)

    return NextResponse.json({
      ok: true,
      source: data,
      token,
      token_note: 'Store this source token now. It will not be shown again.',
    })
  }

  if (action === 'revoke_token') {
    const { data, error } = await supabase
      .from('photo_sources')
      .update({
        token_hash: null,
        token_revoked_at: new Date().toISOString(),
      })
      .eq('company_id', access.company.id)
      .eq('id', sourceId)
      .select('id, token_last_four, token_revoked_at')
      .single()

    if (error) return failure(500, error.message)

    return NextResponse.json({ ok: true, source: data })
  }

  const { data, error } = await supabase
    .from('photo_sources')
    .update({
      name: text(body.name) || undefined,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      manufacturer: body.manufacturer === undefined ? undefined : text(body.manufacturer) || null,
      camera_model: body.camera_model === undefined ? undefined : text(body.camera_model) || null,
      timezone: body.timezone === undefined ? undefined : text(body.timezone) || 'Europe/London',
      clock_offset_seconds:
        body.clock_offset_seconds === undefined ? undefined : Number(body.clock_offset_seconds) || 0,
      capture_tolerance_seconds:
        body.capture_tolerance_seconds === undefined ? undefined : Number(body.capture_tolerance_seconds) || 90,
      source_file_policy: body.source_file_policy === undefined ? undefined : text(body.source_file_policy),
      local_reference:
        body.local_reference === undefined
          ? undefined
          : body.local_reference && typeof body.local_reference === 'object'
            ? body.local_reference
            : {},
    })
    .eq('company_id', access.company.id)
    .eq('id', sourceId)
    .select('*')
    .single()

  if (error) return failure(500, error.message)

  return NextResponse.json({ ok: true, source: data })
}

export async function DELETE(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager'])
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) {
    return failure(402, 'Company subscription is not active.')
  }

  const url = new URL(request.url)
  const sourceId = text(url.searchParams.get('id') || url.searchParams.get('source_id'))

  if (!sourceId) return failure(400, 'Source is required.')

  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('photo_sources')
    .delete()
    .eq('company_id', access.company.id)
    .eq('id', sourceId)

  if (error) return failure(500, error.message)

  return NextResponse.json({ ok: true })
}

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

function meaningfulUrl(value: unknown) {
  const raw = text(value)
  if (!raw || raw === 'null' || raw === 'undefined') return ''
  return raw
}

function tokenHash(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function makePairingToken() {
  return `phpair_${crypto.randomBytes(32).toString('base64url')}`
}

function makeSourceToken() {
  return `phsrc_live_${crypto.randomBytes(32).toString('base64url')}`
}

function appOrigin(request: Request, requestedOrigin = '') {
  const bodyOrigin = meaningfulUrl(requestedOrigin)
  if (bodyOrigin) {
    try {
      return new URL(bodyOrigin).origin
    } catch {
      // Fall back to configured/request origins below.
    }
  }

  const configuredOrigin = meaningfulUrl(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL)
  if (configuredOrigin) {
    try {
      return new URL(configuredOrigin).origin
    } catch {
      // Fall back to request headers below.
    }
  }

  const forwardedProto = text(request.headers.get('x-forwarded-proto')) || 'https'
  const forwardedHost = text(request.headers.get('x-forwarded-host')) || text(request.headers.get('host'))
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`

  return new URL(request.url).origin
}

export async function POST(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member'])
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) {
    return failure(402, 'Company subscription is not active.')
  }

  const body = await request.json().catch(() => ({}))
  const stationId = text(body.station_id || body.stationId)
  if (!stationId) return failure(400, 'Station is required.')

  const supabase = getSupabaseAdmin()
  const { data: station, error: stationError } = await supabase
    .from('photography_stations')
    .select('id, name, code')
    .eq('company_id', access.company.id)
    .eq('id', stationId)
    .eq('status', 'active')
    .maybeSingle()

  if (stationError) return failure(500, stationError.message)
  if (!station) return failure(404, 'Station not found for active company.')

  const token = makePairingToken()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

  const { data: pairing, error } = await supabase
    .from('photo_phone_pairing_tokens')
    .insert({
      company_id: access.company.id,
      station_id: stationId,
      token_hash: tokenHash(token),
      token_last_four: token.slice(-4),
      expires_at: expiresAt,
      created_by: access.user.id,
    })
    .select('id, company_id, station_id, token_last_four, status, expires_at, created_at')
    .single()

  if (error) return failure(500, error.message)

  const pairUrl = new URL('/processing/photo-phone', appOrigin(request, body.app_origin || body.appOrigin))
  pairUrl.searchParams.set('pair', token)

  return NextResponse.json({
    ok: true,
    pairing,
    station,
    pair_url: pairUrl.toString(),
    expires_at: expiresAt,
  })
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}))
  const pairToken = text(body.pair_token || body.pairToken)
  const deviceLabel = text(body.device_label || body.deviceLabel) || 'Phone camera'

  if (!pairToken) return failure(400, 'Pairing token is required.')

  const supabase = getSupabaseAdmin()
  const now = new Date().toISOString()

  const { data: pairing, error: pairError } = await supabase
    .from('photo_phone_pairing_tokens')
    .select('id, company_id, station_id, status, expires_at, station:photography_stations(id, name, code)')
    .eq('token_hash', tokenHash(pairToken))
    .maybeSingle()

  if (pairError) return failure(500, pairError.message)
  if (!pairing) return failure(404, 'Pairing token not found.')
  if (pairing.status !== 'pending') return failure(409, 'Pairing token has already been used.')
  if (new Date(pairing.expires_at).getTime() < Date.now()) {
    await supabase
      .from('photo_phone_pairing_tokens')
      .update({ status: 'expired' })
      .eq('id', pairing.id)
    return failure(410, 'Pairing token has expired.')
  }

  const sourceToken = makeSourceToken()
  const { data: source, error: sourceError } = await supabase
    .from('photo_sources')
    .insert({
      company_id: pairing.company_id,
      station_id: pairing.station_id,
      name: deviceLabel,
      source_type: 'phone',
      enabled: true,
      source_file_policy: 'keep_source_file',
      token_hash: tokenHash(sourceToken),
      token_last_four: sourceToken.slice(-4),
      token_created_at: now,
    })
    .select('id, company_id, station_id, name, source_type')
    .single()

  if (sourceError) return failure(500, sourceError.message)

  await supabase
    .from('photo_phone_pairing_tokens')
    .update({
      status: 'used',
      used_at: now,
    })
    .eq('id', pairing.id)

  return NextResponse.json({
    ok: true,
    source_token: sourceToken,
    source,
    station: Array.isArray(pairing.station) ? pairing.station[0] : pairing.station,
  })
}

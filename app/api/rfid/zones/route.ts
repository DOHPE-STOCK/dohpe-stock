import crypto from 'crypto'
import { NextResponse } from 'next/server'
import {
  companyHasOperationalAccess,
  getSupabaseAdmin,
  requireCompanyAccess,
} from '@/lib/serverTenant'
import { mergedRfidZoneRules, RFID_ZONE_DEFAULT_RULES } from '@/lib/rfidZoneRules'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function failure(status: number, message: string) {
  return NextResponse.json({ ok: false, message }, { status })
}

function text(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function zoneCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function tokenHash(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function newZoneToken() {
  return `lbz_${crypto.randomBytes(24).toString('base64url')}`
}

function cleanRules(zoneType: string, rules: any) {
  return mergedRfidZoneRules(zoneType, rules || {})
}

export async function GET(request: Request) {
  const access = await requireCompanyAccess(request)
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) return failure(402, 'Company subscription is not active.')

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('rfid_zones')
    .select(
      `id, company_id, location_id, name, code, zone_type, status, description,
      token_last_four, token_created_at, token_revoked_at, antenna_map, rules,
      last_seen_at, created_at, updated_at`
    )
    .eq('company_id', access.company.id)
    .neq('status', 'archived')
    .order('name', { ascending: true })

  if (error) {
    if (error.code === '42P01') return failure(400, 'RFID zone migration has not been run yet.')
    return failure(500, error.message)
  }

  return NextResponse.json({
    ok: true,
    zones: data || [],
    defaults: RFID_ZONE_DEFAULT_RULES,
  })
}

export async function POST(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager'])
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) return failure(402, 'Company subscription is not active.')

  const body = await request.json().catch(() => ({}))
  const action = text(body.action)
  const supabase = getSupabaseAdmin()

  if (action === 'create_token') {
    const zoneId = text(body.zone_id || body.zoneId || body.id)
    if (!zoneId) return failure(400, 'Zone is required.')

    const token = newZoneToken()
    const { data, error } = await supabase
      .from('rfid_zones')
      .update({
        token_hash: tokenHash(token),
        token_last_four: token.slice(-4),
        token_created_at: new Date().toISOString(),
        token_revoked_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', access.company.id)
      .eq('id', zoneId)
      .select('id, token_last_four, token_created_at')
      .single()

    if (error) return failure(500, error.message)
    return NextResponse.json({ ok: true, zone: data, token })
  }

  const name = text(body.name)
  const type = text(body.zone_type || body.zoneType || 'movement_log')
  const code = zoneCode(text(body.code) || name)
  if (!name) return failure(400, 'Zone name is required.')
  if (!code) return failure(400, 'Zone code is required.')

  const token = body.create_token === true ? newZoneToken() : ''
  const payload: Record<string, any> = {
    company_id: access.company.id,
    name,
    code,
    zone_type: type,
    status: ['active', 'disabled'].includes(text(body.status)) ? text(body.status) : 'active',
    location_id: text(body.location_id || body.locationId) || null,
    description: text(body.description) || null,
    antenna_map: Array.isArray(body.antenna_map) ? body.antenna_map : [],
    rules: cleanRules(type, body.rules),
    created_by: access.user.id,
  }
  if (token) {
    payload.token_hash = tokenHash(token)
    payload.token_last_four = token.slice(-4)
    payload.token_created_at = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('rfid_zones')
    .insert(payload)
    .select(
      `id, company_id, location_id, name, code, zone_type, status, description,
      token_last_four, token_created_at, token_revoked_at, antenna_map, rules,
      last_seen_at, created_at, updated_at`
    )
    .single()

  if (error) return failure(500, error.message)
  return NextResponse.json({ ok: true, zone: data, token: token || null })
}

export async function PATCH(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager'])
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) return failure(402, 'Company subscription is not active.')

  const body = await request.json().catch(() => ({}))
  const zoneId = text(body.id || body.zone_id || body.zoneId)
  const action = text(body.action)
  if (!zoneId) return failure(400, 'Zone is required.')

  const supabase = getSupabaseAdmin()

  if (action === 'revoke_token') {
    const { data, error } = await supabase
      .from('rfid_zones')
      .update({ token_hash: null, token_revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('company_id', access.company.id)
      .eq('id', zoneId)
      .select('id, token_last_four, token_revoked_at')
      .single()

    if (error) return failure(500, error.message)
    return NextResponse.json({ ok: true, zone: data })
  }

  const updates: Record<string, any> = { updated_at: new Date().toISOString() }
  if (body.name !== undefined) updates.name = text(body.name)
  if (body.code !== undefined) updates.code = zoneCode(text(body.code))
  if (body.zone_type !== undefined || body.zoneType !== undefined) updates.zone_type = text(body.zone_type || body.zoneType)
  if (body.status !== undefined && ['active', 'disabled', 'archived'].includes(text(body.status))) updates.status = text(body.status)
  if (body.location_id !== undefined || body.locationId !== undefined) updates.location_id = text(body.location_id || body.locationId) || null
  if (body.description !== undefined) updates.description = text(body.description) || null
  if (body.antenna_map !== undefined && Array.isArray(body.antenna_map)) updates.antenna_map = body.antenna_map
  if (body.rules !== undefined) {
    const type = text(updates.zone_type || body.zone_type || body.zoneType || body.current_zone_type || 'custom')
    updates.rules = cleanRules(type, body.rules)
  }

  if (updates.name === '') return failure(400, 'Zone name is required.')
  if (updates.code === '') return failure(400, 'Zone code is required.')

  const { data, error } = await supabase
    .from('rfid_zones')
    .update(updates)
    .eq('company_id', access.company.id)
    .eq('id', zoneId)
    .select(
      `id, company_id, location_id, name, code, zone_type, status, description,
      token_last_four, token_created_at, token_revoked_at, antenna_map, rules,
      last_seen_at, created_at, updated_at`
    )
    .single()

  if (error) return failure(500, error.message)
  return NextResponse.json({ ok: true, zone: data })
}

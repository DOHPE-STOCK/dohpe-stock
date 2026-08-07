import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { getSupabaseAdmin, requireCompanyAccess } from '@/lib/serverTenant'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status })
}

function photographyStationCode(deviceKey: string) {
  return deviceKey.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

async function syncPhotographyStation(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  companyId: string,
  deviceKey: string,
  name: string,
  isActive = true,
) {
  const code = photographyStationCode(deviceKey)
  if (!code) return null

  const { data: existing, error: lookupError } = await supabase
    .from('photography_stations')
    .select('id')
    .eq('company_id', companyId)
    .ilike('code', code)
    .maybeSingle()

  if (lookupError) throw lookupError

  const payload = {
    company_id: companyId,
    name,
    code,
    description: 'Created automatically from Loopbase Station Agent.',
    status: isActive ? 'active' : 'disabled',
  }

  if (existing?.id) {
    const { data, error } = await supabase
      .from('photography_stations')
      .update({
        name,
        status: isActive ? 'active' : 'disabled',
      })
      .eq('company_id', companyId)
      .eq('id', existing.id)
      .select('id, name, code, status')
      .single()
    if (error) throw error
    return data
  }

  const { data, error } = await supabase
    .from('photography_stations')
    .insert(payload)
    .select('id, name, code, status')
    .single()
  if (error) throw error
  return data
}

export async function GET(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin'])
  if (!access.ok) return jsonError(access.message, access.status)

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('company_devices')
    .select('id, device_key, name, device_type, is_active, last_seen_at, station_token, station_capabilities, station_last_payload, created_at, updated_at')
    .eq('company_id', access.company.id)
    .in('device_type', ['station', 'admin_station', 'receiving'])
    .order('created_at', { ascending: false })

  if (error) return jsonError(error.message, 500)
  return NextResponse.json({ ok: true, devices: data || [] })
}

export async function PATCH(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin'])
  if (!access.ok) return jsonError(access.message, access.status)

  const body = await request.json().catch(() => ({}))
  const id = String(body?.id || '').trim()
  const name = String(body?.name || '').trim()
  const isActive = body?.is_active

  if (!id) return jsonError('Missing station device id.')
  if (!name) return jsonError('Station name is required.')

  const updatePayload: Record<string, unknown> = {
    name,
    updated_at: new Date().toISOString(),
  }
  if (typeof isActive === 'boolean') updatePayload.is_active = isActive

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('company_devices')
    .update(updatePayload)
    .eq('company_id', access.company.id)
    .eq('id', id)
    .in('device_type', ['station', 'admin_station', 'receiving'])
    .select('id, device_key, name, device_type, is_active, last_seen_at, station_token, station_capabilities, station_last_payload, created_at, updated_at')
    .maybeSingle()

  if (error) return jsonError(error.message, 500)
  if (!data) return jsonError('Station device not found.', 404)

  try {
    const station = await syncPhotographyStation(
      supabase,
      access.company.id,
      data.device_key,
      data.name,
      data.is_active !== false,
    )
    return NextResponse.json({ ok: true, device: data, station })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Could not sync photography station.', 500)
  }
}

export async function POST(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin'])
  if (!access.ok) return jsonError(access.message, access.status)

  const body = await request.json().catch(() => ({}))
  const name = String(body?.name || 'Station Agent').trim()
  const deviceKey =
    String(body?.device_key || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || `station-${Date.now()}`
  const token = `lbsta_${crypto.randomBytes(32).toString('hex')}`

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('company_devices')
    .insert({
      company_id: access.company.id,
      device_key: deviceKey,
      name,
      device_type: 'station',
      allowed_areas: ['remote_printer', 'photography', 'rfid', 'rfid_zone'],
      station_token: token,
      station_capabilities: {
        remote_printer: true,
        photography: true,
        file_watcher: true,
        rfid_reader_writer: true,
        rfid_zone_monitor: true,
      },
    })
    .select('id, device_key, name, device_type, is_active, last_seen_at, station_token, station_capabilities, station_last_payload, created_at, updated_at')
    .single()

  if (error) return jsonError(error.message, 500)

  try {
    const station = await syncPhotographyStation(supabase, access.company.id, data.device_key, data.name)
    return NextResponse.json({ ok: true, device: data, station, station_token: token })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Could not create photography station.', 500)
  }
}

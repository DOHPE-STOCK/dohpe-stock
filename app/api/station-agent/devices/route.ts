import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { getSupabaseAdmin, requireCompanyAccess } from '@/lib/serverTenant'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status })
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
  return NextResponse.json({ ok: true, device: data })
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
  return NextResponse.json({ ok: true, device: data, station_token: token })
}

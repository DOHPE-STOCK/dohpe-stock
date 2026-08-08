import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/serverTenant'

function jsonError(message: string, status = 400) {
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

function folderDisplayName(folderPath: string, fallback: string) {
  const clean = folderPath.trim().replace(/[\\/]+$/g, '')
  if (!clean) return fallback
  const parts = clean.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || clean || fallback
}

function sourceRows(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((row, index) => {
      if (!row || typeof row !== 'object') return null
      const record = row as Record<string, unknown>
      const watchFolder = text(record.watch_folder || record.watchFolder)
      const name = text(record.name) || folderDisplayName(watchFolder, `Photo Folder ${index + 1}`)
      const processedFolder = text(record.processed_folder || record.processedFolder)
      const trashFolder = text(record.trash_folder || record.trashFolder)
      if (!watchFolder && index > 0) return null
      return {
        name,
        watch_folder: watchFolder,
        processed_folder: processedFolder,
        trash_folder: trashFolder,
      }
    })
    .filter(Boolean)
    .slice(0, 3) as Array<{
      name: string
      watch_folder: string
      processed_folder: string
      trash_folder: string
    }>
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const stationToken = text(body.station_token || body.stationToken)
  const stationName = text(body.station_name || body.stationName) || 'Station Agent'
  const rows = sourceRows(body.sources)

  if (!stationToken) return jsonError('Missing station token.', 401)

  const supabase = getSupabaseAdmin()
  const { data: device, error: deviceError } = await supabase
    .from('company_devices')
    .select('id, company_id, device_key, name, is_active, station_token')
    .eq('station_token', stationToken)
    .maybeSingle()

  if (deviceError) return jsonError(deviceError.message, 500)
  if (!device || device.is_active === false) return jsonError('Invalid or inactive station token.', 401)

  const stationCode = text(device.device_key) || `station-${device.id}`
  const displayName = text(device.name) || stationName

  const { data: existingStation, error: stationLookupError } = await supabase
    .from('photography_stations')
    .select('id, name, code')
    .eq('company_id', device.company_id)
    .ilike('code', stationCode)
    .maybeSingle()

  if (stationLookupError) return jsonError(stationLookupError.message, 500)

  let station = existingStation
  if (!station) {
    const { data: inserted, error: insertError } = await supabase
      .from('photography_stations')
      .insert({
        company_id: device.company_id,
        name: displayName,
        code: stationCode,
        description: 'Created automatically from Loopbase Station Agent.',
        status: 'active',
      })
      .select('id, name, code')
      .single()

    if (insertError) return jsonError(insertError.message, 500)
    station = inserted
  } else if (station.name !== displayName) {
    const { data: updated, error: updateError } = await supabase
      .from('photography_stations')
      .update({
        name: displayName,
        status: 'active',
      })
      .eq('company_id', device.company_id)
      .eq('id', station.id)
      .select('id, name, code')
      .single()

    if (updateError) return jsonError(updateError.message, 500)
    station = updated
  }

  const sources = []
  const now = new Date().toISOString()

  for (const row of rows) {
    const token = makeSourceToken()
    const { data: existingSource, error: sourceLookupError } = await supabase
      .from('photo_sources')
      .select('id')
      .eq('company_id', device.company_id)
      .eq('station_id', station.id)
      .ilike('name', row.name)
      .maybeSingle()

    if (sourceLookupError) return jsonError(sourceLookupError.message, 500)

    const payload = {
      company_id: device.company_id,
      station_id: station.id,
      name: row.name,
      source_type: 'watched_folder',
      enabled: true,
      timezone: 'Europe/London',
      source_file_policy: 'keep_source_file',
      local_reference: {
        watch_folder: row.watch_folder,
        processed_folder: row.processed_folder || null,
        trash_folder: row.trash_folder || null,
        station_agent_source: true,
      },
      token_hash: tokenHash(token),
      token_last_four: token.slice(-4),
      token_created_at: now,
      token_revoked_at: null,
    }

    const query = existingSource
      ? supabase
          .from('photo_sources')
          .update(payload)
          .eq('company_id', device.company_id)
          .eq('id', existingSource.id)
          .select('id, station_id, name, source_type, enabled, token_last_four, token_created_at, local_reference')
          .single()
      : supabase
          .from('photo_sources')
          .insert(payload)
          .select('id, station_id, name, source_type, enabled, token_last_four, token_created_at, local_reference')
          .single()

    const { data: source, error: sourceError } = await query
    if (sourceError) return jsonError(sourceError.message, 500)

    sources.push({
      ...row,
      id: source.id,
      station_id: source.station_id,
      source_type: source.source_type,
      enabled: source.enabled,
      local_reference: source.local_reference,
      token,
      token_last_four: source.token_last_four,
    })
  }

  return NextResponse.json({
    ok: true,
    station,
    sources,
  })
}

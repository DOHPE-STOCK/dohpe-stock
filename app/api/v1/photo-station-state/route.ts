import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/serverTenant'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function failure(status: number, message: string) {
  return NextResponse.json({ ok: false, message }, { status })
}

function tokenHash(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function getBearerToken(request: Request) {
  const header = request.headers.get('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

export async function GET(request: Request) {
  try {
    const token = getBearerToken(request)
    if (!token) return failure(401, 'Missing photo source token.')

    const supabase = getSupabaseAdmin()
    const { data: source, error: sourceError } = await supabase
      .from('photo_sources')
      .select('id, company_id, station_id, name, source_type, enabled, token_revoked_at, last_activity_at')
      .eq('token_hash', tokenHash(token))
      .maybeSingle()

    if (sourceError) return failure(500, sourceError.message)
    if (!source || source.enabled === false || source.token_revoked_at) {
      return failure(401, 'Invalid photo source token.')
    }

    const lastActivityAt = source.last_activity_at ? new Date(source.last_activity_at).getTime() : 0
    if (!lastActivityAt || Date.now() - lastActivityAt > 60 * 1000) {
      await supabase
        .from('photo_sources')
        .update({ last_activity_at: new Date().toISOString() })
        .eq('id', source.id)
        .eq('company_id', source.company_id)
    }

    const { data: station, error: stationError } = await supabase
      .from('photography_stations')
      .select(
        `id, company_id, name, code, active_photo_session_id,
        active_session:photo_sessions!photography_stations_active_photo_session_fkey(
          id,
          item_id,
          status,
          started_at,
          item:items(id, sku, final_title, ai_title, basic_title, website_title, brand)
        )`
      )
      .eq('company_id', source.company_id)
      .eq('id', source.station_id)
      .maybeSingle()

    if (stationError) return failure(500, stationError.message)
    if (!station) return failure(404, 'Station not found.')

    return NextResponse.json({ ok: true, source, station })
  } catch (error: any) {
    return failure(500, error.message || 'Could not load station state.')
  }
}

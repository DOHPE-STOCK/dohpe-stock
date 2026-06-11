import { NextResponse } from 'next/server'
import { getSupabaseAdmin, requireCompanyAccess } from '@/lib/serverTenant'

function jsonError(message: string, status = 400, extra: Record<string, any> = {}) {
  return NextResponse.json({ ok: false, message, ...extra }, { status })
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || '').trim().slice(0, maxLength)
}

export async function POST(request: Request) {
  const access = await requireCompanyAccess(request)
  if (!access.ok) return jsonError(access.message, access.status)

  const body = await request.json().catch(() => ({}))
  const action = cleanText(body.action, 30)
  const sessionKey = cleanText(body.session_key, 120)
  const deviceLabel = cleanText(body.device_label, 160)
  const takeover = body.takeover === true
  const supabase = getSupabaseAdmin()
  const now = new Date().toISOString()

  if (!sessionKey) return jsonError('Missing session key.')

  if (action === 'end') {
    const { error } = await supabase
      .from('user_app_sessions')
      .update({
        status: 'signed_out',
        ended_at: now,
        ended_reason: 'signed_out',
        last_seen_at: now,
      })
      .eq('session_key', sessionKey)
      .eq('user_id', access.user.id)

    if (error) return jsonError(error.message, 500)
    return NextResponse.json({ ok: true })
  }

  if (action === 'heartbeat') {
    const { error } = await supabase
      .from('user_app_sessions')
      .update({
        company_id: access.company.id,
        last_seen_at: now,
        metadata: {
          last_path: cleanText(body.path, 220),
          heartbeat_at: now,
        },
      })
      .eq('session_key', sessionKey)
      .eq('user_id', access.user.id)
      .eq('status', 'active')

    if (error) return jsonError(error.message, 500)
    return NextResponse.json({ ok: true })
  }

  if (action !== 'start') return jsonError('Unknown session action.')

  const { data: activeSessions, error: activeError } = await supabase
    .from('user_app_sessions')
    .select('id, session_key, device_label, last_seen_at, started_at')
    .eq('user_id', access.user.id)
    .eq('status', 'active')
    .neq('session_key', sessionKey)
    .order('last_seen_at', { ascending: false })

  if (activeError) return jsonError(activeError.message, 500)

  if ((activeSessions || []).length > 0 && !takeover) {
    return jsonError('Another active app session is already open.', 409, {
      code: 'ACTIVE_SESSION_EXISTS',
      session: activeSessions?.[0] || null,
    })
  }

  if (takeover) {
    const { error: revokeError } = await supabase
      .from('user_app_sessions')
      .update({
        status: 'revoked',
        ended_at: now,
        ended_reason: 'taken_over',
        last_seen_at: now,
      })
      .eq('user_id', access.user.id)
      .eq('status', 'active')
      .neq('session_key', sessionKey)

    if (revokeError) return jsonError(revokeError.message, 500)
  }

  const { data: session, error: upsertError } = await supabase
    .from('user_app_sessions')
    .upsert(
      {
        user_id: access.user.id,
        company_id: access.company.id,
        session_key: sessionKey,
        device_label: deviceLabel || null,
        user_agent: request.headers.get('user-agent') || null,
        status: 'active',
        last_seen_at: now,
        ended_at: null,
        ended_reason: null,
        metadata: {
          path: cleanText(body.path, 220),
          takeover,
        },
      },
      { onConflict: 'session_key' }
    )
    .select('id, session_key, status, last_seen_at')
    .single()

  if (upsertError) return jsonError(upsertError.message, 500)

  return NextResponse.json({ ok: true, session })
}

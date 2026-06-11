import { NextResponse } from 'next/server'
import { getSupabaseAdmin, requireCompanyAccess } from '@/lib/serverTenant'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status })
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || '').trim().slice(0, maxLength)
}

export async function POST(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member', 'viewer', 'billing'])
  if (!access.ok) return jsonError(access.message, access.status)

  const body = await request.json().catch(() => ({}))
  const action = cleanText(body.action, 30)
  const sessionKey = cleanText(body.session_key, 120)
  const staffId = cleanText(body.staff_id, 80)
  const allowedArea = cleanText(body.allowed_area, 60)
  const supabase = getSupabaseAdmin()
  const now = new Date().toISOString()

  if (!sessionKey) return jsonError('Missing app session key.')

  const { data: appSession, error: appSessionError } = await supabase
    .from('user_app_sessions')
    .select('id, device_id')
    .eq('session_key', sessionKey)
    .eq('user_id', access.user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (appSessionError) return jsonError(appSessionError.message, 500)

  if (action === 'end') {
    let query = supabase
      .from('staff_pin_sessions')
      .update({
        status: 'cleared',
        ended_at: now,
        ended_reason: 'staff_cleared',
        last_activity_at: now,
      })
      .eq('company_id', access.company.id)
      .eq('status', 'active')

    query = appSession?.id ? query.eq('user_app_session_id', appSession.id) : query.eq('staff_id', staffId)

    const { error } = await query
    if (error) return jsonError(error.message, 500)

    return NextResponse.json({ ok: true })
  }

  if (action === 'activity') {
    if (!appSession?.id) return NextResponse.json({ ok: true })

    const { error } = await supabase
      .from('staff_pin_sessions')
      .update({
        last_activity_at: now,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      })
      .eq('company_id', access.company.id)
      .eq('user_app_session_id', appSession.id)
      .eq('status', 'active')

    if (error) return jsonError(error.message, 500)
    return NextResponse.json({ ok: true })
  }

  if (action !== 'start') return jsonError('Unknown staff PIN session action.')
  if (!staffId) return jsonError('Missing staff user.')

  const { data: staff, error: staffError } = await supabase
    .from('staff_users')
    .select('id')
    .eq('company_id', access.company.id)
    .eq('id', staffId)
    .eq('is_active', true)
    .maybeSingle()

  if (staffError) return jsonError(staffError.message, 500)
  if (!staff) return jsonError('Staff user not found for this company.', 404)

  if (appSession?.id) {
    const { error: clearError } = await supabase
      .from('staff_pin_sessions')
      .update({
        status: 'cleared',
        ended_at: now,
        ended_reason: 'new_staff_selected',
        last_activity_at: now,
      })
      .eq('company_id', access.company.id)
      .eq('user_app_session_id', appSession.id)
      .eq('status', 'active')

    if (clearError) return jsonError(clearError.message, 500)
  }

  const { data: pinSession, error: insertError } = await supabase
    .from('staff_pin_sessions')
    .insert({
      company_id: access.company.id,
      staff_id: staffId,
      user_app_session_id: appSession?.id || null,
      device_id: appSession?.device_id || null,
      allowed_area: allowedArea || null,
      status: 'active',
      last_activity_at: now,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    })
    .select('id, expires_at')
    .single()

  if (insertError) return jsonError(insertError.message, 500)

  return NextResponse.json({ ok: true, session: pinSession })
}

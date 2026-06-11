import { NextResponse } from 'next/server'
import { getSupabaseAdmin, requireCompanyAccess } from '@/lib/serverTenant'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function normaliseEmail(value: any) {
  return String(value || '').trim().toLowerCase()
}

export async function POST(request: Request) {
  try {
    const access = await requireCompanyAccess(request, ['owner', 'admin'])
    if (!access.ok) {
      return NextResponse.json({ ok: false, message: access.message }, { status: access.status })
    }

    const body = await request.json().catch(() => ({}))
    const email = normaliseEmail(body.email)
    const role = String(body.role || 'member').trim()

    if (!email || !email.includes('@')) {
      return NextResponse.json({ ok: false, message: 'Valid invite email is required.' }, { status: 400 })
    }

    if (!['owner', 'admin', 'manager', 'member', 'billing', 'viewer'].includes(role)) {
      return NextResponse.json({ ok: false, message: 'Invalid role.' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString()

    const { data, error } = await supabase
      .from('company_invites')
      .insert({
        company_id: access.company.id,
        email,
        role,
        status: 'pending',
        invited_by_user_id: access.user.id,
        expires_at: expiresAt,
      })
      .select('id, email, role, status, expires_at, created_at')
      .single()

    if (error) throw new Error(error.message)

    await supabase.from('company_audit_events').insert({
      company_id: access.company.id,
      actor_user_id: access.user.id,
      event_type: 'company.invite_created',
      metadata: { email, role },
    })

    return NextResponse.json({ ok: true, invite: data })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'Could not create invite.' },
      { status: 500 }
    )
  }
}

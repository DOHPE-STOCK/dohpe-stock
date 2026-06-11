import { NextResponse } from 'next/server'
import { getServerUser, getSupabaseAdmin } from '@/lib/serverTenant'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function normaliseEmail(value: any) {
  return String(value || '').trim().toLowerCase()
}

export async function POST(request: Request) {
  try {
    const user = await getServerUser()
    if (!user?.email) {
      return NextResponse.json({ ok: false, message: 'Login required.' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const inviteId = String(body.inviteId || '').trim()

    if (!inviteId) {
      return NextResponse.json({ ok: false, message: 'Invite ID is required.' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const email = normaliseEmail(user.email)
    const now = new Date()
    const nowIso = now.toISOString()

    const { data: invite, error: inviteError } = await supabase
      .from('company_invites')
      .select('id, company_id, email, role, status, expires_at')
      .eq('id', inviteId)
      .eq('status', 'pending')
      .maybeSingle()

    if (inviteError) throw new Error(inviteError.message)
    if (!invite) {
      return NextResponse.json({ ok: false, message: 'Invite was not found.' }, { status: 404 })
    }

    if (normaliseEmail(invite.email) !== email) {
      return NextResponse.json({ ok: false, message: 'This invite is for a different login.' }, { status: 403 })
    }

    if (invite.expires_at && new Date(invite.expires_at).getTime() <= now.getTime()) {
      await supabase
        .from('company_invites')
        .update({ status: 'expired', updated_at: nowIso })
        .eq('id', invite.id)

      return NextResponse.json({ ok: false, message: 'This invite has expired.' }, { status: 410 })
    }

    const role = ['owner', 'admin', 'manager', 'member', 'billing', 'viewer'].includes(invite.role)
      ? invite.role
      : 'member'

    const { error: membershipError } = await supabase.from('company_memberships').upsert(
      {
        company_id: invite.company_id,
        user_id: user.id,
        role,
        status: 'active',
        joined_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'company_id,user_id' }
    )

    if (membershipError) throw new Error(membershipError.message)

    const { error: updateInviteError } = await supabase
      .from('company_invites')
      .update({
        status: 'accepted',
        accepted_by_user_id: user.id,
        accepted_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', invite.id)

    if (updateInviteError) throw new Error(updateInviteError.message)

    await supabase.from('user_company_preferences').upsert(
      {
        user_id: user.id,
        active_company_id: invite.company_id,
        updated_at: nowIso,
      },
      { onConflict: 'user_id' }
    )

    await supabase.from('company_audit_events').insert({
      company_id: invite.company_id,
      actor_user_id: user.id,
      event_type: 'company.invite_accepted',
      metadata: { invite_id: invite.id, email, role },
    })

    return NextResponse.json({ ok: true, companyId: invite.company_id })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'Could not accept invite.' },
      { status: 500 }
    )
  }
}

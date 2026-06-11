import { NextResponse } from 'next/server'
import { getServerUser, getSupabaseAdmin } from '@/lib/serverTenant'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function normaliseEmail(value: any) {
  return String(value || '').trim().toLowerCase()
}

export async function GET() {
  try {
    const user = await getServerUser()
    if (!user?.email) {
      return NextResponse.json({ ok: false, message: 'Login required.' }, { status: 401 })
    }

    const email = normaliseEmail(user.email)
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from('company_invites')
      .select(
        `id, email, role, status, expires_at, created_at,
        company:companies(id, name, slug, access_state)`
      )
      .eq('email', email)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (error) throw new Error(error.message)

    const now = Date.now()
    const invites = (data || []).filter((invite: any) => {
      if (!invite.expires_at) return true
      return new Date(invite.expires_at).getTime() > now
    })

    return NextResponse.json({ ok: true, invites })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'Could not load incoming invites.' },
      { status: 500 }
    )
  }
}

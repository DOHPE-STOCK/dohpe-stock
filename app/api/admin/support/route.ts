import { NextResponse } from 'next/server'
import { getServerUser, getSupabaseAdmin } from '@/lib/serverTenant'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status })
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || '').trim().slice(0, maxLength)
}

async function requirePlatformAdmin() {
  const user = await getServerUser()
  if (!user) return { ok: false as const, status: 401, message: 'Login required.' }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('platform_admin_users')
    .select('id, role')
    .or(`auth_user_id.eq.${user.id},user_id.eq.${user.id}`)
    .eq('is_active', true)
    .maybeSingle()

  if (error) return { ok: false as const, status: 500, message: error.message }
  if (!data) return { ok: false as const, status: 403, message: 'Platform admin access required.' }

  return { ok: true as const, user, supabase, admin: data }
}

export async function GET(request: Request) {
  const access = await requirePlatformAdmin()
  if (!access.ok) return jsonError(access.message, access.status)

  const { searchParams } = new URL(request.url)
  const ticketId = searchParams.get('ticket_id')

  if (ticketId) {
    const [ticketResult, messagesResult] = await Promise.all([
      access.supabase
        .from('support_tickets')
        .select(
          `id, company_id, subject, status, priority, category, created_by, last_reply_at, last_customer_reply_at, last_admin_reply_at, created_at, updated_at,
          company:companies(name, slug)`
        )
        .eq('id', ticketId)
        .maybeSingle(),
      access.supabase
        .from('support_ticket_messages')
        .select('id, ticket_id, sender_user_id, sender_type, body, is_internal_note, created_at')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true }),
    ])

    if (ticketResult.error) return jsonError(ticketResult.error.message, 500)
    if (messagesResult.error) return jsonError(messagesResult.error.message, 500)
    if (!ticketResult.data) return jsonError('Support ticket not found.', 404)

    return NextResponse.json({
      ok: true,
      ticket: ticketResult.data,
      messages: messagesResult.data || [],
    })
  }

  const { data, error } = await access.supabase
    .from('support_tickets')
    .select(
      `id, company_id, subject, status, priority, category, created_by, last_reply_at, last_customer_reply_at, last_admin_reply_at, created_at, updated_at,
      company:companies(name, slug)`
    )
    .order('updated_at', { ascending: false })
    .limit(100)

  if (error) return jsonError(error.message, 500)

  return NextResponse.json({ ok: true, tickets: data || [] })
}

export async function POST(request: Request) {
  const access = await requirePlatformAdmin()
  if (!access.ok) return jsonError(access.message, access.status)

  const body = await request.json().catch(() => ({}))
  const ticketId = cleanText(body.ticket_id, 80)
  const message = cleanText(body.message, 4000)
  const status = ['open', 'waiting_on_support', 'waiting_on_customer', 'resolved', 'closed'].includes(body.status)
    ? String(body.status)
    : 'waiting_on_customer'

  if (!ticketId) return jsonError('Missing support ticket.')
  if (!message && !body.status) return jsonError('Add a reply or status change.')

  const { data: ticket, error: ticketError } = await access.supabase
    .from('support_tickets')
    .select('id, company_id, created_by, subject')
    .eq('id', ticketId)
    .maybeSingle()

  if (ticketError) return jsonError(ticketError.message, 500)
  if (!ticket) return jsonError('Support ticket not found.', 404)

  const now = new Date().toISOString()

  if (message) {
    const { error: messageError } = await access.supabase.from('support_ticket_messages').insert({
      ticket_id: ticket.id,
      company_id: ticket.company_id,
      sender_user_id: access.user.id,
      sender_type: 'admin',
      body: message,
      is_internal_note: false,
    })

    if (messageError) return jsonError(messageError.message, 500)
  }

  const ticketPatch: Record<string, any> = {
    status,
    assigned_admin_user_id: access.user.id,
    updated_at: now,
  }

  if (message) {
    ticketPatch.last_reply_at = now
    ticketPatch.last_admin_reply_at = now
  }

  const { error: updateError } = await access.supabase
    .from('support_tickets')
    .update(ticketPatch)
    .eq('id', ticket.id)

  if (updateError) return jsonError(updateError.message, 500)

  if (message) {
    await access.supabase.rpc('loopbase_notify_support_reply', {
      target_company_id: ticket.company_id,
      target_user_id: ticket.created_by,
      target_ticket_id: ticket.id,
      target_subject: ticket.subject,
      target_href: '/settings?section=support',
    })
  }

  return NextResponse.json({ ok: true })
}

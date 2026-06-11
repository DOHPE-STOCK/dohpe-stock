import { NextResponse } from 'next/server'
import { getSupabaseAdmin, requireCompanyAccess } from '@/lib/serverTenant'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status })
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || '').trim().slice(0, maxLength)
}

export async function GET(request: Request) {
  const access = await requireCompanyAccess(request)
  if (!access.ok) return jsonError(access.message, access.status)

  const supabase = getSupabaseAdmin()
  const { searchParams } = new URL(request.url)
  const ticketId = searchParams.get('ticket_id')

  if (ticketId) {
    const [ticketResult, messagesResult] = await Promise.all([
      supabase
        .from('support_tickets')
        .select('id, company_id, subject, status, priority, category, created_by, last_reply_at, created_at, updated_at')
        .eq('company_id', access.company.id)
        .eq('id', ticketId)
        .maybeSingle(),
      supabase
        .from('support_ticket_messages')
        .select('id, ticket_id, sender_user_id, sender_type, body, is_internal_note, created_at')
        .eq('company_id', access.company.id)
        .eq('ticket_id', ticketId)
        .eq('is_internal_note', false)
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

  const { data, error } = await supabase
    .from('support_tickets')
    .select('id, subject, status, priority, category, created_by, last_reply_at, created_at, updated_at')
    .eq('company_id', access.company.id)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) return jsonError(error.message, 500)

  return NextResponse.json({ ok: true, tickets: data || [] })
}

export async function POST(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member'])
  if (!access.ok) return jsonError(access.message, access.status)

  const body = await request.json().catch(() => ({}))
  const subject = cleanText(body.subject, 160)
  const message = cleanText(body.message, 4000)
  const category = ['general', 'billing', 'integration', 'stock', 'bug', 'feature'].includes(body.category)
    ? String(body.category)
    : 'general'
  const priority = ['low', 'normal', 'high', 'urgent'].includes(body.priority)
    ? String(body.priority)
    : 'normal'

  if (!subject) return jsonError('Add a support ticket subject.')
  if (!message) return jsonError('Add a support ticket message.')

  const supabase = getSupabaseAdmin()
  const now = new Date().toISOString()

  const { data: ticket, error: ticketError } = await supabase
    .from('support_tickets')
    .insert({
      company_id: access.company.id,
      created_by: access.user.id,
      subject,
      category,
      priority,
      status: 'waiting_on_support',
      last_reply_at: now,
      last_customer_reply_at: now,
      updated_at: now,
    })
    .select('id, subject, status, priority, category, created_at, updated_at')
    .single()

  if (ticketError) return jsonError(ticketError.message, 500)

  const { error: messageError } = await supabase.from('support_ticket_messages').insert({
    ticket_id: ticket.id,
    company_id: access.company.id,
    sender_user_id: access.user.id,
    sender_type: 'customer',
    body: message,
    is_internal_note: false,
  })

  if (messageError) return jsonError(messageError.message, 500)

  return NextResponse.json({ ok: true, ticket })
}

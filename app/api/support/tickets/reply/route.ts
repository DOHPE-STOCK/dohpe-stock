import { NextResponse } from 'next/server'
import { getSupabaseAdmin, requireCompanyAccess } from '@/lib/serverTenant'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status })
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || '').trim().slice(0, maxLength)
}

export async function POST(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member'])
  if (!access.ok) return jsonError(access.message, access.status)

  const body = await request.json().catch(() => ({}))
  const ticketId = cleanText(body.ticket_id, 80)
  const message = cleanText(body.message, 4000)

  if (!ticketId) return jsonError('Missing support ticket.')
  if (!message) return jsonError('Add a reply.')

  const supabase = getSupabaseAdmin()
  const now = new Date().toISOString()

  const { data: ticket, error: ticketError } = await supabase
    .from('support_tickets')
    .select('id, company_id, subject')
    .eq('company_id', access.company.id)
    .eq('id', ticketId)
    .maybeSingle()

  if (ticketError) return jsonError(ticketError.message, 500)
  if (!ticket) return jsonError('Support ticket not found.', 404)

  const { error: messageError } = await supabase.from('support_ticket_messages').insert({
    ticket_id: ticket.id,
    company_id: access.company.id,
    sender_user_id: access.user.id,
    sender_type: 'customer',
    body: message,
    is_internal_note: false,
  })

  if (messageError) return jsonError(messageError.message, 500)

  const { error: updateError } = await supabase
    .from('support_tickets')
    .update({
      status: 'waiting_on_support',
      last_reply_at: now,
      last_customer_reply_at: now,
      updated_at: now,
    })
    .eq('company_id', access.company.id)
    .eq('id', ticket.id)

  if (updateError) return jsonError(updateError.message, 500)

  return NextResponse.json({ ok: true })
}

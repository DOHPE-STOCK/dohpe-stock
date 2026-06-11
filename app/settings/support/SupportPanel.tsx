'use client'

import { useEffect, useMemo, useState } from 'react'

type SupportTicket = {
  id: string
  subject: string
  status: string
  priority: string
  category: string
  last_reply_at?: string | null
  created_at: string
  updated_at: string
}

type SupportMessage = {
  id: string
  sender_type: 'customer' | 'admin'
  body: string
  created_at: string
}

function formatDate(value?: string | null) {
  if (!value) return 'No replies yet'
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusLabel(value: string) {
  return value.replaceAll('_', ' ')
}

export default function SupportPanel() {
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [selectedTicketId, setSelectedTicketId] = useState('')
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState('general')
  const [priority, setPriority] = useState('normal')
  const [newMessage, setNewMessage] = useState('')
  const [replyMessage, setReplyMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedTicketId) || null,
    [tickets, selectedTicketId]
  )

  useEffect(() => {
    loadTickets()
  }, [])

  useEffect(() => {
    if (selectedTicketId) loadTicket(selectedTicketId)
  }, [selectedTicketId])

  async function loadTickets() {
    setLoading(true)
    const response = await fetch('/api/support/tickets', { cache: 'no-store' }).catch(() => null)
    const payload = await response?.json().catch(() => null)
    setLoading(false)

    if (!response?.ok || !payload?.ok) {
      setMessage(payload?.message || 'Could not load support tickets.')
      return
    }

    const nextTickets = (payload.tickets || []) as SupportTicket[]
    setTickets(nextTickets)
    setSelectedTicketId((current) => current || nextTickets[0]?.id || '')
  }

  async function loadTicket(ticketId: string) {
    const response = await fetch(`/api/support/tickets?ticket_id=${encodeURIComponent(ticketId)}`, {
      cache: 'no-store',
    }).catch(() => null)
    const payload = await response?.json().catch(() => null)

    if (!response?.ok || !payload?.ok) {
      setMessage(payload?.message || 'Could not load support ticket.')
      return
    }

    setMessages((payload.messages || []) as SupportMessage[])
  }

  async function createTicket() {
    if (!subject.trim() || !newMessage.trim()) {
      setMessage('Add a subject and message.')
      return
    }

    setBusy(true)
    setMessage('')

    const response = await fetch('/api/support/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject,
        message: newMessage,
        category,
        priority,
      }),
    }).catch(() => null)
    const payload = await response?.json().catch(() => null)
    setBusy(false)

    if (!response?.ok || !payload?.ok) {
      setMessage(payload?.message || 'Could not create support ticket.')
      return
    }

    setSubject('')
    setNewMessage('')
    setPriority('normal')
    setCategory('general')
    await loadTickets()
    setSelectedTicketId(payload.ticket.id)
    setMessage('Support ticket created.')
  }

  async function sendReply() {
    if (!selectedTicketId || !replyMessage.trim()) return

    setBusy(true)
    setMessage('')

    const response = await fetch('/api/support/tickets/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticket_id: selectedTicketId,
        message: replyMessage,
      }),
    }).catch(() => null)
    const payload = await response?.json().catch(() => null)
    setBusy(false)

    if (!response?.ok || !payload?.ok) {
      setMessage(payload?.message || 'Could not send reply.')
      return
    }

    setReplyMessage('')
    await Promise.all([loadTickets(), loadTicket(selectedTicketId)])
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
      <div className="space-y-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="text-lg font-black text-white">New Support Ticket</h2>
          <p className="mt-1 text-sm font-bold text-zinc-500">
            Send a request to Loopbase support. Replies will appear in the notification bell.
          </p>

          <div className="mt-4 space-y-3">
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Subject"
              className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm font-bold text-white outline-none focus:border-white"
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="h-10 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm font-bold text-white"
              >
                <option value="general">General</option>
                <option value="billing">Billing</option>
                <option value="integration">Integration</option>
                <option value="stock">Stock</option>
                <option value="bug">Bug</option>
                <option value="feature">Feature</option>
              </select>

              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                className="h-10 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm font-bold text-white"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            <textarea
              value={newMessage}
              onChange={(event) => setNewMessage(event.target.value)}
              placeholder="What do you need help with?"
              rows={5}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-bold text-white outline-none focus:border-white"
            />

            <button
              type="button"
              onClick={createTicket}
              disabled={busy}
              className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy ? 'Sending' : 'Create Ticket'}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-sm font-black uppercase tracking-wide text-zinc-400">Your Tickets</h2>

          <div className="mt-3 space-y-2">
            {loading ? (
              <p className="rounded-lg bg-zinc-950 p-3 text-sm font-bold text-zinc-500">Loading...</p>
            ) : tickets.length === 0 ? (
              <p className="rounded-lg bg-zinc-950 p-3 text-sm font-bold text-zinc-500">
                No support tickets yet.
              </p>
            ) : (
              tickets.map((ticket) => {
                const selected = ticket.id === selectedTicketId

                return (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => setSelectedTicketId(ticket.id)}
                    className={`w-full rounded-lg border p-3 text-left ${
                      selected
                        ? 'border-emerald-400 bg-emerald-700 text-white'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600'
                    }`}
                  >
                    <span className="block truncate text-sm font-black">{ticket.subject}</span>
                    <span className={`mt-1 block text-xs font-bold ${selected ? 'text-emerald-50' : 'text-zinc-500'}`}>
                      {statusLabel(ticket.status)} · {formatDate(ticket.updated_at)}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        {message && (
          <p className="mb-4 rounded-lg border border-yellow-800 bg-yellow-950 p-3 text-sm font-bold text-yellow-200">
            {message}
          </p>
        )}

        {!selectedTicket ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-8 text-center text-sm font-bold text-zinc-500">
            Select a ticket to view the conversation.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800 pb-4">
              <div>
                <h2 className="text-2xl font-black text-white">{selectedTicket.subject}</h2>
                <p className="mt-1 text-sm font-bold text-zinc-500">
                  {statusLabel(selectedTicket.status)} · {selectedTicket.category} · {selectedTicket.priority}
                </p>
              </div>

              <span className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-black text-zinc-300">
                {formatDate(selectedTicket.updated_at)}
              </span>
            </div>

            <div className="mt-4 max-h-[460px] space-y-3 overflow-y-auto pr-1">
              {messages.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-xl border p-4 ${
                    item.sender_type === 'admin'
                      ? 'border-sky-500/30 bg-sky-500/10'
                      : 'border-zinc-800 bg-zinc-950'
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-xs font-black uppercase tracking-wide text-zinc-500">
                      {item.sender_type === 'admin' ? 'Loopbase Support' : 'You'}
                    </p>
                    <p className="text-xs font-bold text-zinc-600">{formatDate(item.created_at)}</p>
                  </div>
                  <p className="whitespace-pre-wrap text-sm font-bold leading-relaxed text-zinc-200">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4 border-t border-zinc-800 pt-4">
              <textarea
                value={replyMessage}
                onChange={(event) => setReplyMessage(event.target.value)}
                placeholder="Reply to support"
                rows={4}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-bold text-white outline-none focus:border-white"
              />
              <button
                type="button"
                onClick={sendReply}
                disabled={busy || !replyMessage.trim()}
                className="mt-3 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Send Reply
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

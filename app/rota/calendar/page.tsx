'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type CalendarEvent = {
  id: string
  title: string
  start: string
  end: string
}

export default function RotaCalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    loadEvents()
  }, [])

  async function loadEvents() {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        setConnected(false)
        setLoading(false)
        return
      }

      const response = await fetch('/api/rota/google/events', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })

      if (!response.ok) {
        setConnected(false)
        setLoading(false)
        return
      }

      const data = await response.json()

      setEvents(data.events || [])
      setEmail(data.email || '')
      setConnected(true)
    } catch (error) {
      console.error(error)
      setConnected(false)
    } finally {
      setLoading(false)
    }
  }

  function openGoogleCalendar() {
    window.open('https://calendar.google.com/calendar/u/0/r/month', '_blank')
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-neutral-100 p-6">
        <div className="rounded-3xl bg-white p-6 shadow-xl">
          Loading Google Calendar...
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-neutral-100 p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="rounded-3xl bg-black p-6 text-white shadow-2xl">
          <h1 className="text-3xl font-black">Google Calendar</h1>

          {connected ? (
            <p className="mt-2 text-sm text-white/70">Connected as {email}</p>
          ) : (
            <p className="mt-2 text-sm text-red-300">
              Google Calendar not connected
            </p>
          )}

          <div className="mt-4 flex gap-3">
            {!connected && (
              <a
                href="/api/rota/google/connect"
                className="rounded-2xl bg-blue-500 px-5 py-3 text-sm font-black text-white"
              >
                Connect Google Calendar
              </a>
            )}

            {connected && (
              <>
                <button
                  type="button"
                  onClick={loadEvents}
                  className="rounded-2xl bg-blue-500 px-5 py-3 text-sm font-black text-white"
                >
                  Refresh
                </button>

                <button
                  type="button"
                  onClick={openGoogleCalendar}
                  className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-black"
                >
                  Open Google Calendar
                </button>
              </>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {connected && events.length === 0 && (
            <div className="rounded-2xl border border-neutral-200 bg-white p-4 text-sm font-bold text-neutral-500 shadow-sm">
              No upcoming calendar events found.
            </div>
          )}

          {events.map((event) => (
            <div
              key={event.id}
              className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm"
            >
              <p className="text-lg font-black">{event.title}</p>

              <p className="mt-1 text-sm font-bold text-neutral-500">
                {event.start ? new Date(event.start).toLocaleString('en-GB') : ''}
              </p>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

type CalendarEvent = {
  id: string
  title: string
  start: string
  end: string
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function eventDateKey(value: string) {
  if (!value) return ''

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''

  return dateKey(parsed)
}

function eventTime(value: string) {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'All day'

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''

  return parsed.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function monthDays(monthDate: Date) {
  const first = startOfMonth(monthDate)
  const mondayOffset = first.getDay() === 0 ? 6 : first.getDay() - 1
  const gridStart = new Date(first)
  gridStart.setDate(first.getDate() - mondayOffset)

  return Array.from({ length: 42 }, (_, index) => {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + index)
    return d
  })
}

export default function RotaCalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [visibleMonth, setVisibleMonth] = useState(startOfMonth(new Date()))

  useEffect(() => {
    loadEvents()
  }, [])

  async function loadEvents() {
    try {
      setLoading(true)

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

  const groupedEvents = useMemo(() => {
    const grouped: Record<string, CalendarEvent[]> = {}

    for (const event of events) {
      const key = eventDateKey(event.start)
      if (!key) continue

      if (!grouped[key]) grouped[key] = []
      grouped[key].push(event)
    }

    return grouped
  }, [events])

  const days = useMemo(() => monthDays(visibleMonth), [visibleMonth])

  const monthLabel = visibleMonth.toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  })

  if (loading) {
    return (
      <main className="min-h-screen bg-neutral-100 p-4 text-neutral-950 sm:p-6">
        <div className="rounded-3xl bg-white p-6 text-sm font-bold shadow-xl">
          Loading Google Calendar...
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-neutral-100 p-3 text-neutral-950 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="rounded-3xl bg-black p-5 text-white shadow-2xl sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.25em] text-white/50">
                Google Calendar
              </p>
              <h1 className="text-3xl font-black tracking-tight">Calendar</h1>

              {connected ? (
                <p className="mt-2 text-sm font-bold text-white/70">Connected as {email}</p>
              ) : (
                <p className="mt-2 text-sm font-bold text-red-300">Google Calendar not connected</p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
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

              <a
                href="/rota"
                className="rounded-2xl bg-white/10 px-5 py-3 text-sm font-black text-white"
              >
                Back to rota
              </a>
            </div>
          </div>
        </div>

        <section className="rounded-3xl border border-neutral-200 bg-white p-3 shadow-xl sm:p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
              className="rounded-2xl bg-neutral-100 px-4 py-3 text-sm font-black text-neutral-700"
            >
              ←
            </button>

            <div className="text-center">
              <h2 className="text-2xl font-black">{monthLabel}</h2>
              <button
                type="button"
                onClick={() => setVisibleMonth(startOfMonth(new Date()))}
                className="mt-1 text-xs font-black uppercase tracking-widest text-cyan-600"
              >
                Today
              </button>
            </div>

            <button
              type="button"
              onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
              className="rounded-2xl bg-neutral-100 px-4 py-3 text-sm font-black text-neutral-700"
            >
              →
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black uppercase tracking-widest text-neutral-400 sm:text-xs">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <div key={day} className="py-2">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {days.map((day) => {
              const key = dateKey(day)
              const dayEvents = groupedEvents[key] || []
              const isThisMonth = day.getMonth() === visibleMonth.getMonth()
              const isToday = key === dateKey(new Date())

              return (
                <div
                  key={key}
                  className={`min-h-28 rounded-2xl border p-2 sm:min-h-36 ${
                    isToday
                      ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200'
                      : isThisMonth
                        ? 'border-neutral-200 bg-neutral-50'
                        : 'border-neutral-100 bg-neutral-100/60 text-neutral-300'
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span
                      className={`text-xs font-black ${
                        isToday ? 'text-emerald-700' : isThisMonth ? 'text-neutral-800' : 'text-neutral-300'
                      }`}
                    >
                      {day.getDate()}
                    </span>

                    {dayEvents.length > 0 && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black text-blue-700">
                        {dayEvents.length}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    {dayEvents.slice(0, 4).map((event) => (
                      <div
                        key={event.id}
                        className="rounded-lg bg-blue-50 px-2 py-1 text-[10px] font-black leading-tight text-blue-700"
                      >
                        <p className="truncate">{event.title || 'Busy'}</p>
                        <p className="truncate text-[9px] opacity-80">
                          {eventTime(event.start)}
                          {event.end && eventTime(event.end) !== 'All day' ? `–${eventTime(event.end)}` : ''}
                        </p>
                      </div>
                    ))}

                    {dayEvents.length > 4 && (
                      <div className="rounded-lg bg-blue-100 px-2 py-1 text-[10px] font-black text-blue-700">
                        +{dayEvents.length - 4} more
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </main>
  )
}
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
  const today = dateKey(new Date())

  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [connected, setConnected] = useState(false)
  const [visibleMonth, setVisibleMonth] = useState(startOfMonth(new Date()))

  const [title, setTitle] = useState('')
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [allDay, setAllDay] = useState(true)
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')

  const [statusMessage, setStatusMessage] = useState('')

  useEffect(() => {
    loadEvents()
  }, [])

  async function getSupabaseAccessToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    return session?.access_token || ''
  }

  async function loadEvents() {
    try {
      setLoading(true)

      const supabaseToken = await getSupabaseAccessToken()

      if (!supabaseToken) {
        setConnected(false)
        setLoading(false)
        return
      }

      const response = await fetch('/api/rota/google/events', {
        headers: {
          Authorization: `Bearer ${supabaseToken}`,
        },
      })

      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        setConnected(false)
        setEvents([])
        setEmail('')
        setStatusMessage(data?.message || 'Google Calendar not connected.')
        setLoading(false)
        return
      }

      setEvents(Array.isArray(data.events) ? data.events : [])
      setEmail(data.email || '')
      setConnected(true)
      setStatusMessage('')
    } catch (error) {
      console.error(error)
      setConnected(false)
      setStatusMessage('Could not load Google Calendar.')
    } finally {
      setLoading(false)
    }
  }

  async function createEvent() {
    try {
      setStatusMessage('')

      if (!title.trim()) {
        setStatusMessage('Enter a title first.')
        return
      }

      if (!startDate || !endDate) {
        setStatusMessage('Select a start and end date.')
        return
      }

      if (endDate < startDate) {
        setStatusMessage('End date cannot be before start date.')
        return
      }

      if (!allDay && (!startTime || !endTime)) {
        setStatusMessage('Enter start and end times.')
        return
      }

      setSaving(true)

      const supabaseToken = await getSupabaseAccessToken()

      if (!supabaseToken) {
        setStatusMessage('Log in again before saving.')
        setConnected(false)
        return
      }

      const response = await fetch('/api/rota/google/create-event', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${supabaseToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: title.trim(),
          startDate,
          endDate,
          allDay,
          startTime,
          endTime,
        }),
      })

      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not save calendar entry.')
      }

      setTitle('')
      setStartDate(today)
      setEndDate(today)
      setAllDay(true)
      setStartTime('09:00')
      setEndTime('10:00')
      setStatusMessage('Calendar entry saved.')
      await loadEvents()
    } catch (error: any) {
      console.error(error)
      setStatusMessage(error.message || 'Could not save calendar entry.')
    } finally {
      setSaving(false)
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

    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => String(a.start).localeCompare(String(b.start)))
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
                <p className="mt-2 text-sm font-bold text-red-300">
                  Google Calendar not connected
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <a
                href="/api/rota/google/connect"
                className="rounded-2xl bg-blue-500 px-5 py-3 text-sm font-black text-white"
              >
                {connected ? 'Reconnect Google' : 'Connect Google Calendar'}
              </a>

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

        <section className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-xl">
          <div className="mb-3">
            <h2 className="text-xl font-black">Add calendar entry</h2>
            <p className="text-sm font-bold text-neutral-500">
              Saves directly to Google Calendar. For one day, use the same start and end date.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px_180px_120px_140px]">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Entry title"
              className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-bold"
            />

            <input
              type="date"
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value)
                if (endDate < event.target.value) setEndDate(event.target.value)
              }}
              className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-bold"
            />

            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-bold"
            />

            <label className="flex items-center justify-center gap-2 rounded-2xl bg-neutral-100 px-4 py-3 text-sm font-black text-neutral-700">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(event) => setAllDay(event.target.checked)}
              />
              All day
            </label>

            <button
              type="button"
              onClick={createEvent}
              disabled={!connected || saving}
              className="rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-black text-black disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>

          {!allDay && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 md:w-[374px]">
              <input
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-bold"
              />

              <input
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-bold"
              />
            </div>
          )}

          {statusMessage && (
            <div className="mt-3 rounded-2xl bg-neutral-100 p-3 text-sm font-bold text-neutral-700">
              {statusMessage}
            </div>
          )}
        </section>

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
                        isToday
                          ? 'text-emerald-700'
                          : isThisMonth
                            ? 'text-neutral-800'
                            : 'text-neutral-300'
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
                          {event.end && eventTime(event.end) !== 'All day'
                            ? `–${eventTime(event.end)}`
                            : ''}
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
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

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
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
  const [deleting, setDeleting] = useState(false)
  const [connected, setConnected] = useState(false)
  const [visibleMonth, setVisibleMonth] = useState(startOfMonth(new Date()))

  const [entryOpen, setEntryOpen] = useState(false)
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

  function openAddEntry(date = today) {
    setTitle('')
    setStartDate(date)
    setEndDate(date)
    setAllDay(true)
    setStartTime('09:00')
    setEndTime('10:00')
    setEntryOpen(true)
    setStatusMessage('')
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

      setEntryOpen(false)
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

  async function deleteEvent(eventId: string) {
    const confirmed = window.confirm('Delete this Google Calendar entry?')
    if (!confirmed) return

    try {
      setDeleting(true)
      setStatusMessage('')

      const supabaseToken = await getSupabaseAccessToken()

      if (!supabaseToken) {
        setStatusMessage('Log in again before deleting.')
        setConnected(false)
        return
      }

      const response = await fetch('/api/rota/google/delete-event', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${supabaseToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ eventId }),
      })

      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not delete calendar entry.')
      }

      setStatusMessage('Calendar entry deleted.')
      await loadEvents()
    } catch (error: any) {
      console.error(error)
      setStatusMessage(error.message || 'Could not delete calendar entry.')
    } finally {
      setDeleting(false)
    }
  }

  function openGoogleCalendar() {
    window.open('https://calendar.google.com/calendar/u/0/r/month', '_blank')
  }

  const groupedEvents = useMemo(() => {
    const grouped: Record<string, CalendarEvent[]> = {}

    for (const event of events) {
      const startKey = eventDateKey(event.start)
      const endKey = eventDateKey(event.end)

      if (!startKey) continue

      const isAllDay = /^\d{4}-\d{2}-\d{2}$/.test(event.start)

      if (isAllDay && endKey && endKey !== startKey) {
        let current = parseLocalDate(startKey)
        const exclusiveEnd = parseLocalDate(endKey)

        while (current < exclusiveEnd) {
          const key = dateKey(current)
          if (!grouped[key]) grouped[key] = []
          grouped[key].push(event)
          current = addDays(current, 1)
        }
      } else {
        if (!grouped[startKey]) grouped[startKey] = []
        grouped[startKey].push(event)
      }
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
      {entryOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-3 py-16">
          <div className="w-[min(560px,94vw)] rounded-3xl bg-white p-4 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-600">
                  Google Calendar
                </p>
                <h2 className="text-2xl font-black">Add calendar entry</h2>
              </div>

              <button
                type="button"
                onClick={() => setEntryOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-sm font-black text-red-600"
              >
                ×
              </button>
            </div>

            <div className="space-y-3">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Entry title"
                className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-bold"
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs font-black text-neutral-500">
                  Start date
                  <input
                    type="date"
                    value={startDate}
                    onChange={(event) => {
                      setStartDate(event.target.value)
                      if (endDate < event.target.value) setEndDate(event.target.value)
                    }}
                    className="mt-1 w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-bold text-neutral-900"
                  />
                </label>

                <label className="text-xs font-black text-neutral-500">
                  End date
                  <input
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                    className="mt-1 w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-bold text-neutral-900"
                  />
                </label>
              </div>

              <label className="flex items-center gap-2 rounded-2xl bg-neutral-100 px-4 py-3 text-sm font-black text-neutral-700">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(event) => setAllDay(event.target.checked)}
                />
                All day
              </label>

              {!allDay && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-xs font-black text-neutral-500">
                    Start time
                    <input
                      type="time"
                      value={startTime}
                      onChange={(event) => setStartTime(event.target.value)}
                      className="mt-1 w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-bold text-neutral-900"
                    />
                  </label>

                  <label className="text-xs font-black text-neutral-500">
                    End time
                    <input
                      type="time"
                      value={endTime}
                      onChange={(event) => setEndTime(event.target.value)}
                      className="mt-1 w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-bold text-neutral-900"
                    />
                  </label>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={createEvent}
                  disabled={!connected || saving}
                  className="flex-1 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>

                <button
                  type="button"
                  onClick={() => setEntryOpen(false)}
                  className="rounded-2xl bg-neutral-100 px-5 py-3 text-sm font-black text-neutral-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
              <button
                type="button"
                onClick={() => openAddEntry()}
                disabled={!connected}
                className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-neutral-600 disabled:text-neutral-300"
              >
                Add entry
              </button>

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

          {statusMessage && (
            <div className="mt-4 rounded-2xl bg-white/10 p-3 text-sm font-bold">
              {statusMessage}
            </div>
          )}
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
                  onDoubleClick={() => connected && openAddEntry(key)}
                  className={`min-h-28 cursor-pointer rounded-2xl border p-2 sm:min-h-36 ${
                    isToday
                      ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200'
                      : isThisMonth
                        ? 'border-neutral-200 bg-neutral-50'
                        : 'border-neutral-100 bg-neutral-100/60 text-neutral-300'
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => connected && openAddEntry(key)}
                      className={`rounded-full px-2 py-0.5 text-xs font-black ${
                        isToday
                          ? 'bg-emerald-100 text-emerald-700'
                          : isThisMonth
                            ? 'text-neutral-800 hover:bg-neutral-200'
                            : 'text-neutral-300'
                      }`}
                    >
                      {day.getDate()}
                    </button>

                    {dayEvents.length > 0 && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black text-blue-700">
                        {dayEvents.length}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    {dayEvents.slice(0, 4).map((event) => (
                      <div
                        key={`${event.id}-${key}`}
                        onClick={(clickEvent) => clickEvent.stopPropagation()}
                        className="relative rounded-lg bg-blue-50 px-2 py-1 pr-6 text-[10px] font-black leading-tight text-blue-700"
                      >
                        <button
                          type="button"
                          disabled={deleting}
                          onClick={() => deleteEvent(event.id)}
                          className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-100 text-[10px] font-black text-red-600 disabled:opacity-40"
                        >
                          ×
                        </button>

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

          <p className="mt-3 text-xs font-bold text-neutral-400">
            Click the date number or double-click a day to add an entry. Press × on an entry to delete it.
          </p>
        </section>
      </div>
    </main>
  )
}

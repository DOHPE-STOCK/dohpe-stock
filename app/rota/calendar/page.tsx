'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

type CalendarEvent = {
  id: string
  title: string
  start: string
  end: string
  source?: 'google' | 'app'
}

type NewEntryForm = {
  title: string
  startDate: string
  endDate: string
  allDay: boolean
  startTime: string
  endTime: string
}

const ROTA_SETTINGS_TABLE = 'rota_settings'
const LOCAL_CALENDAR_KEY = 'dohpe_rota_calendar_settings_v1'

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

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function buildDateTime(date: string, time: string) {
  return `${date}T${time || '00:00'}:00`
}

function defaultForm(date = dateKey(new Date())): NewEntryForm {
  return {
    title: '',
    startDate: date,
    endDate: date,
    allDay: true,
    startTime: '09:00',
    endTime: '10:00',
  }
}

export default function RotaCalendarPage() {
  const [googleEvents, setGoogleEvents] = useState<CalendarEvent[]>([])
  const [manualEvents, setManualEvents] = useState<CalendarEvent[]>([])
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [visibleMonth, setVisibleMonth] = useState(startOfMonth(new Date()))
  const [calendarUserKey, setCalendarUserKey] = useState('calendar:default')
  const [calendarLoaded, setCalendarLoaded] = useState(false)
  const [entryOpen, setEntryOpen] = useState(false)
  const [entryForm, setEntryForm] = useState<NewEntryForm>(defaultForm())
  const [statusMessage, setStatusMessage] = useState('')

  useEffect(() => {
    loadCalendar()
  }, [])

  useEffect(() => {
    if (!calendarLoaded) return

    const payload = {
      manualCalendarEvents: manualEvents,
    }

    localStorage.setItem(`${LOCAL_CALENDAR_KEY}:${calendarUserKey}`, JSON.stringify(payload))

    const saveTimer = window.setTimeout(async () => {
      try {
        await supabase.from(ROTA_SETTINGS_TABLE).upsert(
          {
            user_key: calendarUserKey,
            data: payload,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_key' }
        )
      } catch (error) {
        console.error('ROTA_CALENDAR_MANUAL_SAVE_ERROR', error)
      }
    }, 500)

    return () => window.clearTimeout(saveTimer)
  }, [calendarLoaded, calendarUserKey, manualEvents])

  async function loadCalendar() {
    try {
      setLoading(true)

      const {
        data: { session },
      } = await supabase.auth.getSession()

      const key = `calendar:${session?.user?.id || 'default'}`
      setCalendarUserKey(key)

      const local = localStorage.getItem(`${LOCAL_CALENDAR_KEY}:${key}`)
      if (local) {
        const parsed = JSON.parse(local)
        if (Array.isArray(parsed.manualCalendarEvents)) {
          setManualEvents(parsed.manualCalendarEvents)
        }
      }

      const { data: savedData } = await supabase
        .from(ROTA_SETTINGS_TABLE)
        .select('data')
        .eq('user_key', key)
        .maybeSingle()

      if (Array.isArray(savedData?.data?.manualCalendarEvents)) {
        setManualEvents(savedData.data.manualCalendarEvents)
      }

      if (!session?.access_token) {
        setConnected(false)
        return
      }

      const response = await fetch('/api/rota/google/events', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })

      if (!response.ok) {
        setConnected(false)
        return
      }

      const data = await response.json()

      setGoogleEvents(
        Array.isArray(data.events)
          ? data.events.map((event: CalendarEvent) => ({
              ...event,
              source: 'google',
            }))
          : []
      )
      setEmail(data.email || '')
      setConnected(true)
    } catch (error) {
      console.error(error)
      setConnected(false)
    } finally {
      setCalendarLoaded(true)
      setLoading(false)
    }
  }

  function openGoogleCalendar() {
    window.open('https://calendar.google.com/calendar/u/0/r/month', '_blank')
  }

  function openAddEntry(date?: string) {
    setEntryForm(defaultForm(date || dateKey(new Date())))
    setEntryOpen(true)
  }

  function saveEntry() {
    const title = entryForm.title.trim()

    if (!title) {
      setStatusMessage('Enter a title before saving.')
      return
    }

    if (!entryForm.startDate || !entryForm.endDate) {
      setStatusMessage('Select a start and end date.')
      return
    }

    const startDate = parseLocalDate(entryForm.startDate)
    const endDate = parseLocalDate(entryForm.endDate)

    if (endDate < startDate) {
      setStatusMessage('End date cannot be before start date.')
      return
    }

    const entries: CalendarEvent[] = []
    let current = startDate

    while (current <= endDate) {
      const day = dateKey(current)

      entries.push({
        id: crypto.randomUUID(),
        title,
        start: entryForm.allDay ? day : buildDateTime(day, entryForm.startTime),
        end: entryForm.allDay ? day : buildDateTime(day, entryForm.endTime),
        source: 'app',
      })

      current = addDays(current, 1)
    }

    setManualEvents((currentEvents) => [...currentEvents, ...entries])
    setVisibleMonth(startOfMonth(startDate))
    setEntryOpen(false)
    setStatusMessage(entries.length > 1 ? `${entries.length} entries added.` : 'Entry added.')
  }

  function deleteManualEvent(eventId: string) {
    const confirmed = window.confirm('Delete this calendar entry?')
    if (!confirmed) return

    setManualEvents((current) => current.filter((event) => event.id !== eventId))
    setStatusMessage('Entry deleted.')
  }

  const allEvents = useMemo(() => [...googleEvents, ...manualEvents], [googleEvents, manualEvents])

  const groupedEvents = useMemo(() => {
    const grouped: Record<string, CalendarEvent[]> = {}

    for (const event of allEvents) {
      const key = eventDateKey(event.start)
      if (!key) continue

      if (!grouped[key]) grouped[key] = []
      grouped[key].push(event)
    }

    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => String(a.start).localeCompare(String(b.start)))
    }

    return grouped
  }, [allEvents])

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
          <div className="w-[min(520px,94vw)] rounded-3xl bg-white p-4 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-600">
                  Calendar entry
                </p>
                <h2 className="text-2xl font-black">Add entry</h2>
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
                value={entryForm.title}
                onChange={(event) => setEntryForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="Title"
                className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-bold"
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs font-black text-neutral-500">
                  Start date
                  <input
                    type="date"
                    value={entryForm.startDate}
                    onChange={(event) =>
                      setEntryForm((current) => ({
                        ...current,
                        startDate: event.target.value,
                        endDate: current.endDate < event.target.value ? event.target.value : current.endDate,
                      }))
                    }
                    className="mt-1 w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-bold text-neutral-900"
                  />
                </label>

                <label className="text-xs font-black text-neutral-500">
                  End date
                  <input
                    type="date"
                    value={entryForm.endDate}
                    onChange={(event) => setEntryForm((current) => ({ ...current, endDate: event.target.value }))}
                    className="mt-1 w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-bold text-neutral-900"
                  />
                </label>
              </div>

              <label className="flex items-center gap-2 rounded-2xl bg-neutral-100 px-4 py-3 text-sm font-black">
                <input
                  type="checkbox"
                  checked={entryForm.allDay}
                  onChange={(event) => setEntryForm((current) => ({ ...current, allDay: event.target.checked }))}
                />
                All day
              </label>

              {!entryForm.allDay && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-xs font-black text-neutral-500">
                    Start time
                    <input
                      type="time"
                      value={entryForm.startTime}
                      onChange={(event) => setEntryForm((current) => ({ ...current, startTime: event.target.value }))}
                      className="mt-1 w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-bold text-neutral-900"
                    />
                  </label>

                  <label className="text-xs font-black text-neutral-500">
                    End time
                    <input
                      type="time"
                      value={entryForm.endTime}
                      onChange={(event) => setEntryForm((current) => ({ ...current, endTime: event.target.value }))}
                      className="mt-1 w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-bold text-neutral-900"
                    />
                  </label>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={saveEntry}
                  className="flex-1 rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-black text-black"
                >
                  Save entry
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
                  Google Calendar not connected. App entries still work.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openAddEntry()}
                className="rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-black text-black"
              >
                Add entry
              </button>

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
                    onClick={loadCalendar}
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
                  onDoubleClick={() => openAddEntry(key)}
                  className={`min-h-28 rounded-2xl border p-2 sm:min-h-36 ${
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
                      onClick={() => openAddEntry(key)}
                      className={`rounded-full px-2 py-0.5 text-xs font-black ${
                        isToday ? 'bg-emerald-100 text-emerald-700' : isThisMonth ? 'text-neutral-800' : 'text-neutral-300'
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
                        key={event.id}
                        className={`relative rounded-lg px-2 py-1 text-[10px] font-black leading-tight ${
                          event.source === 'app'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-blue-50 text-blue-700'
                        }`}
                      >
                        {event.source === 'app' && (
                          <button
                            type="button"
                            onClick={() => deleteManualEvent(event.id)}
                            className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-100 text-[10px] font-black text-red-600"
                          >
                            ×
                          </button>
                        )}
                        <p className="truncate pr-4">{event.title || 'Busy'}</p>
                        <p className="truncate pr-4 text-[9px] opacity-80">
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

          <p className="mt-3 text-xs font-bold text-neutral-400">
            Click a date number to add an entry. Double-click a day card to add an entry for that date.
          </p>
        </section>
      </div>
    </main>
  )
}
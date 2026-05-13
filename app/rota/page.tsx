'use client'

import { useMemo, useState } from 'react'

type CompanyKey = 'dohpe' | 'dlretail'
type ShiftType = 'work' | 'holiday'

type StaffMember = {
  id: string
  name: string
  hourlyRate: number
}

type Shift = {
  id: string
  staffId: string
  type: ShiftType
  start: string
  end: string
  holidayHours: number
  note?: string
}

type CalendarEvent = {
  id: string
  title: string
  start: string
  end: string
}

type Company = {
  key: CompanyKey
  name: string
  telegramGroup: string
}

type RotaData = Record<CompanyKey, Record<string, Record<string, Shift[]>>>
type CalendarData = Record<string, CalendarEvent[]>

const companies: Company[] = [
  { key: 'dohpe', name: 'Dohpe Vintage', telegramGroup: 'Dohpe rota group' },
  { key: 'dlretail', name: 'DL Retail', telegramGroup: 'DL Retail rota group' },
]

const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const defaultStaff: StaffMember[] = [
  { id: 'staff-1', name: 'Dave', hourlyRate: 12.21 },
  { id: 'staff-2', name: 'Staff 1', hourlyRate: 12.21 },
  { id: 'staff-3', name: 'Staff 2', hourlyRate: 12.21 },
  { id: 'staff-4', name: 'Staff 3', hourlyRate: 12.21 },
]

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function startOfWeek(date: Date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function addWeeks(date: Date, weeks: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + weeks * 7)
  return d
}

function formatWeekLabel(weekStart: Date) {
  const end = addDays(weekStart, 6)
  return `${weekStart.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  })} – ${end.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  })}`
}

function timeToMinutes(value: string) {
  if (!value || !value.includes(':')) return 0
  const [h, m] = value.split(':').map(Number)
  return h * 60 + m
}

function shiftHours(shift: Shift) {
  if (shift.type === 'holiday') return Number(shift.holidayHours || 0)

  const start = timeToMinutes(shift.start)
  const end = timeToMinutes(shift.end)
  if (!start || !end || end <= start) return 0
  return (end - start) / 60
}

function workHours(shift: Shift) {
  return shift.type === 'work' ? shiftHours(shift) : 0
}

function holidayHours(shift: Shift) {
  return shift.type === 'holiday' ? shiftHours(shift) : 0
}

function money(value: number) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(value || 0)
}

function makeWorkShift(staffId: string): Shift {
  return {
    id: crypto.randomUUID(),
    staffId,
    type: 'work',
    start: '10:00',
    end: '17:00',
    holidayHours: 0,
    note: '',
  }
}

function makeHolidayShift(staffId: string): Shift {
  return {
    id: crypto.randomUUID(),
    staffId,
    type: 'holiday',
    start: '',
    end: '',
    holidayHours: 7,
    note: 'Holiday',
  }
}

export default function RotaPage() {
  const [staff, setStaff] = useState<StaffMember[]>(defaultStaff)
  const [selectedWeekStart, setSelectedWeekStart] = useState(startOfWeek(new Date()))
  const [rota, setRota] = useState<RotaData>({ dohpe: {}, dlretail: {} })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [googleCalendarSynced, setGoogleCalendarSynced] = useState(false)
  const [expandedDay, setExpandedDay] = useState<string | null>(null)

  const [calendarEvents, setCalendarEvents] = useState<CalendarData>(() => {
    const todayWeek = startOfWeek(new Date())
    return {
      [dateKey(addDays(todayWeek, 0))]: [
        { id: 'cal-1', title: 'Calendar sync preview', start: '09:30', end: '10:00' },
      ],
      [dateKey(addDays(todayWeek, 4))]: [
        { id: 'cal-2', title: 'Busy / unavailable', start: '15:00', end: '16:00' },
      ],
    }
  })

  const weekStarts = useMemo(() => {
    return [0, 1, 2, 3].map((offset) => addWeeks(selectedWeekStart, offset))
  }, [selectedWeekStart])

  function getDayShifts(company: CompanyKey, week: Date, dayIndex: number) {
    const weekId = dateKey(week)
    const dayId = dateKey(addDays(week, dayIndex))
    return rota[company]?.[weekId]?.[dayId] || []
  }

  function setDayShifts(company: CompanyKey, week: Date, dayIndex: number, shifts: Shift[]) {
    const weekId = dateKey(week)
    const dayId = dateKey(addDays(week, dayIndex))

    setRota((current) => ({
      ...current,
      [company]: {
        ...current[company],
        [weekId]: {
          ...(current[company]?.[weekId] || {}),
          [dayId]: shifts,
        },
      },
    }))
  }

  function addShift(company: CompanyKey, week: Date, dayIndex: number, type: ShiftType = 'work') {
    const current = getDayShifts(company, week, dayIndex)
    const staffId = staff[0]?.id || ''
    const shift = type === 'holiday' ? makeHolidayShift(staffId) : makeWorkShift(staffId)

    setDayShifts(company, week, dayIndex, [...current, shift])
    setExpandedDay(`${company}-${dateKey(addDays(week, dayIndex))}`)
  }

  function updateShift(
    company: CompanyKey,
    week: Date,
    dayIndex: number,
    shiftId: string,
    patch: Partial<Shift>
  ) {
    const current = getDayShifts(company, week, dayIndex)
    setDayShifts(
      company,
      week,
      dayIndex,
      current.map((shift) => (shift.id === shiftId ? { ...shift, ...patch } : shift))
    )
  }

  function deleteShift(company: CompanyKey, week: Date, dayIndex: number, shiftId: string) {
    const current = getDayShifts(company, week, dayIndex)
    setDayShifts(
      company,
      week,
      dayIndex,
      current.filter((shift) => shift.id !== shiftId)
    )
  }

  function copyWeekToNext(company: CompanyKey, week: Date) {
    const sourceWeekId = dateKey(week)
    const targetWeek = addWeeks(week, 1)
    const targetWeekId = dateKey(targetWeek)
    const source = rota[company]?.[sourceWeekId] || {}

    const copied: Record<string, Shift[]> = {}

    for (let i = 0; i < 7; i += 1) {
      const sourceDay = dateKey(addDays(week, i))
      const targetDay = dateKey(addDays(targetWeek, i))

      copied[targetDay] = (source[sourceDay] || []).map((shift) => ({
        ...shift,
        id: crypto.randomUUID(),
      }))
    }

    setRota((current) => ({
      ...current,
      [company]: {
        ...current[company],
        [targetWeekId]: copied,
      },
    }))

    setStatusMessage(`${companies.find((c) => c.key === company)?.name} copied to next week.`)
  }

  function loadDefaultWeek(company: CompanyKey, week: Date) {
    const weekId = dateKey(week)
    const template: Record<string, Shift[]> = {}

    for (let i = 0; i < 7; i += 1) {
      const day = dateKey(addDays(week, i))
      template[day] =
        i < 5
          ? [
              {
                id: crypto.randomUUID(),
                staffId: staff[0]?.id || '',
                type: 'work',
                start: '10:00',
                end: '17:00',
                holidayHours: 0,
                note: '',
              },
            ]
          : []
    }

    setRota((current) => ({
      ...current,
      [company]: {
        ...current[company],
        [weekId]: template,
      },
    }))

    setStatusMessage(`Default rota loaded for ${companies.find((c) => c.key === company)?.name}.`)
  }

  function totalsForCompanyWeek(company: CompanyKey, week: Date) {
    const totals: Record<
      string,
      { workHours: number; holidayHours: number; workWage: number; holidayWage: number }
    > = {}

    for (const person of staff) {
      totals[person.id] = {
        workHours: 0,
        holidayHours: 0,
        workWage: 0,
        holidayWage: 0,
      }
    }

    for (let i = 0; i < 7; i += 1) {
      for (const shift of getDayShifts(company, week, i)) {
        const person = staff.find((x) => x.id === shift.staffId)
        const hours = shiftHours(shift)
        const wage = hours * Number(person?.hourlyRate || 0)

        if (!totals[shift.staffId]) {
          totals[shift.staffId] = {
            workHours: 0,
            holidayHours: 0,
            workWage: 0,
            holidayWage: 0,
          }
        }

        if (shift.type === 'holiday') {
          totals[shift.staffId].holidayHours += hours
          totals[shift.staffId].holidayWage += wage
        } else {
          totals[shift.staffId].workHours += hours
          totals[shift.staffId].workWage += wage
        }
      }
    }

    return totals
  }

  function companyWeekTotal(company: CompanyKey, week: Date) {
    const totals = totalsForCompanyWeek(company, week)
    return Object.values(totals).reduce(
      (sum, row) => ({
        workHours: sum.workHours + row.workHours,
        holidayHours: sum.holidayHours + row.holidayHours,
        wage: sum.wage + row.workWage + row.holidayWage,
      }),
      { workHours: 0, holidayHours: 0, wage: 0 }
    )
  }

  function syncGoogleCalendar() {
    setGoogleCalendarSynced(true)

    const week = startOfWeek(new Date())
    const demoEvents: CalendarData = {}

    for (let i = 0; i < 28; i += 1) {
      const day = addDays(week, i)
      const key = dateKey(day)

      if (i % 6 === 0) {
        demoEvents[key] = [
          {
            id: crypto.randomUUID(),
            title: 'Synced calendar event',
            start: '09:00',
            end: '10:00',
          },
        ]
      }

      if (i % 9 === 0) {
        demoEvents[key] = [
          ...(demoEvents[key] || []),
          {
            id: crypto.randomUUID(),
            title: 'Unavailable',
            start: '14:00',
            end: '15:30',
          },
        ]
      }
    }

    setCalendarEvents(demoEvents)
    setStatusMessage('Google Calendar synced for logged-in user. Real API sync can refresh every 15–30 minutes later.')
  }

  function sendTelegram(company: CompanyKey, week: Date) {
    const companyName = companies.find((c) => c.key === company)?.name

    const rotaLines: string[] = []

    for (let i = 0; i < 7; i += 1) {
      const day = addDays(week, i)
      const shifts = getDayShifts(company, week, i)

      rotaLines.push(`${dayNames[i]} ${day.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`)

      if (shifts.length === 0) {
        rotaLines.push('Closed / no shifts')
      } else {
        for (const shift of shifts) {
          const person = staff.find((x) => x.id === shift.staffId)
          if (shift.type === 'holiday') {
            rotaLines.push(`🌴 ${person?.name || 'Staff'} holiday (${shift.holidayHours} hrs)`)
          } else {
            rotaLines.push(`${person?.name || 'Staff'} ${shift.start}–${shift.end}`)
          }
        }
      }

      rotaLines.push('')
    }

    console.log(`Telegram preview for ${companyName}`, rotaLines.join('\n'))
    setStatusMessage(`Telegram placeholder: ${companyName} rota only would be sent. Weekly totals are excluded.`)
  }

  function addStaffMember() {
    setStaff((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: `Staff ${current.length + 1}`,
        hourlyRate: 12.21,
      },
    ])
  }

  function updateStaff(id: string, patch: Partial<StaffMember>) {
    setStaff((current) =>
      current.map((person) => (person.id === id ? { ...person, ...patch } : person))
    )
  }

  function deleteStaff(id: string) {
    setStaff((current) => current.filter((person) => person.id !== id))
  }

  function WeekPlanner({ company, week, compact = false }: { company: Company; week: Date; compact?: boolean }) {
    const total = companyWeekTotal(company.key, week)
    const staffTotals = totalsForCompanyWeek(company.key, week)

    return (
      <section className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-xl">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-neutral-400">
              {company.name}
            </p>
            <h2 className="text-xl font-black">{formatWeekLabel(week)}</h2>
            <p className="text-sm font-semibold text-neutral-500">
              {total.workHours.toFixed(2)} work hrs · {total.holidayHours.toFixed(2)} hol hrs · {money(total.wage)}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => loadDefaultWeek(company.key, week)}
              className="rounded-xl bg-neutral-100 px-3 py-2 text-xs font-black hover:bg-neutral-200"
            >
              Load default
            </button>
            <button
              type="button"
              onClick={() => copyWeekToNext(company.key, week)}
              className="rounded-xl bg-black px-3 py-2 text-xs font-black text-white"
            >
              Copy week
            </button>
            <button
              type="button"
              onClick={() => sendTelegram(company.key, week)}
              className="rounded-xl bg-sky-500 px-3 py-2 text-xs font-black text-white"
            >
              Telegram
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
          {dayNames.map((day, dayIndex) => {
            const actualDate = addDays(week, dayIndex)
            const dayId = dateKey(actualDate)
            const expandKey = `${company.key}-${dayId}`
            const isExpanded = expandedDay === expandKey
            const shifts = getDayShifts(company.key, week, dayIndex)
            const events = calendarEvents[dayId] || []

            return (
              <div
                key={day}
                onMouseEnter={() => setExpandedDay(expandKey)}
                onClick={() => setExpandedDay(isExpanded ? null : expandKey)}
                className={`rounded-2xl border border-neutral-200 bg-neutral-50 p-2 transition-all ${
                  isExpanded ? 'md:col-span-2 min-h-80 ring-2 ring-black/10' : 'min-h-44'
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-black">{day}</p>
                    <p className="text-xs font-bold text-neutral-400">
                      {actualDate.toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                      })}
                    </p>
                  </div>

                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        addShift(company.key, week, dayIndex, 'work')
                      }}
                      className="rounded-full bg-black px-2 py-1 text-xs font-black text-white"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        addShift(company.key, week, dayIndex, 'holiday')
                      }}
                      className="rounded-full bg-amber-300 px-2 py-1 text-xs font-black text-black"
                    >
                      🌴
                    </button>
                  </div>
                </div>

                {googleCalendarSynced && (
                  <div className="mb-2 rounded-xl bg-blue-50 p-2">
                    <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-blue-500">
                      Google Calendar
                    </p>
                    {events.length === 0 ? (
                      <p className="text-xs font-bold text-blue-300">No synced events</p>
                    ) : (
                      <div className="space-y-1">
                        {events.map((event) => (
                          <div key={event.id} className="rounded-lg bg-white px-2 py-1 text-xs font-bold text-blue-700">
                            {event.start}–{event.end} · {event.title}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  {shifts.length === 0 ? (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          addShift(company.key, week, dayIndex, 'work')
                        }}
                        className="rounded-xl border border-dashed border-neutral-300 p-3 text-xs font-bold text-neutral-400"
                      >
                        Add shift
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          addShift(company.key, week, dayIndex, 'holiday')
                        }}
                        className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-3 text-xs font-bold text-amber-600"
                      >
                        Holiday
                      </button>
                    </div>
                  ) : (
                    shifts.map((shift) => {
                      const person = staff.find((x) => x.id === shift.staffId)
                      const hours = shiftHours(shift)

                      return (
                        <div
                          key={shift.id}
                          onClick={(event) => event.stopPropagation()}
                          className={`rounded-xl border p-2 shadow-sm ${
                            shift.type === 'holiday'
                              ? 'border-amber-200 bg-amber-50'
                              : 'border-neutral-200 bg-white'
                          }`}
                        >
                          <div className="mb-2 flex items-center gap-2">
                            <select
                              value={shift.staffId}
                              onChange={(event) =>
                                updateShift(company.key, week, dayIndex, shift.id, {
                                  staffId: event.target.value,
                                })
                              }
                              className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-2 py-2 text-xs font-bold"
                            >
                              {staff.map((person) => (
                                <option key={person.id} value={person.id}>
                                  {person.name}
                                </option>
                              ))}
                            </select>

                            <select
                              value={shift.type}
                              onChange={(event) =>
                                updateShift(company.key, week, dayIndex, shift.id, {
                                  type: event.target.value as ShiftType,
                                  holidayHours: event.target.value === 'holiday' ? 7 : 0,
                                  start: event.target.value === 'holiday' ? '' : shift.start || '10:00',
                                  end: event.target.value === 'holiday' ? '' : shift.end || '17:00',
                                })
                              }
                              className="w-24 rounded-lg border border-neutral-200 px-2 py-2 text-xs font-bold"
                            >
                              <option value="work">Work</option>
                              <option value="holiday">🌴 Holiday</option>
                            </select>
                          </div>

                          {shift.type === 'holiday' ? (
                            <div className="rounded-xl bg-amber-100 p-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-lg">🌴☀️🏖️</span>
                                <input
                                  type="number"
                                  value={shift.holidayHours}
                                  onChange={(event) =>
                                    updateShift(company.key, week, dayIndex, shift.id, {
                                      holidayHours: Number(event.target.value),
                                    })
                                  }
                                  className="w-20 rounded-lg border border-amber-200 px-2 py-2 text-xs font-black"
                                />
                              </div>
                              <p className="mt-1 text-xs font-black text-amber-700">
                                Holiday · {hours.toFixed(2)} hrs · {money(hours * Number(person?.hourlyRate || 0))}
                              </p>
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                type="time"
                                value={shift.start}
                                onChange={(event) =>
                                  updateShift(company.key, week, dayIndex, shift.id, {
                                    start: event.target.value,
                                  })
                                }
                                className="rounded-lg border border-neutral-200 px-2 py-2 text-xs font-bold"
                              />
                              <input
                                type="time"
                                value={shift.end}
                                onChange={(event) =>
                                  updateShift(company.key, week, dayIndex, shift.id, {
                                    end: event.target.value,
                                  })
                                }
                                className="rounded-lg border border-neutral-200 px-2 py-2 text-xs font-bold"
                              />
                            </div>
                          )}

                          <input
                            value={shift.note || ''}
                            onChange={(event) =>
                              updateShift(company.key, week, dayIndex, shift.id, {
                                note: event.target.value,
                              })
                            }
                            placeholder="Note"
                            className="mt-2 w-full rounded-lg border border-neutral-200 px-2 py-2 text-xs"
                          />

                          <div className="mt-2 flex items-center justify-between text-xs">
                            <span className="font-black text-neutral-500">
                              {hours.toFixed(2)} hrs · {money(hours * Number(person?.hourlyRate || 0))}
                            </span>
                            <button
                              type="button"
                              onClick={() => deleteShift(company.key, week, dayIndex, shift.id)}
                              className="font-black text-red-500"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-4 rounded-2xl bg-neutral-950 p-3 text-white">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-black">Weekly totals</p>
            <p className="text-sm font-black">
              {total.workHours.toFixed(2)} work · {total.holidayHours.toFixed(2)} hol · {money(total.wage)}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {staff.map((person) => {
              const row = staffTotals[person.id] || {
                workHours: 0,
                holidayHours: 0,
                workWage: 0,
                holidayWage: 0,
              }

              return (
                <div
                  key={person.id}
                  className="rounded-xl bg-white/10 p-2 text-xs font-bold"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>{person.name}</span>
                    <span>{(row.workHours + row.holidayHours).toFixed(2)} hrs</span>
                  </div>

                  <div className="mt-1 grid grid-cols-2 gap-1 text-white/60">
                    <span>Work {row.workHours.toFixed(2)}h</span>
                    <span className="text-right">{money(row.workWage)}</span>
                    <span>🌴 Hol {row.holidayHours.toFixed(2)}h</span>
                    <span className="text-right">{money(row.holidayWage)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>
    )
  }

  return (
    <main className="min-h-screen bg-neutral-100 text-neutral-950">
      <div className="mx-auto max-w-[1900px] space-y-5 p-4">
        <header className="rounded-3xl bg-black p-5 text-white shadow-2xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.25em] text-white/50">
                Staff rota
              </p>
              <h1 className="text-3xl font-black tracking-tight">
                Weekly Planner
              </h1>
              <p className="mt-1 text-sm font-semibold text-white/60">
                Two-company rota · 4-week view · staff hours · holiday hours · wage totals
              </p>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={syncGoogleCalendar}
                className={`rounded-2xl px-4 py-3 text-sm font-black ${
                  googleCalendarSynced
                    ? 'bg-white text-black'
                    : 'bg-blue-500 text-white'
                }`}
              >
                {googleCalendarSynced ? 'Google Calendar ✓' : 'Sync Google Calendar'}
              </button>
              <button
                type="button"
                onClick={() => setSelectedWeekStart(addWeeks(selectedWeekStart, -1))}
                className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-black hover:bg-white/20"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setSelectedWeekStart(startOfWeek(new Date()))}
                className="rounded-2xl bg-white px-4 py-3 text-sm font-black text-black"
              >
                Current
              </button>
              <button
                type="button"
                onClick={() => setSelectedWeekStart(addWeeks(selectedWeekStart, 1))}
                className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-black hover:bg-white/20"
              >
                Next
              </button>
              <button
                type="button"
                onClick={() => setSettingsOpen((value) => !value)}
                className="rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-black text-black"
              >
                Staff settings
              </button>
            </div>
          </div>

          {statusMessage && (
            <div className="mt-4 rounded-2xl bg-white/10 p-3 text-sm font-bold">
              {statusMessage}
            </div>
          )}
        </header>

        {settingsOpen && (
          <section className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black">Rota staff</h2>
                <p className="text-sm font-semibold text-neutral-500">
                  Edit staff names and hourly rates. Google Calendar sync is only for the logged-in user.
                </p>
              </div>

              <button
                type="button"
                onClick={addStaffMember}
                className="rounded-2xl bg-black px-4 py-3 text-sm font-black text-white"
              >
                Add staff
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {staff.map((person) => (
                <div
                  key={person.id}
                  className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3"
                >
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={person.name}
                      onChange={(event) => updateStaff(person.id, { name: event.target.value })}
                      className="rounded-xl border border-neutral-200 px-3 py-2 text-sm font-bold"
                    />
                    <input
                      type="number"
                      value={person.hourlyRate}
                      onChange={(event) =>
                        updateStaff(person.id, { hourlyRate: Number(event.target.value) })
                      }
                      className="rounded-xl border border-neutral-200 px-3 py-2 text-sm font-bold"
                    />
                  </div>

                  <div className="mt-3 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => deleteStaff(person.id)}
                      className="rounded-xl bg-red-100 px-3 py-2 text-xs font-black text-red-600"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {companies.map((company) => (
            <WeekPlanner
              key={`${company.key}-${dateKey(selectedWeekStart)}`}
              company={company}
              week={selectedWeekStart}
            />
          ))}
        </section>

        <section className="space-y-5">
          <h2 className="px-1 text-xl font-black">Current + next 3 weeks</h2>

          {weekStarts.map((week) => (
            <div key={dateKey(week)} className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              {companies.map((company) => (
                <WeekPlanner
                  key={`${company.key}-${dateKey(week)}-future`}
                  company={company}
                  week={week}
                  compact
                />
              ))}
            </div>
          ))}
        </section>
      </div>
    </main>
  )
}
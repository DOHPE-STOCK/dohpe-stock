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
type DefaultRota = Record<CompanyKey, Record<string, Shift[]>>
type EditedWeeks = Record<CompanyKey, Record<string, boolean>>
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

function money(value: number) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(value || 0)
}

function cloneShift(shift: Shift): Shift {
  return {
    ...shift,
    id: crypto.randomUUID(),
  }
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

function emptyDefault(): DefaultRota {
  return { dohpe: {}, dlretail: {} }
}

export default function RotaPage() {
  const [staff, setStaff] = useState<StaffMember[]>(defaultStaff)
  const [selectedWeekStart, setSelectedWeekStart] = useState(startOfWeek(new Date()))
  const [rota, setRota] = useState<RotaData>({ dohpe: {}, dlretail: {} })
  const [defaultRota, setDefaultRota] = useState<DefaultRota>(emptyDefault())
  const [editedWeeks, setEditedWeeks] = useState<EditedWeeks>({ dohpe: {}, dlretail: {} })
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

  const futureWeekStarts = useMemo(() => {
    return [1, 2, 3].map((offset) => addWeeks(selectedWeekStart, offset))
  }, [selectedWeekStart])

  function getDayId(week: Date, dayIndex: number) {
    return dateKey(addDays(week, dayIndex))
  }

  function getWeekId(week: Date) {
    return dateKey(week)
  }

  function getDayShifts(company: CompanyKey, week: Date, dayIndex: number) {
    const weekId = getWeekId(week)
    const dayId = getDayId(week, dayIndex)
    return rota[company]?.[weekId]?.[dayId] || []
  }

  function markWeekEdited(company: CompanyKey, week: Date) {
    const weekId = getWeekId(week)

    setEditedWeeks((current) => ({
      ...current,
      [company]: {
        ...current[company],
        [weekId]: true,
      },
    }))
  }

  function setDayShifts(
    company: CompanyKey,
    week: Date,
    dayIndex: number,
    shifts: Shift[],
    markEdited = true
  ) {
    const weekId = getWeekId(week)
    const dayId = getDayId(week, dayIndex)

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

    if (markEdited) markWeekEdited(company, week)
  }

  function addShift(company: CompanyKey, week: Date, dayIndex: number, type: ShiftType) {
    const current = getDayShifts(company, week, dayIndex)
    const staffId = staff[0]?.id || ''
    const shift = type === 'holiday' ? makeHolidayShift(staffId) : makeWorkShift(staffId)

    setDayShifts(company, week, dayIndex, [...current, shift])
    setExpandedDay(`${company}-${getDayId(week, dayIndex)}`)
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

  function applyDefaultToWeek(company: CompanyKey, week: Date, template: Record<string, Shift[]>) {
    const weekId = getWeekId(week)
    const copied: Record<string, Shift[]> = {}

    for (let i = 0; i < 7; i += 1) {
      const sourceKey = String(i)
      const targetDay = getDayId(week, i)

      copied[targetDay] = (template[sourceKey] || []).map(cloneShift)
    }

    setRota((current) => ({
      ...current,
      [company]: {
        ...current[company],
        [weekId]: copied,
      },
    }))
  }

  function setWeekAsDefault(company: CompanyKey, week: Date) {
    const weekId = getWeekId(week)
    const weekRows = rota[company]?.[weekId] || {}

    const template: Record<string, Shift[]> = {}

    for (let i = 0; i < 7; i += 1) {
      template[String(i)] = (weekRows[getDayId(week, i)] || []).map(cloneShift)
    }

    const futureWeeks = [1, 2, 3].map((offset) => addWeeks(week, offset))
    const editedFutureWeeks = futureWeeks.filter(
      (futureWeek) => editedWeeks[company]?.[getWeekId(futureWeek)]
    )

    if (editedFutureWeeks.length > 0) {
      const confirmed = window.confirm(
        'Some future weeks have been edited differently. Setting this as default will overwrite those calendar entries. Continue?'
      )

      if (!confirmed) return
    }

    setDefaultRota((current) => ({
      ...current,
      [company]: template,
    }))

    for (const futureWeek of futureWeeks) {
      applyDefaultToWeek(company, futureWeek, template)
    }

    setEditedWeeks((current) => {
      const next = { ...current, [company]: { ...current[company] } }

      for (const futureWeek of futureWeeks) {
        delete next[company][getWeekId(futureWeek)]
      }

      return next
    })

    setStatusMessage(
      `${companies.find((c) => c.key === company)?.name} default rota set and applied to next 3 weeks.`
    )
  }

  function copyWeekToNext(company: CompanyKey, week: Date) {
    const sourceWeekId = getWeekId(week)
    const targetWeek = addWeeks(week, 1)
    const targetWeekId = getWeekId(targetWeek)
    const source = rota[company]?.[sourceWeekId] || {}

    const copied: Record<string, Shift[]> = {}

    for (let i = 0; i < 7; i += 1) {
      const sourceDay = getDayId(week, i)
      const targetDay = getDayId(targetWeek, i)

      copied[targetDay] = (source[sourceDay] || []).map(cloneShift)
    }

    setRota((current) => ({
      ...current,
      [company]: {
        ...current[company],
        [targetWeekId]: copied,
      },
    }))

    markWeekEdited(company, targetWeek)
    setStatusMessage(`${companies.find((c) => c.key === company)?.name} copied to next week.`)
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
    setStatusMessage(
      'Google Calendar synced for logged-in user. Real API sync can refresh every 15–30 minutes later.'
    )
  }

  function openMonthlyCalendar() {
    setStatusMessage('Monthly Google Calendar placeholder. This can open a full month calendar modal later.')
  }

  function saveStaffSettings() {
    setSettingsOpen(false)
    setStatusMessage('Staff settings saved.')
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
            rotaLines.push(`HOLS ${person?.name || 'Staff'}`)
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

  function ShiftEditor({
    company,
    week,
    dayIndex,
    shift,
  }: {
    company: CompanyKey
    week: Date
    dayIndex: number
    shift: Shift
  }) {
    const person = staff.find((x) => x.id === shift.staffId)
    const hours = shiftHours(shift)

    return (
      <div
        className={`relative rounded-xl border p-2 pr-9 shadow-sm ${
          shift.type === 'holiday' ? 'border-amber-200 bg-amber-50' : 'border-neutral-200 bg-white'
        }`}
      >
        <button
          type="button"
          onClick={() => deleteShift(company, week, dayIndex, shift.id)}
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-xs font-black text-red-600"
        >
          ×
        </button>

        <div className="mb-2 flex items-center gap-2">
          <select
            value={shift.staffId}
            onChange={(event) =>
              updateShift(company, week, dayIndex, shift.id, {
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

          <div className="flex shrink-0 overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <span
              className={`px-2 py-2 text-xs font-black ${
                shift.type === 'work' ? 'bg-black text-white' : 'bg-neutral-100 text-neutral-300'
              }`}
            >
              Shift
            </span>
            <span
              className={`px-2 py-2 text-xs font-black ${
                shift.type === 'holiday' ? 'bg-amber-300 text-black' : 'bg-neutral-100 text-neutral-300'
              }`}
            >
              HOLS
            </span>
          </div>
        </div>

        {shift.type === 'holiday' ? (
          <div className="rounded-xl bg-amber-100 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-black text-amber-700">HOLS</span>
              <input
                type="number"
                value={shift.holidayHours}
                onChange={(event) =>
                  updateShift(company, week, dayIndex, shift.id, {
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
                updateShift(company, week, dayIndex, shift.id, {
                  start: event.target.value,
                })
              }
              className="rounded-lg border border-neutral-200 px-2 py-2 text-xs font-bold"
            />
            <input
              type="time"
              value={shift.end}
              onChange={(event) =>
                updateShift(company, week, dayIndex, shift.id, {
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
            updateShift(company, week, dayIndex, shift.id, {
              note: event.target.value,
            })
          }
          placeholder="Note"
          className="mt-2 w-full rounded-lg border border-neutral-200 px-2 py-2 text-xs"
        />

        <div className="mt-2 text-xs">
          <span className="font-black text-neutral-500">
            {hours.toFixed(2)} hrs · {money(hours * Number(person?.hourlyRate || 0))}
          </span>
        </div>
      </div>
    )
  }

  function DayCard({
    company,
    week,
    dayIndex,
  }: {
    company: CompanyKey
    week: Date
    dayIndex: number
  }) {
    const actualDate = addDays(week, dayIndex)
    const dayId = dateKey(actualDate)
    const expandKey = `${company}-${dayId}`
    const isExpanded = expandedDay === expandKey
    const shifts = getDayShifts(company, week, dayIndex)
    const events = calendarEvents[dayId] || []

    return (
      <div
        className="relative min-h-44 rounded-2xl border border-neutral-200 bg-neutral-50 p-2"
        onMouseEnter={() => setExpandedDay(expandKey)}
      >
        <div className="mb-2 flex items-center justify-between">
          <div>
            <p className="text-sm font-black">{dayNames[dayIndex]}</p>
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
                addShift(company, week, dayIndex, 'work')
              }}
              className="rounded-full bg-black px-2 py-1 text-xs font-black text-white"
            >
              +
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                addShift(company, week, dayIndex, 'holiday')
              }}
              className="rounded-full bg-amber-300 px-2 py-1 text-[10px] font-black text-black"
            >
              H
            </button>
          </div>
        </div>

        <div className="space-y-1">
          {shifts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-300 p-3 text-center text-xs font-bold text-neutral-400">
              No rota entries
            </p>
          ) : (
            shifts.slice(0, 5).map((shift) => {
              const person = staff.find((x) => x.id === shift.staffId)
              return (
                <div
                  key={shift.id}
                  className={`flex min-h-7 items-center rounded-lg px-2 py-1 text-[11px] font-black leading-tight ${
                    shift.type === 'holiday' ? 'bg-amber-100 text-amber-700' : 'bg-white text-neutral-800'
                  }`}
                >
                  <span className="w-full truncate">
                    {shift.type === 'holiday'
                      ? `HOLS ${person?.name || 'Staff'}`
                      : `${person?.name || 'Staff'} ${shift.start}–${shift.end}`}
                  </span>
                </div>
              )
            })
          )}

          {shifts.length > 5 && (
            <p className="text-xs font-black text-neutral-400">+{shifts.length - 5} more</p>
          )}
        </div>

        {isExpanded && (
          <div
            onMouseLeave={() => setExpandedDay(null)}
            className="absolute left-0 top-0 z-50 w-[min(440px,90vw)] rounded-3xl border border-neutral-300 bg-white p-3 shadow-2xl"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-black">{dayNames[dayIndex]}</p>
                <p className="text-sm font-bold text-neutral-500">
                  {actualDate.toLocaleDateString('en-GB', {
                    weekday: 'long',
                    day: '2-digit',
                    month: 'long',
                  })}
                </p>
              </div>

              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => addShift(company, week, dayIndex, 'work')}
                  className="rounded-full bg-black px-3 py-2 text-xs font-black text-white"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => addShift(company, week, dayIndex, 'holiday')}
                  className="rounded-full bg-amber-300 px-3 py-2 text-xs font-black text-black"
                >
                  HOLS
                </button>
              </div>
            </div>

            <div className="mb-3 rounded-2xl bg-blue-50 p-3">
              <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-blue-500">
                Google Calendar
              </p>

              {!googleCalendarSynced ? (
                <p className="text-xs font-bold text-blue-400">
                  Calendar entries will be displayed here once Google Calendar is synced.
                </p>
              ) : events.length === 0 ? (
                <p className="text-xs font-bold text-blue-400">
                  Calendar entries will be displayed here.
                </p>
              ) : (
                <div className="space-y-1">
                  {events.map((event) => (
                    <div
                      key={event.id}
                      className="rounded-lg bg-white px-2 py-1 text-xs font-bold text-blue-700"
                    >
                      {event.start}–{event.end} · {event.title}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="max-h-[65vh] space-y-2 overflow-auto pr-1">
              {shifts.length === 0 ? (
                <p className="rounded-2xl bg-neutral-100 p-4 text-center text-sm font-bold text-neutral-400">
                  No shifts or holidays added yet.
                </p>
              ) : (
                shifts.map((shift) => (
                  <ShiftEditor
                    key={shift.id}
                    company={company}
                    week={week}
                    dayIndex={dayIndex}
                    shift={shift}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  function WeekPlanner({ company, week }: { company: Company; week: Date }) {
    const total = companyWeekTotal(company.key, week)
    const staffTotals = totalsForCompanyWeek(company.key, week)
    const isEdited = editedWeeks[company.key]?.[getWeekId(week)]

    return (
      <section className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-xl">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-neutral-400">
              {company.name}
            </p>
            <h2 className="text-xl font-black">{formatWeekLabel(week)}</h2>
            <p className="text-sm font-semibold text-neutral-500">
              {total.workHours.toFixed(2)} work hrs · {total.holidayHours.toFixed(2)} hols hrs · {money(total.wage)}
              {isEdited ? ' · edited' : ''}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setWeekAsDefault(company.key, week)}
              className="rounded-xl bg-emerald-400 px-3 py-2 text-xs font-black text-black"
            >
              Set default
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
          {dayNames.map((_, dayIndex) => (
            <DayCard
              key={`${company.key}-${getDayId(week, dayIndex)}`}
              company={company.key}
              week={week}
              dayIndex={dayIndex}
            />
          ))}
        </div>

        <div className="mt-4 rounded-2xl bg-neutral-950 p-3 text-white">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-black">Weekly totals</p>
            <p className="text-sm font-black">
              {total.workHours.toFixed(2)} work · {total.holidayHours.toFixed(2)} hols · {money(total.wage)}
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
                <div key={person.id} className="rounded-xl bg-white/10 p-2 text-xs font-bold">
                  <div className="flex items-center justify-between gap-2">
                    <span>{person.name}</span>
                    <span>{(row.workHours + row.holidayHours).toFixed(2)} hrs</span>
                  </div>

                  <div className="mt-1 grid grid-cols-2 gap-1 text-white/60">
                    <span>Work {row.workHours.toFixed(2)}h</span>
                    <span className="text-right">{money(row.workWage)}</span>
                    <span>Hols {row.holidayHours.toFixed(2)}h</span>
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
              <h1 className="text-3xl font-black tracking-tight">Weekly Planner</h1>
              <p className="mt-1 text-sm font-semibold text-white/60">
                Two-company rota · current week + next 3 weeks · staff hours · holiday hours · wage totals
              </p>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={openMonthlyCalendar}
                className="rounded-2xl bg-purple-500 px-4 py-3 text-sm font-black text-white"
              >
                Calendar
              </button>
              <button
                type="button"
                onClick={syncGoogleCalendar}
                className={`rounded-2xl px-4 py-3 text-sm font-black ${
                  googleCalendarSynced ? 'bg-white text-black' : 'bg-blue-500 text-white'
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
                {settingsOpen ? 'Close settings' : 'Staff settings'}
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
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-black">Rota staff</h2>
                <p className="text-sm font-semibold text-neutral-500">
                  Edit staff names and hourly rates. Google Calendar sync is only for the logged-in user.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={addStaffMember}
                  className="rounded-2xl bg-black px-4 py-3 text-sm font-black text-white"
                >
                  Add staff
                </button>
                <button
                  type="button"
                  onClick={saveStaffSettings}
                  className="rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-black text-black"
                >
                  Save
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {staff.map((person) => (
                <div key={person.id} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
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
          <h2 className="px-1 text-xl font-black">Next 3 weeks</h2>

          {futureWeekStarts.map((week) => (
            <div key={dateKey(week)} className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              {companies.map((company) => (
                <WeekPlanner
                  key={`${company.key}-${dateKey(week)}-future`}
                  company={company}
                  week={week}
                />
              ))}
            </div>
          ))}
        </section>
      </div>
    </main>
  )
}
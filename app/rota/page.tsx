'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

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
  saved?: boolean
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
  logoUrl?: string
}

type WeeklyReport = {
  id: string
  company: CompanyKey
  weekId: string
  companyName: string
  staffTotals: Record<
    string,
    {
      name: string
      workHours: number
      holidayHours: number
      workWage: number
      holidayWage: number
    }
  >
  createdAt: string
}

type RotaData = Record<CompanyKey, Record<string, Record<string, Shift[]>>>
type DefaultRota = Record<CompanyKey, Record<string, Shift[]>>
type EditedWeeks = Record<CompanyKey, Record<string, boolean>>
type CalendarData = Record<string, CalendarEvent[]>

const ROTA_SETTINGS_TABLE = 'rota_settings'
const LOCAL_ROTA_KEY = 'dohpe_rota_settings_v1'
const HOVER_DELAY_MS = 400

const defaultCompanies: Company[] = [
  { key: 'dohpe', name: 'Dohpe Vintage', telegramGroup: 'Dohpe rota group', logoUrl: '' },
  { key: 'dlretail', name: 'DL Retail', telegramGroup: 'DL Retail rota group', logoUrl: '' },
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

function formatHours(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
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
    saved: true,
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
    saved: false,
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
    saved: false,
  }
}

function emptyDefault(): DefaultRota {
  return { dohpe: {}, dlretail: {} }
}

function safeSaved(shift: Shift) {
  return shift.saved !== false
}

function GoogleLogo() {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-black text-blue-600 sm:h-6 sm:w-6 sm:text-sm">
      G
    </span>
  )
}

function CalendarIcon() {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white text-[9px] font-black text-purple-600 sm:h-6 sm:w-6 sm:text-xs">
      Cal
    </span>
  )
}

function SettingsIcon() {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white text-[9px] font-black text-emerald-700 sm:h-6 sm:w-6 sm:text-xs">
      Cal
    </span>
  )
}

function CompanyLogo({ company }: { company: Company }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-200 text-[10px] font-black text-neutral-600">
      {company.logoUrl ? (
        <img src={company.logoUrl} alt={company.name} className="h-full w-full object-cover" />
      ) : (
        company.name.slice(0, 1).toUpperCase()
      )}
    </span>
  )
}

export default function RotaPage() {
  const hoverTimerRef = useRef<number | null>(null)
  const saveTimerRef = useRef<number | null>(null)

  const [companies, setCompanies] = useState<Company[]>(defaultCompanies)
  const [mobileCompany, setMobileCompany] = useState<CompanyKey>('dohpe')
  const [staff, setStaff] = useState<StaffMember[]>(defaultStaff)
  const [currentWeekStart] = useState(startOfWeek(new Date()))
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [rota, setRota] = useState<RotaData>({ dohpe: {}, dlretail: {} })
  const [defaultRota, setDefaultRota] = useState<DefaultRota>(emptyDefault())
  const [editedWeeks, setEditedWeeks] = useState<EditedWeeks>({ dohpe: {}, dlretail: {} })
  const [weeklyReports, setWeeklyReports] = useState<WeeklyReport[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [googleCalendarSynced, setGoogleCalendarSynced] = useState(false)
  const [expandedDay, setExpandedDay] = useState<string | null>(null)
  const [cloudUserKey, setCloudUserKey] = useState('default')
  const [cloudLoaded, setCloudLoaded] = useState(false)

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
    return [1, 2, 3, 4].map((offset) => addWeeks(currentWeekStart, offset))
  }, [currentWeekStart])

  const mobileCompanyList = companies.filter((company) => company.key === mobileCompany)

  const filteredReports = useMemo(() => {
    const q = historySearch.trim().toLowerCase()
    if (!q) return weeklyReports.slice(0, 20)

    return weeklyReports
      .filter((report) => {
        const staffNames = Object.values(report.staffTotals)
          .map((row) => row.name)
          .join(' ')
          .toLowerCase()

        return (
          report.weekId.toLowerCase().includes(q) ||
          report.companyName.toLowerCase().includes(q) ||
          staffNames.includes(q)
        )
      })
      .slice(0, 20)
  }, [historySearch, weeklyReports])

  useEffect(() => {
    async function loadCloudRota() {
      try {
        const local = localStorage.getItem(LOCAL_ROTA_KEY)
        if (local) {
          const parsed = JSON.parse(local)
          if (Array.isArray(parsed.companies)) setCompanies(parsed.companies)
          if (Array.isArray(parsed.staff)) setStaff(parsed.staff)
          if (parsed.rota) setRota(parsed.rota)
          if (parsed.defaultRota) setDefaultRota(parsed.defaultRota)
          if (parsed.editedWeeks) setEditedWeeks(parsed.editedWeeks)
          if (Array.isArray(parsed.weeklyReports)) setWeeklyReports(parsed.weeklyReports)
          if (parsed.googleCalendarSynced) setGoogleCalendarSynced(Boolean(parsed.googleCalendarSynced))
        }

        const { data: userData } = await supabase.auth.getUser()
        const userKey = userData?.user?.id || 'default'
        setCloudUserKey(userKey)

        const { data, error } = await supabase
          .from(ROTA_SETTINGS_TABLE)
          .select('data')
          .eq('user_key', userKey)
          .maybeSingle()

        if (error) throw error

        const saved = data?.data || {}

        if (Array.isArray(saved.companies)) setCompanies(saved.companies)
        if (Array.isArray(saved.staff)) setStaff(saved.staff)
        if (saved.rota) setRota(saved.rota)
        if (saved.defaultRota) setDefaultRota(saved.defaultRota)
        if (saved.editedWeeks) setEditedWeeks(saved.editedWeeks)
        if (Array.isArray(saved.weeklyReports)) setWeeklyReports(saved.weeklyReports)
        if (saved.googleCalendarSynced) setGoogleCalendarSynced(Boolean(saved.googleCalendarSynced))
      } catch (error) {
        console.error('ROTA_CLOUD_LOAD_ERROR', error)
        setStatusMessage('Rota loaded locally. Cloud sync may not be set up yet.')
      } finally {
        setCloudLoaded(true)
      }
    }

    loadCloudRota()
  }, [])

  useEffect(() => {
    if (!cloudLoaded) return

    const payload = {
      companies,
      staff,
      rota,
      defaultRota,
      editedWeeks,
      weeklyReports,
      googleCalendarSynced,
    }

    localStorage.setItem(LOCAL_ROTA_KEY, JSON.stringify(payload))

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = window.setTimeout(async () => {
      try {
        const { error } = await supabase.from(ROTA_SETTINGS_TABLE).upsert({
          user_key: cloudUserKey,
          data: payload,
          updated_at: new Date().toISOString(),
        })

        if (error) throw error
      } catch (error) {
        console.error('ROTA_CLOUD_SAVE_ERROR', error)
      }
    }, 800)

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [cloudLoaded, cloudUserKey, companies, staff, rota, defaultRota, editedWeeks, weeklyReports, googleCalendarSynced])

  function delayedExpand(key: string) {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current)
    }

    hoverTimerRef.current = window.setTimeout(() => {
      setExpandedDay(key)
    }, HOVER_DELAY_MS)
  }

  function cancelDelayedExpand() {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }

  function closeExpandedDay() {
    cancelDelayedExpand()
    setExpandedDay(null)
  }

  function getDayId(week: Date, dayIndex: number) {
    return dateKey(addDays(week, dayIndex))
  }

  function getWeekId(week: Date) {
    return dateKey(week)
  }

  function isCurrentWeek(week: Date) {
    return getWeekId(week) === getWeekId(currentWeekStart)
  }

  function getCompanyName(companyKey: CompanyKey) {
    return companies.find((company) => company.key === companyKey)?.name || companyKey
  }

  function updateCompany(companyKey: CompanyKey, patch: Partial<Company>) {
    setCompanies((current) =>
      current.map((company) => (company.key === companyKey ? { ...company, ...patch } : company))
    )
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
      current.map((shift) => (shift.id === shiftId ? { ...shift, ...patch, saved: false } : shift))
    )
  }

  function saveShift(company: CompanyKey, week: Date, dayIndex: number, shiftId: string) {
    const current = getDayShifts(company, week, dayIndex)

    setDayShifts(
      company,
      week,
      dayIndex,
      current.map((shift) => (shift.id === shiftId ? { ...shift, saved: true } : shift))
    )

    saveWeeklyReportSnapshot(company, week)
    setStatusMessage('Shift saved.')
  }

  function deleteShift(company: CompanyKey, week: Date, dayIndex: number, shiftId: string) {
    const current = getDayShifts(company, week, dayIndex)
    setDayShifts(
      company,
      week,
      dayIndex,
      current.filter((shift) => shift.id !== shiftId)
    )
    saveWeeklyReportSnapshot(company, week)
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

    const futureWeeks = [1, 2, 3, 4].map((offset) => addWeeks(week, offset))
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

    setStatusMessage(`${getCompanyName(company)} default rota set and applied to next 4 weeks.`)
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
    setStatusMessage(`${getCompanyName(company)} copied to next week.`)
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
      for (const shift of getDayShifts(company, week, i).filter(safeSaved)) {
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

  function saveWeeklyReportSnapshot(company: CompanyKey, week: Date) {
    const weekId = getWeekId(week)
    const totals = totalsForCompanyWeek(company, week)

    const staffTotals: WeeklyReport['staffTotals'] = {}

    for (const person of staff) {
      const row = totals[person.id] || {
        workHours: 0,
        holidayHours: 0,
        workWage: 0,
        holidayWage: 0,
      }

      staffTotals[person.id] = {
        name: person.name,
        workHours: row.workHours,
        holidayHours: row.holidayHours,
        workWage: row.workWage,
        holidayWage: row.holidayWage,
      }
    }

    const report: WeeklyReport = {
      id: `${company}-${weekId}`,
      company,
      weekId,
      companyName: getCompanyName(company),
      staffTotals,
      createdAt: new Date().toISOString(),
    }

    setWeeklyReports((current) => {
      const withoutCurrent = current.filter((row) => row.id !== report.id)
      return [report, ...withoutCurrent].slice(0, 250)
    })
  }

  function syncGoogleCalendar() {
    setGoogleCalendarSynced(true)

    const week = startOfWeek(new Date())
    const demoEvents: CalendarData = {}

    for (let i = 0; i < 35; i += 1) {
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
    setStatusMessage('Google Calendar auto sync placeholder is enabled.')
  }

  function openMonthlyCalendar() {
    setStatusMessage('Monthly Google Calendar placeholder. This can open a full month calendar modal later.')
  }

  function saveStaffSettings() {
    setSettingsOpen(false)
    setStatusMessage('Settings saved.')
  }

  function sendTelegram(company: CompanyKey, week: Date) {
    const companyName = getCompanyName(company)
    const rotaLines: string[] = []

    for (let i = 0; i < 7; i += 1) {
      const day = addDays(week, i)
      const shifts = getDayShifts(company, week, i).filter(safeSaved)

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
        className={`relative rounded-xl border p-2 pr-16 shadow-sm ${
          shift.type === 'holiday' ? 'border-amber-200 bg-amber-50' : 'border-neutral-200 bg-white'
        }`}
      >
        <div className="absolute right-2 top-2 flex gap-1">
          <button
            type="button"
            onClick={() => saveShift(company, week, dayIndex, shift.id)}
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-black ${
              safeSaved(shift) ? 'bg-emerald-500 text-white' : 'bg-emerald-100 text-emerald-700'
            }`}
          >
            ✓
          </button>
          <button
            type="button"
            onClick={() => deleteShift(company, week, dayIndex, shift.id)}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-xs font-black text-red-600"
          >
            ×
          </button>
        </div>

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
            {!safeSaved(shift) ? ' · unsaved' : ''}
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
    const allShifts = getDayShifts(company, week, dayIndex)
    const savedShifts = allShifts.filter(safeSaved)
    const events = calendarEvents[dayId] || []

    return (
      <div
        className="relative min-h-44 rounded-2xl border border-neutral-200 bg-neutral-50 p-2"
        onMouseEnter={() => delayedExpand(expandKey)}
        onMouseLeave={cancelDelayedExpand}
      >
        <div className="mb-2">
          <p className="text-sm font-black">{dayNames[dayIndex]}</p>
          <p className="text-xs font-bold text-neutral-400">
            {actualDate.toLocaleDateString('en-GB', {
              day: '2-digit',
              month: 'short',
            })}
          </p>
        </div>

        <div className="space-y-1">
          {savedShifts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-300 p-3 text-center text-xs font-bold text-neutral-400">
              No rota entries
            </p>
          ) : (
            savedShifts.slice(0, 5).map((shift) => {
              const person = staff.find((x) => x.id === shift.staffId)
              const shiftHourText = formatHours(shiftHours(shift))

              return (
                <div
                  key={shift.id}
                  className={`flex min-h-8 items-center rounded-lg px-1.5 py-1 text-[10px] font-black leading-tight ${
                    shift.type === 'holiday'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-white text-neutral-800'
                  }`}
                >
                  <span className="w-full whitespace-normal break-words">
                    {shift.type === 'holiday'
                      ? `${person?.name || 'Staff'} HOLIDAY ${shiftHourText}h`
                      : `${person?.name || 'Staff'} ${shift.start}–${shift.end}`}
                  </span>
                </div>
              )
            })
          )}

          {savedShifts.length > 5 && (
            <p className="text-xs font-black text-neutral-400">+{savedShifts.length - 5} more</p>
          )}
        </div>

        {isExpanded && (
          <div
            onMouseLeave={closeExpandedDay}
            className="absolute left-0 top-0 z-50 w-[min(440px,90vw)] rounded-3xl border border-neutral-300 bg-white p-3 shadow-2xl"
          >
            <div className="mb-3">
              <p className="text-lg font-black">{dayNames[dayIndex]}</p>
              <p className="text-sm font-bold text-neutral-500">
                {actualDate.toLocaleDateString('en-GB', {
                  weekday: 'long',
                  day: '2-digit',
                  month: 'long',
                })}
              </p>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => addShift(company, week, dayIndex, 'work')}
                  className="rounded-xl bg-black px-4 py-2 text-xs font-black text-white"
                >
                  + SHIFT
                </button>
                <button
                  type="button"
                  onClick={() => addShift(company, week, dayIndex, 'holiday')}
                  className="rounded-xl bg-amber-300 px-4 py-2 text-xs font-black text-black"
                >
                  + HOLIDAY
                </button>
              </div>
            </div>

            <div className="max-h-[48vh] space-y-2 overflow-auto pr-1">
              {allShifts.length === 0 ? (
                <p className="rounded-2xl bg-neutral-100 p-4 text-center text-sm font-bold text-neutral-400">
                  No shifts or holidays added yet.
                </p>
              ) : (
                allShifts.map((shift) => (
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

            <div className="mt-3 rounded-2xl bg-blue-50 p-3">
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
          </div>
        )}
      </div>
    )
  }

  function WeekPlanner({ company, week }: { company: Company; week: Date }) {
    const total = companyWeekTotal(company.key, week)
    const staffTotals = totalsForCompanyWeek(company.key, week)
    const isEdited = editedWeeks[company.key]?.[getWeekId(week)]
    const current = isCurrentWeek(week)

    return (
      <section
        className={`rounded-3xl border bg-white p-4 shadow-xl ${
          current ? 'border-emerald-400 ring-4 ring-emerald-100' : 'border-neutral-200'
        }`}
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <CompanyLogo company={company} />
            <div className="min-w-0">
              <p className="truncate text-xs font-black uppercase tracking-[0.2em] text-neutral-400">
                {company.name}
              </p>
              <h2 className="text-xl font-black">
                {formatWeekLabel(week)}
                {current && (
                  <span className="ml-2 rounded-full bg-emerald-100 px-2 py-1 align-middle text-[10px] font-black uppercase tracking-widest text-emerald-700">
                    Current
                  </span>
                )}
              </h2>
              <p className="text-sm font-semibold text-neutral-500">
                {total.workHours.toFixed(2)} work hrs · {total.holidayHours.toFixed(2)} hols hrs · {money(total.wage)}
                {isEdited ? ' · edited' : ''}
              </p>
            </div>
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

  function WeekGroup({ week }: { week: Date }) {
    return (
      <>
        <div className="hidden grid-cols-1 gap-5 xl:grid xl:grid-cols-2">
          {companies.map((company) => (
            <WeekPlanner
              key={`${company.key}-${dateKey(week)}`}
              company={company}
              week={week}
            />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-5 xl:hidden">
          {mobileCompanyList.map((company) => (
            <WeekPlanner
              key={`${company.key}-${dateKey(week)}-mobile`}
              company={company}
              week={week}
            />
          ))}
        </div>
      </>
    )
  }

  return (
    <main className="min-h-screen bg-neutral-100 text-neutral-950">
      <div className="mx-auto max-w-[1900px] space-y-5 p-3 sm:p-4">
        <header className="rounded-3xl bg-black p-4 text-white shadow-2xl sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.25em] text-white/50">
                Staff rota
              </p>
              <h1 className="text-3xl font-black tracking-tight">Weekly Planner</h1>
              <p className="mt-1 text-sm font-semibold text-white/60">
                Two-company rota · current week + next 4 weeks · staff hours · holiday hours · wage totals
              </p>
            </div>

            <div className="grid w-full grid-cols-4 gap-2 sm:w-auto sm:flex sm:flex-wrap sm:justify-end">
              <button
                type="button"
                onClick={() => setHistoryOpen((value) => !value)}
                className="flex items-center justify-center rounded-2xl bg-white/10 px-2 py-3 text-xs font-black text-white sm:px-4 sm:text-sm"
              >
                History
              </button>

              <button
                type="button"
                onClick={openMonthlyCalendar}
                className="flex items-center justify-center gap-1 rounded-2xl bg-purple-500 px-2 py-3 text-xs font-black text-white sm:gap-2 sm:px-4 sm:text-sm"
              >
                <CalendarIcon />
                Calendar
              </button>

              <button
                type="button"
                onClick={syncGoogleCalendar}
                className={`flex items-center justify-center gap-1 rounded-2xl px-2 py-3 text-xs font-black sm:gap-2 sm:px-4 sm:text-sm ${
                  googleCalendarSynced ? 'bg-white text-black' : 'bg-blue-500 text-white'
                }`}
              >
                <GoogleLogo />
                {googleCalendarSynced ? '✓' : 'Sync'}
              </button>

              <button
                type="button"
                onClick={() => setSettingsOpen((value) => !value)}
                className="flex items-center justify-center rounded-2xl bg-emerald-400 px-2 py-3 text-xs font-black text-black sm:px-4 sm:text-sm"
              >
                Settings
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 xl:hidden">
            {companies.map((company, index) => (
              <button
                key={company.key}
                type="button"
                onClick={() => setMobileCompany(company.key)}
                className={`flex min-w-0 items-center justify-center gap-2 rounded-2xl px-3 py-3 text-sm font-black ${
                  mobileCompany === company.key
                    ? 'bg-white text-black'
                    : 'bg-white/10 text-white'
                }`}
              >
                <CompanyLogo company={company} />
                <span className="truncate">Company {index + 1}</span>
              </button>
            ))}
          </div>

          {statusMessage && (
            <div className="mt-4 rounded-2xl bg-white/10 p-3 text-sm font-bold">
              {statusMessage}
            </div>
          )}
        </header>

        {historyOpen && (
          <section className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-xl">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black">Rota history</h2>
                <p className="text-sm font-semibold text-neutral-500">
                  Saved weekly staff hours for future reports.
                </p>
              </div>

              <input
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
                placeholder="Search week, company, staff..."
                className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-bold md:w-80"
              />
            </div>

            <div className="space-y-2">
              {filteredReports.length === 0 ? (
                <p className="rounded-2xl bg-neutral-100 p-4 text-sm font-bold text-neutral-400">
                  No saved history yet. Save shifts and weekly totals will appear here.
                </p>
              ) : (
                filteredReports.map((report) => (
                  <div key={report.id} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="font-black">
                        {report.companyName} · week {report.weekId}
                      </p>
                      <p className="text-xs font-bold text-neutral-400">
                        {new Date(report.createdAt).toLocaleString('en-GB')}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
                      {Object.values(report.staffTotals).map((row) => (
                        <div key={row.name} className="rounded-xl bg-white p-2 text-xs font-bold">
                          <div className="flex items-center justify-between">
                            <span>{row.name}</span>
                            <span>{(row.workHours + row.holidayHours).toFixed(2)}h</span>
                          </div>
                          <div className="mt-1 grid grid-cols-2 gap-1 text-neutral-500">
                            <span>Work {row.workHours.toFixed(2)}h</span>
                            <span className="text-right">{money(row.workWage)}</span>
                            <span>Hols {row.holidayHours.toFixed(2)}h</span>
                            <span className="text-right">{money(row.holidayWage)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {settingsOpen && (
          <section className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-black">Settings</h2>
                <p className="text-sm font-semibold text-neutral-500">
                  Edit company names, logo URLs, staff names, and hourly rates.
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

            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {companies.map((company, index) => (
                <div
                  key={company.key}
                  className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3"
                >
                  <p className="mb-2 text-xs font-black uppercase tracking-widest text-neutral-400">
                    Company {index + 1}
                  </p>

                  <div className="flex items-center gap-3">
                    <CompanyLogo company={company} />

                    <div className="min-w-0 flex-1 space-y-2">
                      <input
                        value={company.name}
                        onChange={(event) => updateCompany(company.key, { name: event.target.value })}
                        placeholder="Company name"
                        className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm font-bold"
                      />
                      <input
                        value={company.logoUrl || ''}
                        onChange={(event) => updateCompany(company.key, { logoUrl: event.target.value })}
                        placeholder="Logo image URL"
                        className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-xs font-bold"
                      />
                    </div>
                  </div>
                </div>
              ))}
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

        <WeekGroup week={currentWeekStart} />

        <section className="space-y-5">
          <h2 className="px-1 text-xl font-black">Next 4 weeks</h2>

          {futureWeekStarts.map((week) => (
            <WeekGroup key={dateKey(week)} week={week} />
          ))}
        </section>
      </div>
    </main>
  )
}
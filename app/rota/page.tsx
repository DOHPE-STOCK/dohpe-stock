'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

type CompanyKey = 'dohpe' | 'dlretail'
type ShiftType = 'work' | 'holiday'

type StaffMember = { id: string; name: string; hourlyRate: number }

type OpeningTime = {
  open: string
  close: string
  closed?: boolean
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

type CalendarEvent = { id: string; title: string; start: string; end: string }
type Company = { key: CompanyKey; name: string; telegramGroup: string; logoUrl?: string }

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
type OpeningTimes = Record<CompanyKey, OpeningTime[]>

type ActiveEditor = {
  company: CompanyKey
  weekId: string
  dayIndex: number
  shiftId: string
  isNew: boolean
}

const ROTA_SETTINGS_TABLE = 'rota_settings'
const ROTA_GLOBAL_KEY = 'dohpe_global_rota'
const LOCAL_ROTA_KEY = 'dohpe_rota_global_settings_v1'
const LOCAL_CALENDAR_KEY = 'dohpe_rota_calendar_settings_v1'

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

const defaultOpeningTimes: OpeningTimes = {
  dohpe: [
    { open: '10:00', close: '17:00' },
    { open: '10:00', close: '17:00' },
    { open: '10:00', close: '17:00' },
    { open: '10:00', close: '17:00' },
    { open: '10:00', close: '17:00' },
    { open: '10:00', close: '17:00' },
    { open: '10:00', close: '16:00' },
  ],
  dlretail: [
    { open: '10:00', close: '17:00' },
    { open: '10:00', close: '17:00' },
    { open: '10:00', close: '17:00' },
    { open: '10:00', close: '17:00' },
    { open: '10:00', close: '17:00' },
    { open: '10:00', close: '17:00' },
    { open: '10:00', close: '16:00' },
  ],
}

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

function normaliseTimeInput(value: string) {
  const raw = value.trim()

  if (raw.includes(':')) {
    const [hRaw = '', mRaw = ''] = raw.split(':')
    const h = hRaw.replace(/\D/g, '').slice(0, 2)
    const m = mRaw.replace(/\D/g, '').slice(0, 2)
    return m ? `${h}:${m}` : h ? `${h}:` : ''
  }

  const digits = raw.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

function timeToMinutes(value: string) {
  if (!value || !value.includes(':')) return 0
  const [h, m] = value.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
  return h * 60 + m
}

function shortTime(value: string) {
  if (!value || !value.includes(':')) return value || ''
  const [h, m] = value.split(':')
  if (m === '00') return String(Number(h))
  return `${Number(h)}:${m}`
}

function rawShiftHours(shift: Shift) {
  if (shift.type === 'holiday') return Number(shift.holidayHours || 0)
  const start = timeToMinutes(shift.start)
  const end = timeToMinutes(shift.end)
  if (!start || !end || end <= start) return 0
  return (end - start) / 60
}

function shiftHours(shift: Shift, staffMember?: StaffMember) {
  const raw = rawShiftHours(shift)
  if (shift.type === 'holiday') return raw

  const staffName = (staffMember?.name || '').trim().toLowerCase()
  const specialBreakStaff = staffName === 'meghan' || staffName === 'ned'

  if (specialBreakStaff) {
    if (raw >= 6) return Math.max(0, raw - 30 / 60)
    if (raw > 4) return Math.max(0, raw - 15 / 60)
    return raw
  }

  if (raw >= 6) return Math.max(0, raw - 20 / 60)
  return raw
}

function formatHours(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function shiftTimeLabel(shift: Shift, opening?: OpeningTime) {
  if (shift.type === 'holiday') return `HOLIDAY ${formatHours(rawShiftHours(shift))}h`

  if (opening && !opening.closed && shift.start === opening.open && shift.end === opening.close) {
    return 'FULL DAY'
  }

  return `${shortTime(shift.start)}-${shortTime(shift.end)}`
}

function telegramShiftTimeLabel(shift: Shift, opening?: OpeningTime) {
  if (shift.type === 'holiday') return `${formatHours(rawShiftHours(shift))}h`

  if (opening && !opening.closed && shift.start === opening.open && shift.end === opening.close) {
    return 'FULL DAY'
  }

  return `${shift.start}-${shift.end}`
}

function openingTimeLabel(opening: OpeningTime, mobileFull = false) {
  if (opening.closed) return 'Closed'
  return mobileFull ? `${opening.open} - ${opening.close}` : `${shortTime(opening.open)}-${shortTime(opening.close)}`
}

function money(value: number) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(value || 0)
}

function cloneShift(shift: Shift): Shift {
  return { ...shift, id: crypto.randomUUID(), saved: true }
}

function makeWorkShift(): Shift {
  return {
    id: crypto.randomUUID(),
    staffId: '',
    type: 'work',
    start: '',
    end: '',
    holidayHours: 0,
    note: '',
    saved: true,
  }
}

function makeHolidayShift(): Shift {
  return {
    id: crypto.randomUUID(),
    staffId: '',
    type: 'holiday',
    start: '',
    end: '',
    holidayHours: 7,
    note: 'Holiday',
    saved: true,
  }
}

function emptyDefault(): DefaultRota {
  return { dohpe: {}, dlretail: {} }
}

function normaliseShiftForCompare(shift: Shift) {
  return {
    staffId: shift.staffId,
    type: shift.type,
    start: shift.start,
    end: shift.end,
    holidayHours: Number(shift.holidayHours || 0),
    note: shift.note || '',
  }
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
  const saveTimerRef = useRef<number | null>(null)
  const calendarSaveTimerRef = useRef<number | null>(null)
  const statusTimerRef = useRef<number | null>(null)

  const [companies, setCompanies] = useState<Company[]>(defaultCompanies)
  const [mobileCompany, setMobileCompany] = useState<CompanyKey>('dohpe')
  const [staff, setStaff] = useState<StaffMember[]>(defaultStaff)
  const [openingTimes, setOpeningTimes] = useState<OpeningTimes>(defaultOpeningTimes)
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
  const [activeEditor, setActiveEditor] = useState<ActiveEditor | null>(null)
  const [draftShift, setDraftShift] = useState<Shift | null>(null)
  const [draftDirty, setDraftDirty] = useState(false)
  const [cloudLoaded, setCloudLoaded] = useState(false)
  const [calendarUserKey, setCalendarUserKey] = useState('calendar:default')
  const [calendarLoaded, setCalendarLoaded] = useState(false)

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

  const futureWeekStarts = useMemo(
    () => [1, 2, 3, 4].map((offset) => addWeeks(currentWeekStart, offset)),
    [currentWeekStart]
  )

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

  function showStatus(message: string) {
    setStatusMessage(message)
    if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current)
    statusTimerRef.current = window.setTimeout(() => setStatusMessage(''), 3000)
  }

  useEffect(() => {
    async function loadCloudRota() {
      try {
        const local = localStorage.getItem(LOCAL_ROTA_KEY)

        if (local) {
          const parsed = JSON.parse(local)
          if (Array.isArray(parsed.companies)) setCompanies(parsed.companies)
          if (Array.isArray(parsed.staff)) setStaff(parsed.staff)
          if (parsed.openingTimes) setOpeningTimes(parsed.openingTimes)
          if (parsed.rota) setRota(parsed.rota)
          if (parsed.defaultRota) setDefaultRota(parsed.defaultRota)
          if (parsed.editedWeeks) setEditedWeeks(parsed.editedWeeks)
          if (Array.isArray(parsed.weeklyReports)) setWeeklyReports(parsed.weeklyReports)
        }

        const { data, error } = await supabase
          .from(ROTA_SETTINGS_TABLE)
          .select('data')
          .eq('user_key', ROTA_GLOBAL_KEY)
          .maybeSingle()

        if (error) throw error

        const saved = data?.data || {}

        if (Array.isArray(saved.companies)) setCompanies(saved.companies)
        if (Array.isArray(saved.staff)) setStaff(saved.staff)
        if (saved.openingTimes) setOpeningTimes(saved.openingTimes)
        if (saved.rota) setRota(saved.rota)
        if (saved.defaultRota) setDefaultRota(saved.defaultRota)
        if (saved.editedWeeks) setEditedWeeks(saved.editedWeeks)
        if (Array.isArray(saved.weeklyReports)) setWeeklyReports(saved.weeklyReports)
      } catch (error) {
        console.error('ROTA_CLOUD_LOAD_ERROR', error)
        showStatus('Rota loaded locally. Cloud sync may not be set up yet.')
      } finally {
        setCloudLoaded(true)
      }
    }

    loadCloudRota()
  }, [])

  useEffect(() => {
    async function loadUserCalendarSettings() {
      try {
        const { data: userData } = await supabase.auth.getUser()
        const key = `calendar:${userData?.user?.id || 'default'}`
        setCalendarUserKey(key)

        const local = localStorage.getItem(`${LOCAL_CALENDAR_KEY}:${key}`)
        if (local) {
          const parsed = JSON.parse(local)
          if (parsed.googleCalendarSynced) setGoogleCalendarSynced(Boolean(parsed.googleCalendarSynced))
          if (parsed.calendarEvents) setCalendarEvents(parsed.calendarEvents)
        }

        const { data, error } = await supabase
          .from(ROTA_SETTINGS_TABLE)
          .select('data')
          .eq('user_key', key)
          .maybeSingle()

        if (error) throw error

        const saved = data?.data || {}
        if (saved.googleCalendarSynced) setGoogleCalendarSynced(Boolean(saved.googleCalendarSynced))
        if (saved.calendarEvents) setCalendarEvents(saved.calendarEvents)
      } catch (error) {
        console.error('ROTA_CALENDAR_LOAD_ERROR', error)
      } finally {
        setCalendarLoaded(true)
      }
    }

    loadUserCalendarSettings()
  }, [])

  useEffect(() => {
    if (!cloudLoaded) return

    const payload = {
      companies,
      staff,
      openingTimes,
      rota,
      defaultRota,
      editedWeeks,
      weeklyReports,
    }

    localStorage.setItem(LOCAL_ROTA_KEY, JSON.stringify(payload))

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)

    saveTimerRef.current = window.setTimeout(async () => {
      try {
        const { error } = await supabase.from(ROTA_SETTINGS_TABLE).upsert(
          {
            user_key: ROTA_GLOBAL_KEY,
            data: payload,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_key' }
        )

        if (error) throw error
      } catch (error) {
        console.error('ROTA_CLOUD_SAVE_ERROR', error)
      }
    }, 800)

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [cloudLoaded, companies, staff, openingTimes, rota, defaultRota, editedWeeks, weeklyReports])

  useEffect(() => {
    if (!calendarLoaded) return

    const payload = {
      googleCalendarSynced,
      calendarEvents,
    }

    localStorage.setItem(`${LOCAL_CALENDAR_KEY}:${calendarUserKey}`, JSON.stringify(payload))

    if (calendarSaveTimerRef.current) window.clearTimeout(calendarSaveTimerRef.current)

    calendarSaveTimerRef.current = window.setTimeout(async () => {
      try {
        const { error } = await supabase.from(ROTA_SETTINGS_TABLE).upsert(
          {
            user_key: calendarUserKey,
            data: payload,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_key' }
        )

        if (error) throw error
      } catch (error) {
        console.error('ROTA_CALENDAR_SAVE_ERROR', error)
      }
    }, 800)

    return () => {
      if (calendarSaveTimerRef.current) window.clearTimeout(calendarSaveTimerRef.current)
    }
  }, [calendarLoaded, calendarUserKey, googleCalendarSynced, calendarEvents])

  function getDayId(week: Date, dayIndex: number) {
    return dateKey(addDays(week, dayIndex))
  }

  function getWeekId(week: Date) {
    return dateKey(week)
  }

  function getWeekFromId(weekId: string) {
    const [y, m, d] = weekId.split('-').map(Number)
    return new Date(y, m - 1, d)
  }

  function isCurrentWeek(week: Date) {
    return getWeekId(week) === getWeekId(currentWeekStart)
  }

  function getCompanyName(companyKey: CompanyKey) {
    return companies.find((company) => company.key === companyKey)?.name || companyKey
  }

  function getOpening(company: CompanyKey, dayIndex: number) {
    return openingTimes[company]?.[dayIndex] || { open: '10:00', close: '17:00' }
  }

  function updateCompany(companyKey: CompanyKey, patch: Partial<Company>) {
    setCompanies((current) =>
      current.map((company) => (company.key === companyKey ? { ...company, ...patch } : company))
    )
  }

  function updateOpening(company: CompanyKey, dayIndex: number, patch: Partial<OpeningTime>) {
    setOpeningTimes((current) => ({
      ...current,
      [company]: current[company].map((row, index) =>
        index === dayIndex ? { ...row, ...patch } : row
      ),
    }))
  }

  function closeDay(company: CompanyKey, dayIndex: number) {
    updateOpening(company, dayIndex, { closed: true })
    setActiveEditor(null)
    setDraftShift(null)
    setDraftDirty(false)
    showStatus('Day marked closed.')
  }

  function openDay(company: CompanyKey, dayIndex: number) {
    updateOpening(company, dayIndex, { closed: false })
    showStatus('Day reopened.')
  }

  function getDayShifts(company: CompanyKey, week: Date, dayIndex: number) {
    const weekId = getWeekId(week)
    const dayId = getDayId(week, dayIndex)
    return rota[company]?.[weekId]?.[dayId] || []
  }

  function getDayShiftsByWeekId(company: CompanyKey, weekId: string, dayIndex: number) {
    const week = getWeekFromId(weekId)
    const dayId = getDayId(week, dayIndex)
    return rota[company]?.[weekId]?.[dayId] || []
  }

  function weekHasDifferentInfo(company: CompanyKey, week: Date, template: Record<string, Shift[]>) {
    const weekRows = rota[company]?.[getWeekId(week)] || {}

    for (let i = 0; i < 7; i += 1) {
      const currentDay = (weekRows[getDayId(week, i)] || []).map(normaliseShiftForCompare)
      const templateDay = (template[String(i)] || []).map(normaliseShiftForCompare)

      if (JSON.stringify(currentDay) !== JSON.stringify(templateDay)) {
        if (currentDay.length > 0 || templateDay.length > 0) return true
      }
    }

    return false
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

  function openNewShift(company: CompanyKey, week: Date, dayIndex: number, type: ShiftType, allowClosed = false) {
    const opening = getOpening(company, dayIndex)
    if (opening.closed && !allowClosed) return

    const shift = type === 'holiday' ? makeHolidayShift() : makeWorkShift()

    setDraftShift(shift)
    setDraftDirty(false)
    setActiveEditor({
      company,
      weekId: getWeekId(week),
      dayIndex,
      shiftId: shift.id,
      isNew: true,
    })
  }

  function openClosedDayEditor(company: CompanyKey, week: Date, dayIndex: number) {
    openNewShift(company, week, dayIndex, 'work', true)
  }

  function openExistingShift(company: CompanyKey, week: Date, dayIndex: number, shift: Shift) {
    setDraftShift({ ...shift })
    setDraftDirty(false)
    setActiveEditor({
      company,
      weekId: getWeekId(week),
      dayIndex,
      shiftId: shift.id,
      isNew: false,
    })
  }

  function requestCloseEditor() {
    if (!activeEditor) return

    if (draftDirty && draftShift) {
      const save = window.confirm('Save changes to this shift? Press OK to save, or Cancel to discard.')

      if (save) {
        saveDraftShift()
      } else {
        setActiveEditor(null)
        setDraftShift(null)
        setDraftDirty(false)
      }

      return
    }

    setActiveEditor(null)
    setDraftShift(null)
    setDraftDirty(false)
  }

  function updateDraftShift(patch: Partial<Shift>) {
    setDraftShift((current) => (current ? { ...current, ...patch } : current))
    setDraftDirty(true)
  }

  function saveDraftShift() {
    if (!activeEditor || !draftShift) return

    if (!draftShift.staffId) {
      showStatus('Select a staff member before saving.')
      return
    }

    if (draftShift.type === 'work' && (!draftShift.start || !draftShift.end)) {
      showStatus('Enter start and finish times before saving.')
      return
    }

    const week = getWeekFromId(activeEditor.weekId)
    const current = getDayShiftsByWeekId(activeEditor.company, activeEditor.weekId, activeEditor.dayIndex)
    const savedShift = { ...draftShift, saved: true }

    const next = activeEditor.isNew
      ? [...current, savedShift]
      : current.map((shift) => (shift.id === activeEditor.shiftId ? savedShift : shift))

    setDayShifts(activeEditor.company, week, activeEditor.dayIndex, next)
    updateOpening(activeEditor.company, activeEditor.dayIndex, { closed: false })
    saveWeeklyReportSnapshot(activeEditor.company, week)

    setActiveEditor(null)
    setDraftShift(null)
    setDraftDirty(false)
    showStatus('Shift saved.')
  }

  function quickDeleteShift(company: CompanyKey, week: Date, dayIndex: number, shiftId: string) {
    const confirmed = window.confirm('Remove this shift?')
    if (!confirmed) return

    const current = getDayShifts(company, week, dayIndex)

    setDayShifts(
      company,
      week,
      dayIndex,
      current.filter((shift) => shift.id !== shiftId)
    )

    saveWeeklyReportSnapshot(company, week)
    showStatus('Shift removed.')
  }

  function applyDefaultToWeek(company: CompanyKey, week: Date, template: Record<string, Shift[]>) {
    const weekId = getWeekId(week)
    const copied: Record<string, Shift[]> = {}

    for (let i = 0; i < 7; i += 1) {
      copied[getDayId(week, i)] = (template[String(i)] || []).map(cloneShift)
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
    const weekRows = rota[company]?.[getWeekId(week)] || {}
    const template: Record<string, Shift[]> = {}

    for (let i = 0; i < 7; i += 1) {
      template[String(i)] = (weekRows[getDayId(week, i)] || []).map(cloneShift)
    }

    const futureWeeks = [1, 2, 3, 4].map((offset) => addWeeks(week, offset))
    const willOverwriteDifferentInfo = futureWeeks.some((futureWeek) =>
      weekHasDifferentInfo(company, futureWeek, template)
    )

    if (willOverwriteDifferentInfo) {
      const confirmed = window.confirm(
        'This default is different to information already entered in upcoming weeks. Setting default will overwrite those weeks. Continue?'
      )

      if (!confirmed) return
    }

    setDefaultRota((current) => ({ ...current, [company]: template }))

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

    showStatus(`${getCompanyName(company)} default rota set and applied to next 4 weeks.`)
  }

  function copyWeekToNext(company: CompanyKey, week: Date) {
    const answer = window.prompt(
      'Copy this week to which week?\nEnter 1 for next week, 2 for 2 weeks ahead, 3 for 3 weeks ahead, or 4 for 4 weeks ahead.',
      '1'
    )

    if (!answer) return

    const offset = Number(answer)

    if (!Number.isFinite(offset) || offset < 1 || offset > 4) {
      showStatus('Copy cancelled. Enter a number from 1 to 4.')
      return
    }

    const sourceWeekId = getWeekId(week)
    const targetWeek = addWeeks(week, offset)
    const targetWeekId = getWeekId(targetWeek)
    const source = rota[company]?.[sourceWeekId] || {}
    const copied: Record<string, Shift[]> = {}

    for (let i = 0; i < 7; i += 1) {
      copied[getDayId(targetWeek, i)] = (source[getDayId(week, i)] || []).map(cloneShift)
    }

    setRota((current) => ({
      ...current,
      [company]: {
        ...current[company],
        [targetWeekId]: copied,
      },
    }))

    markWeekEdited(company, targetWeek)
    showStatus(`${getCompanyName(company)} copied to ${formatWeekLabel(targetWeek)}.`)
  }

  function totalsForCompanyWeek(company: CompanyKey, week: Date) {
    const totals: Record<
      string,
      { workHours: number; holidayHours: number; workWage: number; holidayWage: number }
    > = {}

    for (const person of staff) {
      totals[person.id] = { workHours: 0, holidayHours: 0, workWage: 0, holidayWage: 0 }
    }

    for (let i = 0; i < 7; i += 1) {
      for (const shift of getDayShifts(company, week, i)) {
        if (!shift.staffId) continue

        const person = staff.find((x) => x.id === shift.staffId)
        const hours = shiftHours(shift, person)
        const wage = hours * Number(person?.hourlyRate || 0)

        if (!totals[shift.staffId]) {
          totals[shift.staffId] = { workHours: 0, holidayHours: 0, workWage: 0, holidayWage: 0 }
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
          { id: crypto.randomUUID(), title: 'Synced calendar event', start: '09:00', end: '10:00' },
        ]
      }

      if (i % 9 === 0) {
        demoEvents[key] = [
          ...(demoEvents[key] || []),
          { id: crypto.randomUUID(), title: 'Unavailable', start: '14:00', end: '15:30' },
        ]
      }
    }

    setCalendarEvents(demoEvents)
    showStatus('Google Calendar auto sync placeholder is enabled for this logged-in user.')
  }

  function openMonthlyCalendar() {
    showStatus('Monthly Google Calendar placeholder. This can open a full month calendar modal later.')
  }

  function saveStaffSettings() {
    setSettingsOpen(false)
    showStatus('Settings saved.')
  }

  async function sendTelegram(company: CompanyKey, week: Date) {
    const companyName = getCompanyName(company)
    const weekLabel = formatWeekLabel(week)

    const days = dayNames.map((dayName, dayIndex) => {
      const actualDate = addDays(week, dayIndex)
      const opening = getOpening(company, dayIndex)
      const shifts = getDayShifts(company, week, dayIndex)

      return {
        day: dayName,
        date: actualDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        opening: opening.closed ? 'Closed' : `${opening.open} - ${opening.close}`,
        shifts: shifts.map((shift) => {
          const person = staff.find((x) => x.id === shift.staffId)

          return {
            name: person?.name || 'Staff',
            type: shift.type,
            time: telegramShiftTimeLabel(shift, opening),
          }
        }),
      }
    })

    try {
      showStatus(`Sending ${companyName} rota to Telegram...`)

      const response = await fetch('/api/rota/send-telegram', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          company,
          companyName,
          weekLabel,
          days,
        }),
      })

      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Telegram send failed.')
      }

      showStatus(`${companyName} rota sent to Telegram.`)
    } catch (error: any) {
      console.error('ROTA_TELEGRAM_SEND_ERROR', error)
      showStatus(error.message || 'Telegram send failed.')
    }
  }

  function addStaffMember() {
    setStaff((current) => [
      ...current,
      { id: crypto.randomUUID(), name: `Staff ${current.length + 1}`, hourlyRate: 12.21 },
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

  function ShiftEditor() {
    if (!activeEditor || !draftShift) return null

    const week = getWeekFromId(activeEditor.weekId)
    const actualDate = addDays(week, activeEditor.dayIndex)
    const events = calendarEvents[getDayId(week, activeEditor.dayIndex)] || []
    const opening = getOpening(activeEditor.company, activeEditor.dayIndex)

    return (
      <div
        onClick={(event) => event.stopPropagation()}
        className="fixed left-1/2 top-20 z-50 w-[min(440px,92vw)] -translate-x-1/2 cursor-default rounded-3xl border border-neutral-300 bg-white p-3 shadow-2xl xl:absolute xl:left-0 xl:top-0 xl:translate-x-0"
      >
        <div className="mb-3">
          <p className="text-lg font-black">{dayNames[activeEditor.dayIndex]}</p>
          <p className="text-sm font-bold text-neutral-500">
            {actualDate.toLocaleDateString('en-GB', {
              weekday: 'long',
              day: '2-digit',
              month: 'long',
            })}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                openDay(activeEditor.company, activeEditor.dayIndex)
                updateDraftShift({ type: 'work' })
              }}
              className={`rounded-xl px-4 py-2 text-xs font-black ${
                draftShift.type === 'work' ? 'bg-black text-white' : 'bg-neutral-100 text-neutral-400'
              }`}
            >
              SHIFT
            </button>

            <button
              type="button"
              onClick={() => {
                openDay(activeEditor.company, activeEditor.dayIndex)
                updateDraftShift({ type: 'holiday', holidayHours: draftShift.holidayHours || 7 })
              }}
              className={`rounded-xl px-4 py-2 text-xs font-black ${
                draftShift.type === 'holiday' ? 'bg-amber-300 text-black' : 'bg-neutral-100 text-neutral-400'
              }`}
            >
              HOLIDAY
            </button>

            <button
              type="button"
              onClick={() => closeDay(activeEditor.company, activeEditor.dayIndex)}
              className="rounded-xl bg-red-100 px-4 py-2 text-xs font-black text-red-600"
            >
              CLOSE
            </button>
          </div>
        </div>

        <div
          className={`relative rounded-xl border p-2 pr-16 shadow-sm ${
            draftShift.type === 'holiday' ? 'border-amber-200 bg-amber-50' : 'border-neutral-200 bg-white'
          }`}
        >
          <div className="absolute right-2 top-2 flex gap-1">
            <button
              type="button"
              onClick={saveDraftShift}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-black text-emerald-700"
            >
              ✓
            </button>
            <button
              type="button"
              onClick={requestCloseEditor}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-xs font-black text-red-600"
            >
              ×
            </button>
          </div>

          <div className="mb-2">
            <select
              value={draftShift.staffId}
              onChange={(event) => updateDraftShift({ staffId: event.target.value })}
              className="w-[calc(100%-0.5rem)] max-w-[300px] rounded-lg border border-neutral-200 px-2 py-2 text-xs font-bold"
            >
              <option value="">Select staff</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </div>

          {draftShift.type === 'holiday' ? (
            <div className="rounded-xl bg-amber-100 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-black text-amber-700">HOLS</span>
                <input
                  type="number"
                  value={draftShift.holidayHours}
                  onChange={(event) => updateDraftShift({ holidayHours: Number(event.target.value) })}
                  className="w-20 rounded-lg border border-amber-200 px-2 py-2 text-xs font-black"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-[72px_72px_1fr] gap-2 sm:grid-cols-[86px_86px_1fr]">
              <input
                type="text"
                inputMode="numeric"
                placeholder="--:--"
                value={draftShift.start}
                onChange={(event) => updateDraftShift({ start: normaliseTimeInput(event.target.value) })}
                className="min-w-0 rounded-lg border border-neutral-200 px-2 py-2 text-xs font-bold"
              />
              <input
                type="text"
                inputMode="numeric"
                placeholder="--:--"
                value={draftShift.end}
                onChange={(event) => updateDraftShift({ end: normaliseTimeInput(event.target.value) })}
                className="min-w-0 rounded-lg border border-neutral-200 px-2 py-2 text-xs font-bold"
              />
              <button
                type="button"
                onClick={() => {
                  openDay(activeEditor.company, activeEditor.dayIndex)
                  updateDraftShift({
                    type: 'work',
                    start: opening.open,
                    end: opening.close,
                  })
                }}
                className="min-w-0 rounded-lg bg-cyan-100 px-2 py-2 text-[10px] font-black text-cyan-800"
              >
                FULL DAY
              </button>
            </div>
          )}

          <input
            value={draftShift.note || ''}
            onChange={(event) => updateDraftShift({ note: event.target.value })}
            placeholder="Note"
            className="mt-2 w-full rounded-lg border border-neutral-200 px-2 py-2 text-xs"
          />
        </div>

        <div className="mt-3 rounded-2xl bg-blue-50 p-3">
          <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-blue-500">Google Calendar</p>

          {!googleCalendarSynced ? (
            <p className="text-xs font-bold text-blue-400">
              Calendar entries will be displayed here once Google Calendar is synced.
            </p>
          ) : events.length === 0 ? (
            <p className="text-xs font-bold text-blue-400">Calendar entries will be displayed here.</p>
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
      </div>
    )
  }

  function DayCard({ company, week, dayIndex }: { company: CompanyKey; week: Date; dayIndex: number }) {
    const actualDate = addDays(week, dayIndex)
    const shifts = getDayShifts(company, week, dayIndex)
    const opening = getOpening(company, dayIndex)
    const openingShortLabel = openingTimeLabel(opening, false)
    const openingMobileLabel = openingTimeLabel(opening, true)
    const editorOpenHere =
      activeEditor?.company === company &&
      activeEditor.weekId === getWeekId(week) &&
      activeEditor.dayIndex === dayIndex

    return (
      <div
        className={`relative min-h-44 rounded-2xl border p-2 ${
          opening.closed
            ? 'cursor-pointer border-red-200 bg-red-50'
            : 'border-neutral-200 bg-neutral-50'
        }`}
        onClick={() => {
          if (opening.closed) openClosedDayEditor(company, week, dayIndex)
        }}
      >
        <div className="mb-2">
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            <p className="text-sm font-black">{dayNames[dayIndex]}</p>
            <span className="shrink-0 text-[11px] font-black text-cyan-700 xl:hidden">
              {openingMobileLabel}
            </span>
            <span className="hidden shrink-0 text-[11px] font-black text-cyan-700 xl:inline">
              {openingShortLabel}
            </span>
          </div>
          <p className="text-xs font-bold text-neutral-400">
            {actualDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
          </p>
        </div>

        <div className="space-y-1">
          {shifts.map((shift) => {
            const person = staff.find((x) => x.id === shift.staffId)

            return (
              <div
                key={shift.id}
                onClick={(event) => {
                  event.stopPropagation()
                  openExistingShift(company, week, dayIndex, shift)
                }}
                className={`relative flex min-h-9 cursor-pointer flex-col justify-center rounded-lg px-1.5 py-1 pr-4 text-[10px] font-black leading-tight ${
                  shift.type === 'holiday' ? 'bg-amber-100 text-amber-700' : 'bg-white text-neutral-800'
                }`}
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    quickDeleteShift(company, week, dayIndex, shift.id)
                  }}
                  className="absolute right-1 top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-red-100 text-[10px] font-black text-red-600"
                >
                  ×
                </button>
                <span className="truncate pr-1">{person?.name || 'Staff'}</span>
                <span className="truncate text-[9px] opacity-80">{shiftTimeLabel(shift, opening)}</span>
              </div>
            )
          })}

          {!opening.closed && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                openNewShift(company, week, dayIndex, 'work')
              }}
              className="flex min-h-9 w-full items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-white/70 px-2 py-1 text-xs font-black text-neutral-400 hover:border-neutral-500 hover:text-neutral-700"
            >
              + SHIFT
            </button>
          )}
        </div>

        {editorOpenHere && <ShiftEditor />}
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
          current ? 'border-emerald-600 ring-4 ring-emerald-300' : 'border-neutral-200'
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
                  <span className="ml-2 rounded-full bg-emerald-600 px-2 py-1 align-middle text-[10px] font-black uppercase tracking-widest text-white">
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

        <div className="mt-4 rounded-2xl bg-cyan-950 p-3 text-white">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-black">Weekly totals</p>
            <p className="text-sm font-black text-cyan-100">
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
                <div key={person.id} className="rounded-xl bg-cyan-100 p-2 text-xs font-bold text-cyan-950">
                  <div className="flex items-center justify-between gap-2">
                    <span>{person.name}</span>
                    <span>{(row.workHours + row.holidayHours).toFixed(2)} hrs</span>
                  </div>

                  <div className="mt-1 grid grid-cols-2 gap-1 text-cyan-700">
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
            <WeekPlanner key={`${company.key}-${dateKey(week)}`} company={company} week={week} />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-5 xl:hidden">
          {mobileCompanyList.map((company) => (
            <WeekPlanner key={`${company.key}-${dateKey(week)}-mobile`} company={company} week={week} />
          ))}
        </div>
      </>
    )
  }

  return (
    <main className="min-h-screen bg-neutral-100 text-neutral-950">
      {activeEditor && <div className="fixed inset-0 z-40 bg-transparent" onClick={requestCloseEditor} />}

      <div className="mx-auto max-w-[1900px] space-y-5 p-3 sm:p-4">
        <header className="rounded-3xl bg-black p-4 text-white shadow-2xl sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.25em] text-white/50">Staff rota</p>
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
                  mobileCompany === company.key ? 'bg-white text-black' : 'bg-white/10 text-white'
                }`}
              >
                <CompanyLogo company={company} />
                <span className="truncate">Company {index + 1}</span>
              </button>
            ))}
          </div>

          {statusMessage && <div className="mt-4 rounded-2xl bg-white/10 p-3 text-sm font-bold">{statusMessage}</div>}
        </header>

        {historyOpen && (
          <section className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-xl">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black">Rota history</h2>
                <p className="text-sm font-semibold text-neutral-500">Saved weekly staff hours for future reports.</p>
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
                  Edit company names, logo URLs, opening times, staff names, and hourly rates.
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
                <div key={company.key} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
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

                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-black uppercase tracking-widest text-neutral-400">Opening times</p>

                    {dayNames.map((day, dayIndex) => {
                      const opening = getOpening(company.key, dayIndex)

                      return (
                        <div key={`${company.key}-${day}`} className="grid grid-cols-[44px_1fr_1fr_70px] items-center gap-2">
                          <span className="text-xs font-black text-neutral-500">{day}</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="--:--"
                            value={opening.open}
                            disabled={opening.closed}
                            onChange={(event) => updateOpening(company.key, dayIndex, { open: normaliseTimeInput(event.target.value) })}
                            className="rounded-lg border border-neutral-200 px-2 py-2 text-xs font-bold disabled:opacity-40"
                          />
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="--:--"
                            value={opening.close}
                            disabled={opening.closed}
                            onChange={(event) => updateOpening(company.key, dayIndex, { close: normaliseTimeInput(event.target.value) })}
                            className="rounded-lg border border-neutral-200 px-2 py-2 text-xs font-bold disabled:opacity-40"
                          />
                          <label className="flex items-center gap-1 text-[10px] font-black text-neutral-500">
                            <input
                              type="checkbox"
                              checked={Boolean(opening.closed)}
                              onChange={(event) => updateOpening(company.key, dayIndex, { closed: event.target.checked })}
                            />
                            Closed
                          </label>
                        </div>
                      )
                    })}
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
                      onChange={(event) => updateStaff(person.id, { hourlyRate: Number(event.target.value) })}
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
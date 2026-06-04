'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { supabase } from '@/lib/supabase'

type StaffUser = {
  id: string
  name: string
  is_active?: boolean | null
  payroll_settings?: PayrollStaffSettings | null
}

type PayrollPeriod = 'weekly' | 'biweekly' | 'monthly'
type HolidayMethod = 'fixed_weeks' | 'accrual_percent'
type PayrollViewMode = 'period' | 'holiday_year'

type PayrollSettings = {
  id: string
  payroll_period: PayrollPeriod
  payroll_start_day: number | null
  payroll_start_date: string | null
  holiday_year_start_month: number
  holiday_year_start_day: number
  default_holiday_method: HolidayMethod
  default_holiday_weeks: number
  default_accrual_percent: number
}

type PayrollStaffSettings = {
  holiday_method?: HolidayMethod
  holiday_weeks?: number
  accrual_percent?: number
  carried_over_hours?: number
  break_4h_minutes?: number
  break_6h_minutes?: number
}

type FinalisedRotaShift = {
  staffId: string
  staffName?: string
  type: 'work' | 'holiday'
  hours: number
  rawHours?: number
  paidHours?: number
  breakHours?: number
  date?: string
  start?: string
  end?: string
}

type RotaShift = {
  id?: string
  staffId: string
  type: 'work' | 'holiday'
  start?: string
  end?: string
  holidayHours?: number
}

type RotaSettingsPayload = {
  rota?: Record<string, Record<string, Record<string, RotaShift[]>>>
  defaultRota?: Record<string, Record<string, RotaShift[]>>
  editedWeeks?: Record<string, Record<string, boolean>>
  closedDays?: Record<string, Record<string, boolean>>
}

type RotaFinalisationRow = {
  id: string
  company_key: string
  week_id: string
  status: string
  totals: any
  finalised_at: string | null
}

type HolidayRolloverRow = {
  id: string
  staff_id: string
  company_key: string
  holiday_year_start: string
  holiday_year_end: string
  carried_over_hours: number | null
  source_holiday_year_start: string | null
  source_holiday_year_end: string | null
  source_accrued_hours: number | null
  source_taken_hours: number | null
  source_closing_balance_hours: number | null
}

type PayrollReportRow = {
  staffId: string
  staffName: string
  workHours: number
  holidayHours: number
  breakHours: number
  paidHours: number
  holidayAccruedHours: number
  carriedOverHours: number
  autoCarriedOverHours: number
  carriedOverOverridden: boolean
  holidayBalanceHours: number
}

type ReviewItem = {
  id: string
  sku: string
  status: string
  sent_to_review_at: string | null
  sent_to_review_by: string | null
}

type StaffReportRow = {
  staffId: string
  staffName: string
  todayCount: number
  weekCount: number
  monthCount: number
  totalCount: number
}

type PosSale = {
  id: string
  sale_number: string
  mode: string | null
  payment_method: string | null
  subtotal: number | null
  discount_amount: number | null
  total: number | null
  status: string | null
  checkout_location: string | null
  created_at: string
}

type PosSaleLine = {
  id: string
  sale_id: string
  sku: string
  title: string | null
  brand: string | null
  reporting_category: string | null
  sub_category: string | null
  sub_type: string | null
  quantity: number | null
  unit_price: number | null
  line_total: number | null
}

type OnlineSale = {
  id: string
  sku: string
  quantity: number | null
  source: string | null
  sub_source: string | null
  current_status: string | null
  processed_at: string | null
  updated_at: string | null
}

type ItemRow = {
  id: string
  sku: string
  brand: string | null
  reporting_category: string | null
  sub_category: string | null
  sub_type: string | null
  final_title: string | null
  ai_title: string | null
  basic_title: string | null
  selling_price: number | null
}

type ItemImage = {
  item_id: string | null
  processed_url: string | null
  original_url: string | null
  image_order: number | null
}

type StockLocationRow = {
  item_id: string
  sku: string | null
  location_name: string
  bin_code: string
  stock_level: number | null
}

type LocationRow = {
  name: string
  label: string | null
  is_active: boolean | null
}

const DEFAULT_LOCATION_LABELS: Record<string, string> = {
  'LOCATION-1': 'WAREHOUSE',
  'LOCATION-2': 'SHOP-1',
  'LOCATION-3': 'SHOP-2',
  'LOCATION-4': 'SHOP-3',
  'LOCATION-5': 'SHOP-4',
  WAREHOUSE: 'WAREHOUSE',
}

type SalesPeriod = 'day' | 'week' | 'month'
type ReportView = 'sales' | 'stock' | 'staff' | 'payroll' | 'profit'

type SalesEvent = {
  id: string
  sourceType: 'pos' | 'online'
  channel: string
  paymentMethod: 'cash' | 'card' | 'online' | 'unknown'
  sku: string
  title: string
  brand: string
  category: string
  subCategory: string
  quantity: number
  amount: number
  occurredAt: Date
  location: string
  imageUrl: string
  estimated: boolean
}

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function num(value: any) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function money(value: number) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(value || 0)
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function startOfWeek(date = new Date()) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

function startOfMonth(date = new Date()) {
  const d = new Date(date)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function addMonths(date: Date, months: number) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function dateInputValue(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function dateKey(date: Date) {
  return dateInputValue(date)
}

function formatDateTime(value: string | null) {
  if (!value) return '-'

  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatPeriodLabel(period: SalesPeriod, anchor: Date) {
  if (period === 'day') {
    return anchor.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  }

  if (period === 'week') {
    const start = startOfWeek(anchor)
    const end = addDays(start, 6)
    return `${start.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} to ${end.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`
  }

  return anchor.toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  })
}

function getPeriodRange(period: SalesPeriod, anchor: Date) {
  if (period === 'day') {
    const start = new Date(anchor)
    start.setHours(0, 0, 0, 0)
    return { start, end: addDays(start, 1) }
  }

  if (period === 'week') {
    const start = startOfWeek(anchor)
    return { start, end: addDays(start, 7) }
  }

  const start = startOfMonth(anchor)
  return { start, end: addMonths(start, 1) }
}

function isOnOrAfter(value: string | null, date: Date) {
  if (!value) return false
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return false
  return parsed >= date
}

function eventKey(period: SalesPeriod, value: Date) {
  if (period === 'day') {
    return `${String(value.getHours()).padStart(2, '0')}:00`
  }

  return value.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  })
}

function ordinalDay(day: number) {
  const mod100 = day % 100
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`
  const mod10 = day % 10
  if (mod10 === 1) return `${day}st`
  if (mod10 === 2) return `${day}nd`
  if (mod10 === 3) return `${day}rd`
  return `${day}th`
}

function weekdayDayLabel(date: Date) {
  return {
    top: date.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase(),
    bottom: ordinalDay(date.getDate()),
  }
}

function channelName(sourceType: 'pos' | 'online', source?: string | null, subSource?: string | null) {
  if (sourceType === 'pos') return 'POS'
  return text(subSource) || text(source) || 'Online'
}

function normalisePayment(method: string | null): SalesEvent['paymentMethod'] {
  const value = text(method).toLowerCase()
  if (value === 'cash') return 'cash'
  if (value === 'card') return 'card'
  if (value) return 'online'
  return 'unknown'
}

function titleForItem(item?: ItemRow) {
  if (!item) return ''
  return item.final_title || item.ai_title || item.basic_title || item.sku
}

function roundedSalesMax(total: number) {
  if (total <= 0) return 500
  return Math.ceil((total + 1) / 100) * 100
}

const defaultPayrollSettings: PayrollSettings = {
  id: 'default',
  payroll_period: 'weekly',
  payroll_start_day: 1,
  payroll_start_date: null,
  holiday_year_start_month: 4,
  holiday_year_start_day: 1,
  default_holiday_method: 'fixed_weeks',
  default_holiday_weeks: 5.6,
  default_accrual_percent: 12.07,
}

const defaultPayrollStaffSettings: Required<PayrollStaffSettings> = {
  holiday_method: 'fixed_weeks',
  holiday_weeks: 5.6,
  accrual_percent: 12.07,
  carried_over_hours: 0,
  break_4h_minutes: 15,
  break_6h_minutes: 30,
}

function normalisePayrollStaffSettings(settings?: PayrollStaffSettings | null): Required<PayrollStaffSettings> {
  return {
    ...defaultPayrollStaffSettings,
    ...(settings || {}),
    holiday_method:
      settings?.holiday_method === 'accrual_percent' ? 'accrual_percent' : 'fixed_weeks',
    holiday_weeks: Number(settings?.holiday_weeks ?? defaultPayrollStaffSettings.holiday_weeks),
    accrual_percent: Number(settings?.accrual_percent ?? defaultPayrollStaffSettings.accrual_percent),
    carried_over_hours: Number(settings?.carried_over_hours ?? 0),
    break_4h_minutes: Number(settings?.break_4h_minutes ?? defaultPayrollStaffSettings.break_4h_minutes),
    break_6h_minutes: Number(settings?.break_6h_minutes ?? defaultPayrollStaffSettings.break_6h_minutes),
  }
}

function hours(value: number) {
  return `${(value || 0).toFixed(2)}h`
}

function parseDateInput(value: string) {
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? startOfToday() : parsed
}

function getPayrollRange(settings: PayrollSettings, anchor: Date) {
  if (settings.payroll_period === 'monthly') {
    const day = Math.max(1, Math.min(28, Number(settings.payroll_start_day || 1)))
    const start = new Date(anchor)
    start.setHours(0, 0, 0, 0)
    start.setDate(day)
    if (start > anchor) start.setMonth(start.getMonth() - 1)
    return { start, end: addMonths(start, 1) }
  }

  if (settings.payroll_period === 'biweekly') {
    const day = Number(settings.payroll_start_day || 1)
    const start = new Date(anchor)
    start.setHours(0, 0, 0, 0)
    const currentIsoDay = start.getDay() === 0 ? 7 : start.getDay()
    start.setDate(start.getDate() - ((currentIsoDay - day + 7) % 7))

    const epoch = new Date('2026-01-05T00:00:00')
    const diffWeeks = Math.floor((start.getTime() - epoch.getTime()) / (7 * 24 * 60 * 60 * 1000))
    if (diffWeeks % 2 !== 0) start.setDate(start.getDate() - 7)

    return { start, end: addDays(start, 14) }
  }

  const day = Number(settings.payroll_start_day || 1)
  const start = new Date(anchor)
  start.setHours(0, 0, 0, 0)
  const currentIsoDay = start.getDay() === 0 ? 7 : start.getDay()
  start.setDate(start.getDate() - ((currentIsoDay - day + 7) % 7))
  return { start, end: addDays(start, 7) }
}

function rangeLabel(start: Date, end: Date) {
  const inclusiveEnd = addDays(end, -1)
  return `${start.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} to ${inclusiveEnd.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`
}

function weekDate(weekId: string) {
  return parseDateInput(weekId)
}

function rowStaffTotals(row: RotaFinalisationRow) {
  if (row.totals?.staffTotals) return row.totals.staffTotals
  return row.totals || {}
}

function rowShifts(row: RotaFinalisationRow): FinalisedRotaShift[] {
  return Array.isArray(row.totals?.shifts) ? row.totals.shifts : []
}

function fixedWeeksAccrualRate(weeks: number) {
  return Math.max(0, weeks) / 52
}

function getHolidayYearRange(settings: PayrollSettings, anchor: Date) {
  const start = new Date(anchor)
  start.setHours(0, 0, 0, 0)
  start.setMonth(
    Math.max(0, Math.min(11, Number(settings.holiday_year_start_month || 4) - 1)),
    Math.max(1, Math.min(31, Number(settings.holiday_year_start_day || 1))),
  )
  if (start > anchor) start.setFullYear(start.getFullYear() - 1)

  const end = new Date(start)
  end.setFullYear(end.getFullYear() + 1)
  return { start, end }
}

function getHolidayYearStartForDate(settings: PayrollSettings, date: Date) {
  return getHolidayYearRange(settings, date).start
}

function canonicalLocationKey(value: string | null | undefined) {
  const key = text(value).toUpperCase().replace(/[\s_]+/g, '-')
  if (key === 'WAREHOUSE') return 'LOCATION-1'
  if (key === 'SHOP-1') return 'LOCATION-2'
  if (key === 'SHOP-2') return 'LOCATION-3'
  if (key === 'SHOP-3') return 'LOCATION-4'
  if (key === 'SHOP-4') return 'LOCATION-5'
  return key
}

type PayrollTotalsByStaff = Record<
  string,
  {
    staffId: string
    staffName: string
    workHours: number
    holidayHours: number
    breakHours: number
  }
>

type PayrollChartSegment = {
  key: string
  label: string
  labelTop?: string
  labelBottom?: string
  workHours: number
  holidayHours: number
  staffNames: string[]
  staffHours: Record<string, { staffName: string; workHours: number; holidayHours: number; preview: boolean }>
  hasPreviewHours: boolean
}

function payrollChartSegments(
  range: { start: Date; end: Date },
  viewMode: PayrollViewMode
): PayrollChartSegment[] {
  const segments: PayrollChartSegment[] = []

  if (viewMode === 'holiday_year') {
    for (let index = 0; index < 12; index += 1) {
      const start = addMonths(range.start, index)
      segments.push({
        key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
        label: start.toLocaleDateString('en-GB', { month: 'short' }),
        labelTop: start.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase(),
        labelBottom: String(start.getFullYear()),
        workHours: 0,
        holidayHours: 0,
        staffNames: [],
        staffHours: {},
        hasPreviewHours: false,
      })
    }

    return segments
  }

  for (let date = new Date(range.start); date < range.end; date = addDays(date, 1)) {
    const label = weekdayDayLabel(date)
    segments.push({
      key: dateKey(date),
      label: `${label.top} ${label.bottom}`,
      labelTop: label.top,
      labelBottom: label.bottom,
      workHours: 0,
      holidayHours: 0,
      staffNames: [],
      staffHours: {},
      hasPreviewHours: false,
    })
  }

  return segments
}

function payrollSegmentKey(date: Date, viewMode: PayrollViewMode) {
  if (viewMode === 'holiday_year') {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  }

  return dateKey(date)
}

function timeToMinutes(value?: string) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/)
  if (!match) return 0
  return Number(match[1]) * 60 + Number(match[2])
}

function rotaShiftHours(shift: RotaShift, staff?: StaffUser) {
  if (shift.type === 'holiday') {
    return { paidHours: num(shift.holidayHours), breakHours: 0 }
  }

  const start = timeToMinutes(shift.start)
  const end = timeToMinutes(shift.end)
  const rawMinutes = end >= start ? end - start : end + 24 * 60 - start
  const rawHours = Math.max(0, rawMinutes / 60)
  const settings = normalisePayrollStaffSettings(staff?.payroll_settings)
  const breakMinutes =
    rawHours >= 6
      ? settings.break_6h_minutes
      : rawHours > 3
        ? settings.break_4h_minutes
        : 0

  return { paidHours: Math.max(0, rawHours - breakMinutes / 60), breakHours: breakMinutes / 60 }
}

function calculateFinalisedPayrollTotals(
  finalisations: RotaFinalisationRow[],
  range: { start: Date; end: Date },
  companyKey: string,
  staffNameById: Record<string, string>
): PayrollTotalsByStaff {
  const rows: PayrollTotalsByStaff = {}
  const relevantWeeks = finalisations.filter((row) => {
    if (companyKey !== 'ALL' && row.company_key !== companyKey) return false
    const start = weekDate(row.week_id)
    const end = addDays(start, 7)
    return start < range.end && end > range.start
  })

  for (const finalisedWeek of relevantWeeks) {
    const shifts = rowShifts(finalisedWeek)

    if (finalisedWeek.totals?.staffTotals) {
      const totals = rowStaffTotals(finalisedWeek)

      for (const [staffId, total] of Object.entries<any>(totals)) {
        if (!rows[staffId]) {
          rows[staffId] = {
            staffId,
            staffName: staffNameById[staffId] || total?.name || 'Unknown staff',
            workHours: 0,
            holidayHours: 0,
            breakHours: 0,
          }
        }

        rows[staffId].workHours += num(total?.workHours)
        rows[staffId].holidayHours += num(total?.holidayHours)
        rows[staffId].breakHours += num(total?.breakHours)
      }
    } else if (shifts.length > 0) {
      for (const shift of shifts) {
        if (shift.date) {
          const shiftDate = parseDateInput(shift.date)
          if (shiftDate < range.start || shiftDate >= range.end) continue
        }

        if (!rows[shift.staffId]) {
          rows[shift.staffId] = {
            staffId: shift.staffId,
            staffName: shift.staffName || staffNameById[shift.staffId] || 'Unknown staff',
            workHours: 0,
            holidayHours: 0,
            breakHours: 0,
          }
        }

        const shiftHours = num(shift.paidHours ?? shift.hours)
        const breakHours = num(shift.breakHours)

        if (shift.type === 'holiday') {
          rows[shift.staffId].holidayHours += shiftHours
        } else {
          rows[shift.staffId].workHours += shiftHours
          rows[shift.staffId].breakHours += breakHours
        }
      }
    } else {
      const totals = rowStaffTotals(finalisedWeek)

      for (const [staffId, total] of Object.entries<any>(totals)) {
        if (!rows[staffId]) {
          rows[staffId] = {
            staffId,
            staffName: staffNameById[staffId] || total?.name || 'Unknown staff',
            workHours: 0,
            holidayHours: 0,
            breakHours: 0,
          }
        }

        rows[staffId].workHours += num(total?.workHours)
        rows[staffId].holidayHours += num(total?.holidayHours)
      }
    }
  }

  return rows
}

function accrualHoursForStaff(workHours: number, staff?: StaffUser) {
  const staffSettings = normalisePayrollStaffSettings(staff?.payroll_settings)
  const accrualRate =
    staffSettings.holiday_method === 'accrual_percent'
      ? staffSettings.accrual_percent / 100
      : fixedWeeksAccrualRate(staffSettings.holiday_weeks)

  return workHours * accrualRate
}

export default function ReportsPage() {
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([])
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([])
  const [posSales, setPosSales] = useState<PosSale[]>([])
  const [posLines, setPosLines] = useState<PosSaleLine[]>([])
  const [onlineSales, setOnlineSales] = useState<OnlineSale[]>([])
  const [itemsBySku, setItemsBySku] = useState<Record<string, ItemRow>>({})
  const [imageBySku, setImageBySku] = useState<Record<string, string>>({})
  const [stockRows, setStockRows] = useState<StockLocationRow[]>([])
  const [locations, setLocations] = useState<LocationRow[]>([])
  const [payrollSettings, setPayrollSettings] = useState<PayrollSettings>(defaultPayrollSettings)
  const [rotaFinalisations, setRotaFinalisations] = useState<RotaFinalisationRow[]>([])
  const [rotaPreviewPayload, setRotaPreviewPayload] = useState<RotaSettingsPayload | null>(null)
  const [holidayRollovers, setHolidayRollovers] = useState<HolidayRolloverRow[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [historyDays, setHistoryDays] = useState(14)
  const [activeReport, setActiveReport] = useState<ReportView>('sales')
  const [salesPeriod, setSalesPeriod] = useState<SalesPeriod>('day')
  const [salesAnchor, setSalesAnchor] = useState(() => startOfToday())
  const [floorLocation, setFloorLocation] = useState('LOCATION-2')
  const [floorCategory, setFloorCategory] = useState('ALL')
  const [floorSubCategory, setFloorSubCategory] = useState('ALL')
  const [payrollAnchor, setPayrollAnchor] = useState(() => startOfToday())
  const [selectedPayrollStaffId, setSelectedPayrollStaffId] = useState('ALL')
  const [selectedPayrollCompany, setSelectedPayrollCompany] = useState('ALL')
  const [payrollViewMode, setPayrollViewMode] = useState<PayrollViewMode>('period')
  const [activePayrollTooltipKey, setActivePayrollTooltipKey] = useState<string | null>(null)
  const [pinnedPayrollTooltipKey, setPinnedPayrollTooltipKey] = useState<string | null>(null)
  const [payrollTooltipPosition, setPayrollTooltipPosition] = useState<{ x: number; y: number } | null>(null)
  const payrollTooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetchReports()
  }, [])

  useEffect(() => {
    return () => {
      if (payrollTooltipTimer.current) clearTimeout(payrollTooltipTimer.current)
    }
  }, [])

  function clearPayrollTooltipTimer() {
    if (payrollTooltipTimer.current) {
      clearTimeout(payrollTooltipTimer.current)
      payrollTooltipTimer.current = null
    }
  }

  function tooltipPositionForElement(element: HTMLElement) {
    const rect = element.getBoundingClientRect()
    const x = Math.min(Math.max(rect.left + rect.width / 2, 104), window.innerWidth - 104)
    const y = Math.max(rect.top - 10, 86)
    return { x, y }
  }

  function queuePayrollTooltip(key: string, element: HTMLElement) {
    clearPayrollTooltipTimer()
    payrollTooltipTimer.current = setTimeout(() => {
      setPinnedPayrollTooltipKey(null)
      setPayrollTooltipPosition(tooltipPositionForElement(element))
      setActivePayrollTooltipKey(key)
      payrollTooltipTimer.current = null
    }, 400)
  }

  function hidePayrollTooltip(key: string) {
    clearPayrollTooltipTimer()
    if (pinnedPayrollTooltipKey === key) return
    setActivePayrollTooltipKey((current) => (current === key ? null : current))
    setPayrollTooltipPosition(null)
  }

  async function fetchReports() {
    setLoading(true)
    setMessage('')

    try {
      const since = new Date()
      since.setDate(since.getDate() - 120)
      since.setHours(0, 0, 0, 0)
      const { data: sessionData } = await supabase.auth.getSession()
      const rotaUserKey = sessionData.session?.user?.id ? `rota:${sessionData.session.user.id}` : 'rota:default'

      const [
        staffResult,
        itemResult,
        posSaleResult,
        onlineSaleResult,
        stockResult,
        locationResult,
        payrollSettingsResult,
        rotaFinalisationResult,
        rotaSettingsResult,
        holidayRolloverResult,
      ] = await Promise.all([
        supabase.from('staff_users').select('id, name, is_active, payroll_settings').order('name', { ascending: true }),
        supabase
          .from('items')
          .select('id, sku, status, sent_to_review_at, sent_to_review_by')
          .not('sent_to_review_at', 'is', null)
          .order('sent_to_review_at', { ascending: false })
          .limit(1000),
        supabase
          .from('pos_sales')
          .select('id, sale_number, mode, payment_method, subtotal, discount_amount, total, status, checkout_location, created_at')
          .gte('created_at', since.toISOString())
          .order('created_at', { ascending: false })
          .limit(2000),
        supabase
          .from('linnworks_processed_sales')
          .select('id, sku, quantity, source, sub_source, current_status, processed_at, updated_at')
          .order('updated_at', { ascending: false })
          .limit(2000),
        supabase
          .from('item_stock_locations')
          .select('item_id, sku, location_name, bin_code, stock_level')
          .order('location_name', { ascending: true })
          .limit(5000),
        supabase
          .from('locations')
          .select('name, label, is_active')
          .order('name', { ascending: true }),
        supabase
          .from('payroll_settings')
          .select('*')
          .eq('id', 'default')
          .maybeSingle(),
        supabase
          .from('rota_week_finalisations')
          .select('id, company_key, week_id, status, totals, finalised_at')
          .eq('status', 'finalised')
          .order('week_id', { ascending: false })
          .limit(260),
        supabase
          .from('rota_settings')
          .select('data')
          .eq('user_key', rotaUserKey)
          .maybeSingle(),
        supabase
          .from('staff_holiday_year_rollovers')
          .select(
            'id, staff_id, company_key, holiday_year_start, holiday_year_end, carried_over_hours, source_holiday_year_start, source_holiday_year_end, source_accrued_hours, source_taken_hours, source_closing_balance_hours'
          )
          .order('holiday_year_start', { ascending: false })
          .limit(1000),
      ])

      if (staffResult.error) throw new Error(staffResult.error.message)
      if (itemResult.error) throw new Error(itemResult.error.message)
      if (posSaleResult.error) throw new Error(posSaleResult.error.message)
      if (onlineSaleResult.error) throw new Error(onlineSaleResult.error.message)
      if (stockResult.error) throw new Error(stockResult.error.message)
      if (locationResult.error) throw new Error(locationResult.error.message)
      if (payrollSettingsResult.error) throw new Error(payrollSettingsResult.error.message)
      if (rotaFinalisationResult.error) throw new Error(rotaFinalisationResult.error.message)
      if (rotaSettingsResult.error) throw new Error(rotaSettingsResult.error.message)
      if (holidayRolloverResult.error) {
        const missingRolloverTable =
          String(holidayRolloverResult.error.message || '').includes('staff_holiday_year_rollovers')
        if (!missingRolloverTable) throw new Error(holidayRolloverResult.error.message)
      }

      let rotaPreviewData = (rotaSettingsResult.data as any)?.data || null
      if (!rotaPreviewData && rotaUserKey !== 'rota:default') {
        const legacyRotaResult = await supabase
          .from('rota_settings')
          .select('data')
          .eq('user_key', 'dohpe_global_rota')
          .maybeSingle()

        if (legacyRotaResult.error) throw new Error(legacyRotaResult.error.message)
        rotaPreviewData = (legacyRotaResult.data as any)?.data || null
      }

      const sales = (posSaleResult.data || []) as PosSale[]
      const saleIds = sales.map((sale) => sale.id)

      const lineResult =
        saleIds.length > 0
          ? await supabase
              .from('pos_sale_lines')
              .select('id, sale_id, sku, title, brand, reporting_category, sub_category, sub_type, quantity, unit_price, line_total')
              .in('sale_id', saleIds)
              .limit(5000)
          : { data: [], error: null }

      if (lineResult.error) throw new Error(lineResult.error.message)

      const allSkus = Array.from(
        new Set(
          [
            ...((lineResult.data || []) as PosSaleLine[]).map((line) => line.sku),
            ...((onlineSaleResult.data || []) as OnlineSale[]).map((sale) => sale.sku),
            ...((stockResult.data || []) as StockLocationRow[]).map((row) => row.sku || ''),
          ]
            .map((sku) => text(sku).toUpperCase())
            .filter(Boolean)
        )
      )

      const itemRows: ItemRow[] = []
      for (let index = 0; index < allSkus.length; index += 500) {
        const chunk = allSkus.slice(index, index + 500)
        const rows = await supabase
          .from('items')
          .select('id, sku, brand, reporting_category, sub_category, sub_type, final_title, ai_title, basic_title, selling_price')
          .in('sku', chunk)

        if (rows.error) throw new Error(rows.error.message)
        itemRows.push(...((rows.data || []) as ItemRow[]))
      }

      const imageRows: ItemImage[] = []
      const itemIds = itemRows.map((item) => item.id).filter(Boolean)
      for (let index = 0; index < itemIds.length; index += 500) {
        const chunk = itemIds.slice(index, index + 500)
        const rows = await supabase
          .from('item_images')
          .select('item_id, processed_url, original_url, image_order')
          .in('item_id', chunk)
          .order('image_order', { ascending: true })

        if (rows.error) throw new Error(rows.error.message)
        imageRows.push(...((rows.data || []) as ItemImage[]))
      }

      const nextItemsBySku: Record<string, ItemRow> = {}
      for (const item of itemRows) {
        nextItemsBySku[text(item.sku).toUpperCase()] = item
      }

      const itemIdToSku: Record<string, string> = {}
      for (const item of itemRows) itemIdToSku[item.id] = text(item.sku).toUpperCase()

      const nextImageBySku: Record<string, string> = {}
      for (const image of imageRows) {
        if (!image.item_id) continue
        const sku = itemIdToSku[image.item_id]
        if (!sku || nextImageBySku[sku]) continue
        nextImageBySku[sku] = image.processed_url || image.original_url || ''
      }

      setStaffUsers(
        ((staffResult.data || []) as StaffUser[]).map((staff) => ({
          ...staff,
          payroll_settings: normalisePayrollStaffSettings(staff.payroll_settings),
        }))
      )
      setReviewItems(itemResult.data || [])
      setPosSales(sales)
      setPosLines((lineResult.data || []) as PosSaleLine[])
      setOnlineSales((onlineSaleResult.data || []) as OnlineSale[])
      setItemsBySku(nextItemsBySku)
      setImageBySku(nextImageBySku)
      setStockRows((stockResult.data || []) as StockLocationRow[])
      setLocations((locationResult.data || []) as LocationRow[])
      setPayrollSettings({
        ...defaultPayrollSettings,
        ...(payrollSettingsResult.data || {}),
        payroll_period: ((payrollSettingsResult.data as any)?.payroll_period || 'weekly') as PayrollPeriod,
        default_holiday_method: ((payrollSettingsResult.data as any)?.default_holiday_method || 'fixed_weeks') as HolidayMethod,
      })
      setRotaFinalisations((rotaFinalisationResult.data || []) as RotaFinalisationRow[])
      setRotaPreviewPayload((rotaPreviewData || null) as RotaSettingsPayload | null)
      setHolidayRollovers((holidayRolloverResult.data || []) as HolidayRolloverRow[])
    } catch (error: any) {
      setMessage(error.message || 'Could not load reports.')
    } finally {
      setLoading(false)
    }
  }

  const staffNameById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const staff of staffUsers) map[staff.id] = staff.name
    return map
  }, [staffUsers])

  const staffById = useMemo(() => {
    const map: Record<string, StaffUser> = {}
    for (const staff of staffUsers) map[staff.id] = staff
    return map
  }, [staffUsers])

  const staffReportRows = useMemo(() => {
    const today = startOfToday()
    const week = startOfWeek()
    const month = startOfMonth()
    const rows: Record<string, StaffReportRow> = {}

    for (const staff of staffUsers.filter((user) => user.is_active !== false)) {
      rows[staff.id] = {
        staffId: staff.id,
        staffName: staff.name,
        todayCount: 0,
        weekCount: 0,
        monthCount: 0,
        totalCount: 0,
      }
    }

    for (const item of reviewItems) {
      const staffId = item.sent_to_review_by || 'unknown'
      if (!rows[staffId]) {
        rows[staffId] = {
          staffId,
          staffName: staffNameById[staffId] || 'Unknown staff',
          todayCount: 0,
          weekCount: 0,
          monthCount: 0,
          totalCount: 0,
        }
      }

      rows[staffId].totalCount += 1
      if (isOnOrAfter(item.sent_to_review_at, today)) rows[staffId].todayCount += 1
      if (isOnOrAfter(item.sent_to_review_at, week)) rows[staffId].weekCount += 1
      if (isOnOrAfter(item.sent_to_review_at, month)) rows[staffId].monthCount += 1
    }

    return Object.values(rows)
      .filter((row) => row.totalCount > 0 || row.todayCount > 0)
      .sort((a, b) => b.todayCount - a.todayCount || b.weekCount - a.weekCount)
  }, [reviewItems, staffUsers, staffNameById])

  const salesById = useMemo(() => {
    const map: Record<string, PosSale> = {}
    for (const sale of posSales) map[sale.id] = sale
    return map
  }, [posSales])

  const salesEvents = useMemo(() => {
    const events: SalesEvent[] = []

    for (const line of posLines) {
      const sale = salesById[line.sale_id]
      if (!sale || !sale.created_at) continue
      if (text(sale.status).toLowerCase() && text(sale.status).toLowerCase() !== 'completed') continue

      const sku = text(line.sku).toUpperCase()
      const item = itemsBySku[sku]
      const amount = num(line.line_total)

      events.push({
        id: `pos-${line.id}`,
        sourceType: 'pos',
        channel: 'POS',
        paymentMethod: normalisePayment(sale.payment_method),
        sku,
        title: text(line.title) || titleForItem(item) || sku,
        brand: text(line.brand || item?.brand) || 'Unknown',
        category: text(line.reporting_category || item?.reporting_category) || 'Uncategorised',
        subCategory: text(line.sub_category || item?.sub_category) || 'Unspecified',
        quantity: num(line.quantity),
        amount,
        occurredAt: new Date(sale.created_at),
        location: text(sale.checkout_location) || 'POS',
        imageUrl: imageBySku[sku] || '',
        estimated: false,
      })
    }

    for (const sale of onlineSales) {
      const sku = text(sale.sku).toUpperCase()
      const item = itemsBySku[sku]
      const quantity = num(sale.quantity) || 1
      const amount = num(item?.selling_price) * quantity
      const occurredAt = new Date(sale.processed_at || sale.updated_at || '')
      if (Number.isNaN(occurredAt.getTime())) continue
      if (text(sale.current_status).toLowerCase() === 'cancelled') continue

      events.push({
        id: `online-${sale.id}`,
        sourceType: 'online',
        channel: channelName('online', sale.source, sale.sub_source),
        paymentMethod: 'online',
        sku,
        title: titleForItem(item) || sku,
        brand: text(item?.brand) || 'Unknown',
        category: text(item?.reporting_category) || 'Uncategorised',
        subCategory: text(item?.sub_category) || 'Unspecified',
        quantity,
        amount,
        occurredAt,
        location: 'Online',
        imageUrl: imageBySku[sku] || '',
        estimated: true,
      })
    }

    return events.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
  }, [imageBySku, itemsBySku, onlineSales, posLines, salesById])

  const periodRange = useMemo(
    () => getPeriodRange(salesPeriod, salesAnchor),
    [salesPeriod, salesAnchor]
  )

  const periodEvents = useMemo(() => {
    return salesEvents.filter(
      (event) => event.occurredAt >= periodRange.start && event.occurredAt < periodRange.end
    )
  }, [periodRange, salesEvents])

  const salesSummary = useMemo(() => {
    const total = periodEvents.reduce((sum, event) => sum + event.amount, 0)
    const units = periodEvents.reduce((sum, event) => sum + event.quantity, 0)
    const cash = periodEvents
      .filter((event) => event.paymentMethod === 'cash')
      .reduce((sum, event) => sum + event.amount, 0)
    const card = periodEvents
      .filter((event) => event.paymentMethod === 'card')
      .reduce((sum, event) => sum + event.amount, 0)
    const online = periodEvents
      .filter((event) => event.paymentMethod === 'online')
      .reduce((sum, event) => sum + event.amount, 0)
    const estimated = periodEvents.some((event) => event.estimated)

    return { total, units, cash, card, online, estimated }
  }, [periodEvents])

  const graphRows = useMemo(() => {
    const groups: Record<
      string,
      { label: string; labelTop?: string; labelBottom?: string; amount: number; units: number }
    > = {}

    if (salesPeriod === 'day') {
      for (let hour = 0; hour < 24; hour += 1) {
        const label = `${String(hour).padStart(2, '0')}:00`
        groups[label] = { label, amount: 0, units: 0 }
      }
    } else {
      const days = Math.round((periodRange.end.getTime() - periodRange.start.getTime()) / 86400000)
      for (let index = 0; index < days; index += 1) {
        const date = addDays(periodRange.start, index)
        const label = eventKey(salesPeriod, date)
        const dateLabel = weekdayDayLabel(date)
        groups[label] = {
          label,
          labelTop: dateLabel.top,
          labelBottom: dateLabel.bottom,
          amount: 0,
          units: 0,
        }
      }
    }

    for (const event of periodEvents) {
      const key = eventKey(salesPeriod, event.occurredAt)
      if (!groups[key]) groups[key] = { label: key, amount: 0, units: 0 }
      groups[key].amount += event.amount
      groups[key].units += event.quantity
    }

    return Object.values(groups)
  }, [periodEvents, periodRange, salesPeriod])

  const graphMax = roundedSalesMax(salesSummary.total)
  const yAxisTicks = [graphMax, Math.round(graphMax * 0.75), Math.round(graphMax * 0.5), Math.round(graphMax * 0.25), 0]

  const channelRows = useMemo(() => {
    const rows: Record<string, { channel: string; amount: number; units: number }> = {}
    for (const event of periodEvents) {
      if (!rows[event.channel]) rows[event.channel] = { channel: event.channel, amount: 0, units: 0 }
      rows[event.channel].amount += event.amount
      rows[event.channel].units += event.quantity
    }
    return Object.values(rows).sort((a, b) => b.amount - a.amount)
  }, [periodEvents])

  const categoryOptions = useMemo(() => {
    const set = new Set<string>()
    for (const row of stockRows) {
      const sku = text(row.sku).toUpperCase()
      const item = itemsBySku[sku]
      const category = text(item?.reporting_category)
      if (category) set.add(category)
    }
    return Array.from(set).sort()
  }, [itemsBySku, stockRows])

  const subCategoryOptions = useMemo(() => {
    const set = new Set<string>()
    for (const row of stockRows) {
      const sku = text(row.sku).toUpperCase()
      const item = itemsBySku[sku]
      const category = text(item?.reporting_category)
      const subCategory = text(item?.sub_category)
      if (floorCategory !== 'ALL' && category !== floorCategory) continue
      if (subCategory) set.add(subCategory)
    }
    return Array.from(set).sort()
  }, [floorCategory, itemsBySku, stockRows])

  const locationLabels = useMemo(() => {
    const map: Record<string, string> = { ...DEFAULT_LOCATION_LABELS }
    for (const location of locations) {
      const key = text(location.name).toUpperCase().replace(/[\s_]+/g, '-')
      map[key] = text(location.label) || DEFAULT_LOCATION_LABELS[key] || text(location.name)
      map[canonicalLocationKey(location.label)] = map[key]
    }
    return map
  }, [locations])

  function displayLocation(locationName: string | null | undefined) {
    const key = canonicalLocationKey(locationName)
    return locationLabels[key] || DEFAULT_LOCATION_LABELS[key] || key || '-'
  }

  const floorStockRows = useMemo(() => {
    return stockRows
      .map((row) => {
        const sku = text(row.sku).toUpperCase()
        const item = itemsBySku[sku]
        return {
          row,
          item,
          category: text(item?.reporting_category) || 'Uncategorised',
          subCategory: text(item?.sub_category) || 'Unspecified',
        }
      })
      .filter(({ row, category, subCategory }) => {
        if (canonicalLocationKey(row.location_name) !== canonicalLocationKey(floorLocation)) return false
        if (floorCategory !== 'ALL' && category !== floorCategory) return false
        if (floorSubCategory !== 'ALL' && subCategory !== floorSubCategory) return false
        return true
      })
  }, [floorCategory, floorLocation, floorSubCategory, itemsBySku, stockRows])

  const floorSummary = useMemo(() => {
    const totalQty = floorStockRows.reduce((sum, entry) => sum + num(entry.row.stock_level), 0)
    const byCategory: Record<string, number> = {}
    const bySubCategory: Record<string, number> = {}

    for (const entry of floorStockRows) {
      const qty = num(entry.row.stock_level)
      byCategory[entry.category] = (byCategory[entry.category] || 0) + qty
      bySubCategory[entry.subCategory] = (bySubCategory[entry.subCategory] || 0) + qty
    }

    const soldInPeriod = periodEvents
      .filter((event) => {
        if (floorCategory !== 'ALL' && event.category !== floorCategory) return false
        if (floorSubCategory !== 'ALL' && event.subCategory !== floorSubCategory) return false
        return true
      })
      .reduce((sum, event) => sum + event.quantity, 0)

    return { totalQty, byCategory, bySubCategory, soldInPeriod }
  }, [floorCategory, floorStockRows, floorSubCategory, periodEvents])

  const historyItems = useMemo(() => {
    const since = new Date()
    since.setDate(since.getDate() - historyDays)
    since.setHours(0, 0, 0, 0)
    return reviewItems.filter((item) => isOnOrAfter(item.sent_to_review_at, since))
  }, [reviewItems, historyDays])

  const historyByDate = useMemo(() => {
    const grouped: Record<string, Record<string, number>> = {}

    for (const item of historyItems) {
      if (!item.sent_to_review_at) continue
      const dateKey = new Date(item.sent_to_review_at).toLocaleDateString('en-GB', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
      })
      const staffId = item.sent_to_review_by || 'unknown'
      const staffName = staffNameById[staffId] || 'Unknown staff'
      if (!grouped[dateKey]) grouped[dateKey] = {}
      grouped[dateKey][staffName] = (grouped[dateKey][staffName] || 0) + 1
    }

    return grouped
  }, [historyItems, staffNameById])

  const totalToday = staffReportRows.reduce((sum, row) => sum + row.todayCount, 0)
  const totalWeek = staffReportRows.reduce((sum, row) => sum + row.weekCount, 0)
  const totalMonth = staffReportRows.reduce((sum, row) => sum + row.monthCount, 0)

  const staffPerformanceRows = useMemo(() => {
    const dayCount = Math.max(1, historyDays)

    return staffReportRows.map((row) => ({
      ...row,
      averagePerDay: row.totalCount / dayCount,
      estimatedPerHour: row.todayCount / 7,
    }))
  }, [historyDays, staffReportRows])

  const payrollRange = useMemo(
    () =>
      payrollViewMode === 'holiday_year'
        ? getHolidayYearRange(payrollSettings, payrollAnchor)
        : getPayrollRange(payrollSettings, payrollAnchor),
    [payrollAnchor, payrollSettings, payrollViewMode]
  )

  const payrollCompanyOptions = useMemo(() => {
    const companies = Array.from(new Set(rotaFinalisations.map((row) => row.company_key).filter(Boolean)))
    return companies.sort((a, b) => a.localeCompare(b))
  }, [rotaFinalisations])

  const holidayYearStartKey = useMemo(
    () => dateKey(getHolidayYearStartForDate(payrollSettings, payrollRange.start)),
    [payrollRange.start, payrollSettings]
  )

  const rolloverOverridesByYearStaff = useMemo(() => {
    const rows: Record<string, { hours: number; companies: string[] }> = {}
    for (const rollover of holidayRollovers) {
      if (selectedPayrollCompany !== 'ALL' && rollover.company_key !== selectedPayrollCompany) continue
      const key = `${rollover.holiday_year_start}:${rollover.staff_id}`
      if (!rows[key]) rows[key] = { hours: 0, companies: [] }
      rows[key].hours += num(rollover.carried_over_hours)
      rows[key].companies.push(rollover.company_key)
    }
    return rows
  }, [holidayRollovers, selectedPayrollCompany])

  const automaticCarryByStaff = useMemo(() => {
    const currentHolidayYearStart = parseDateInput(holidayYearStartKey)
    const previousStart = addMonths(currentHolidayYearStart, -12)
    const previousRange = { start: previousStart, end: currentHolidayYearStart }
    const previousTotals = calculateFinalisedPayrollTotals(
      rotaFinalisations,
      previousRange,
      selectedPayrollCompany,
      staffNameById
    )
    const carry: Record<string, number> = {}

    for (const staff of staffUsers.filter((user) => user.is_active !== false)) {
      const totals = previousTotals[staff.id]
      const previousOverrideKey = `${dateKey(previousStart)}:${staff.id}`
      const previousCarried = rolloverOverridesByYearStaff[previousOverrideKey]?.hours || 0
      const previousAccrued = accrualHoursForStaff(totals?.workHours || 0, staff)
      const previousTaken = totals?.holidayHours || 0
      carry[staff.id] = Math.max(0, previousCarried + previousAccrued - previousTaken)
    }

    for (const [staffId, totals] of Object.entries(previousTotals)) {
      if (carry[staffId] !== undefined) continue
      const previousOverrideKey = `${dateKey(previousStart)}:${staffId}`
      const previousCarried = rolloverOverridesByYearStaff[previousOverrideKey]?.hours || 0
      carry[staffId] = Math.max(0, previousCarried - totals.holidayHours)
    }

    return carry
  }, [holidayYearStartKey, rotaFinalisations, rolloverOverridesByYearStaff, selectedPayrollCompany, staffNameById, staffUsers])

  const payrollRows = useMemo(() => {
    const rows: Record<string, PayrollReportRow> = {}
    const currentTotals = calculateFinalisedPayrollTotals(
      rotaFinalisations,
      payrollRange,
      selectedPayrollCompany,
      staffNameById
    )

    for (const staff of staffUsers.filter((user) => user.is_active !== false)) {
      const overrideKey = `${holidayYearStartKey}:${staff.id}`
      const override = rolloverOverridesByYearStaff[overrideKey]
      const carriedOverHours = override?.hours ?? automaticCarryByStaff[staff.id] ?? 0
      rows[staff.id] = {
        staffId: staff.id,
        staffName: staff.name,
        workHours: currentTotals[staff.id]?.workHours || 0,
        holidayHours: currentTotals[staff.id]?.holidayHours || 0,
        breakHours: currentTotals[staff.id]?.breakHours || 0,
        paidHours: 0,
        holidayAccruedHours: 0,
        carriedOverHours,
        autoCarriedOverHours: automaticCarryByStaff[staff.id] || 0,
        carriedOverOverridden: Boolean(override),
        holidayBalanceHours: carriedOverHours,
      }
    }

    for (const [staffId, totals] of Object.entries(currentTotals)) {
      if (rows[staffId]) continue
      const overrideKey = `${holidayYearStartKey}:${staffId}`
      const override = rolloverOverridesByYearStaff[overrideKey]
      const carriedOverHours = override?.hours ?? automaticCarryByStaff[staffId] ?? 0
      rows[staffId] = {
        staffId,
        staffName: totals.staffName,
        workHours: totals.workHours,
        holidayHours: totals.holidayHours,
        breakHours: totals.breakHours,
        paidHours: 0,
        holidayAccruedHours: 0,
        carriedOverHours,
        autoCarriedOverHours: automaticCarryByStaff[staffId] || 0,
        carriedOverOverridden: Boolean(override),
        holidayBalanceHours: carriedOverHours,
      }
    }

    for (const row of Object.values(rows)) {
      const staff = staffUsers.find((person) => person.id === row.staffId)
      const paidWorkHours = row.workHours

      row.paidHours = paidWorkHours + row.holidayHours
      row.holidayAccruedHours = accrualHoursForStaff(paidWorkHours, staff)
      row.holidayBalanceHours = row.carriedOverHours + row.holidayAccruedHours - row.holidayHours
    }

    return Object.values(rows)
      .filter((row) => selectedPayrollStaffId === 'ALL' || row.staffId === selectedPayrollStaffId)
      .sort((a, b) => a.staffName.localeCompare(b.staffName))
  }, [
    automaticCarryByStaff,
    holidayYearStartKey,
    payrollRange,
    rotaFinalisations,
    rolloverOverridesByYearStaff,
    selectedPayrollCompany,
    selectedPayrollStaffId,
    staffNameById,
    staffUsers,
  ])

  const payrollSummary = useMemo(
    () =>
      payrollRows.reduce(
        (sum, row) => ({
          workHours: sum.workHours + row.workHours,
          breakHours: sum.breakHours + row.breakHours,
          paidHours: sum.paidHours + row.paidHours,
          holidayAccruedHours: sum.holidayAccruedHours + row.holidayAccruedHours,
          holidayHours: sum.holidayHours + row.holidayHours,
        }),
        {
          workHours: 0,
          breakHours: 0,
          paidHours: 0,
          holidayAccruedHours: 0,
          holidayHours: 0,
        }
      ),
    [payrollRows]
  )

  const payrollChartRows = useMemo(() => {
    const segments = payrollChartSegments(payrollRange, payrollViewMode)
    const byKey: Record<string, PayrollChartSegment> = Object.fromEntries(
      segments.map((segment) => [segment.key, segment])
    )
    const staffMatches = (staffId: string) =>
      selectedPayrollStaffId === 'ALL' || staffId === selectedPayrollStaffId
    const addHours = (
      segment: PayrollChartSegment,
      staffId: string,
      staffName: string,
      type: 'work' | 'holiday',
      value: number,
      preview = false
    ) => {
      if (value <= 0) return
      if (!segment.staffHours[staffId]) {
        segment.staffHours[staffId] = { staffName, workHours: 0, holidayHours: 0, preview: false }
      }
      if (!segment.staffNames.includes(staffName)) segment.staffNames.push(staffName)
      if (type === 'holiday') {
        segment.holidayHours += value
        segment.staffHours[staffId].holidayHours += value
      } else {
        segment.workHours += value
        segment.staffHours[staffId].workHours += value
      }
      if (preview) {
        segment.hasPreviewHours = true
        segment.staffHours[staffId].preview = true
      }
    }

    const relevantWeeks = rotaFinalisations.filter((row) => {
      if (selectedPayrollCompany !== 'ALL' && row.company_key !== selectedPayrollCompany) return false
      const start = weekDate(row.week_id)
      const end = addDays(start, 7)
      return start < payrollRange.end && end > payrollRange.start
    })

    for (const finalisedWeek of relevantWeeks) {
      const shifts = rowShifts(finalisedWeek)

      if (shifts.length > 0) {
        for (const shift of shifts) {
          if (!staffMatches(shift.staffId)) continue
          const shiftDate = shift.date ? parseDateInput(shift.date) : weekDate(finalisedWeek.week_id)
          if (shiftDate < payrollRange.start || shiftDate >= payrollRange.end) continue
          const segment = byKey[payrollSegmentKey(shiftDate, payrollViewMode)]
          if (!segment) continue

          if (shift.type === 'holiday') {
            addHours(
              segment,
              shift.staffId,
              shift.staffName || staffNameById[shift.staffId] || 'Unknown',
              'holiday',
              num(shift.paidHours ?? shift.hours)
            )
          } else {
            addHours(
              segment,
              shift.staffId,
              shift.staffName || staffNameById[shift.staffId] || 'Unknown',
              'work',
              num(shift.paidHours ?? shift.hours)
            )
          }
        }
      }
    }

    const previewEnd = addDays(startOfToday(), 1)
    const previewCompanies =
      selectedPayrollCompany === 'ALL' ? ['dohpe', 'dlretail'] : [selectedPayrollCompany]
    const finalisedWeekKeys = new Set(
      rotaFinalisations.map((row) => `${row.company_key}:${row.week_id}`)
    )

    if (rotaPreviewPayload) {
      const effectiveEnd = payrollRange.end < previewEnd ? payrollRange.end : previewEnd

      for (let date = new Date(payrollRange.start); date < effectiveEnd; date = addDays(date, 1)) {
        const week = startOfWeek(date)
        const weekId = dateKey(week)
        const dayId = dateKey(date)
        const dayIndex = Math.round((date.getTime() - week.getTime()) / 86400000)
        const segment = byKey[payrollSegmentKey(date, payrollViewMode)]
        if (!segment) continue

        for (const company of previewCompanies) {
          if (finalisedWeekKeys.has(`${company}:${weekId}`)) continue
          if (rotaPreviewPayload.closedDays?.[company]?.[dayId]) continue

          const edited = rotaPreviewPayload.editedWeeks?.[company]?.[weekId]
          const savedDay = rotaPreviewPayload.rota?.[company]?.[weekId]?.[dayId] || []
          const defaultDay = rotaPreviewPayload.defaultRota?.[company]?.[String(dayIndex)] || []
          const shifts = edited ? savedDay : defaultDay.length > 0 ? defaultDay : savedDay

          for (const shift of shifts) {
            if (!shift.staffId || !staffMatches(shift.staffId)) continue
            const staff = staffById[shift.staffId]
            const { paidHours } = rotaShiftHours(shift, staff)
            addHours(
              segment,
              shift.staffId,
              staff?.name || staffNameById[shift.staffId] || 'Unknown',
              shift.type,
              paidHours,
              true
            )
          }
        }
      }
    }

    return segments
  }, [
    payrollRange,
    payrollViewMode,
    rotaPreviewPayload,
    rotaFinalisations,
    selectedPayrollCompany,
    selectedPayrollStaffId,
    staffById,
    staffNameById,
  ])

  const activePayrollTooltipRow = useMemo(
    () => payrollChartRows.find((row) => row.key === activePayrollTooltipKey) || null,
    [activePayrollTooltipKey, payrollChartRows]
  )

  const activePayrollTooltipStaffRows = useMemo(
    () =>
      activePayrollTooltipRow
        ? Object.entries(activePayrollTooltipRow.staffHours)
            .map(([staffId, row]) => ({ staffId, ...row }))
            .sort((a, b) => a.staffName.localeCompare(b.staffName))
        : [],
    [activePayrollTooltipRow]
  )

  const payrollChartMax = useMemo(() => {
    const maxValue = payrollChartRows.reduce(
      (max, row) => Math.max(max, row.workHours + row.holidayHours),
      0
    )
    return maxValue <= 0 ? 10 : Math.ceil((maxValue + 0.01) / 10) * 10
  }, [payrollChartRows])

  const payrollYAxisTicks = useMemo(
    () => [
      payrollChartMax,
      Math.round(payrollChartMax * 0.75),
      Math.round(payrollChartMax * 0.5),
      Math.round(payrollChartMax * 0.25),
      0,
    ],
    [payrollChartMax]
  )

  const reportMenu: { key: ReportView; label: string; detail: string }[] = [
    { key: 'sales', label: 'Sales', detail: `${money(salesSummary.total)} / ${salesSummary.units} units` },
    { key: 'stock', label: 'Stock on floor', detail: `${floorSummary.totalQty} items at location` },
    { key: 'staff', label: 'Staff cataloguing', detail: `${totalToday} today / ${totalWeek} this week` },
    { key: 'payroll', label: 'Payroll & holiday', detail: `${hours(payrollSummary.paidHours)} paid` },
    { key: 'profit', label: 'Profit and loss', detail: 'Fixed costs and wages' },
  ]

  function moveSalesPeriod(direction: -1 | 1) {
    setSalesAnchor((current) => {
      if (salesPeriod === 'day') return addDays(current, direction)
      if (salesPeriod === 'week') return addDays(current, direction * 7)
      return addMonths(current, direction)
    })
  }

  function movePayrollPeriod(direction: -1 | 1) {
    setPayrollAnchor((current) => {
      if (payrollViewMode === 'holiday_year') return addMonths(current, direction * 12)
      if (payrollSettings.payroll_period === 'weekly') return addDays(current, direction * 7)
      if (payrollSettings.payroll_period === 'biweekly') return addDays(current, direction * 14)
      return addMonths(current, direction)
    })
  }

  async function saveCarriedOverOverride(row: PayrollReportRow, value: string) {
    if (selectedPayrollCompany === 'ALL') {
      setMessage('Select one company before editing carried holiday.')
      return
    }

    const carriedHours = Number(value)
    if (!Number.isFinite(carriedHours) || carriedHours < 0) {
      setMessage('Carried holiday must be a positive number of hours.')
      return
    }

    const holidayYearStart = parseDateInput(holidayYearStartKey)
    const holidayYearEnd = addMonths(holidayYearStart, 12)
    const sourceStart = addMonths(holidayYearStart, -12)
    const sourceEnd = holidayYearStart
    const payload = {
      staff_id: row.staffId,
      company_key: selectedPayrollCompany,
      holiday_year_start: dateKey(holidayYearStart),
      holiday_year_end: dateKey(holidayYearEnd),
      carried_over_hours: carriedHours,
      source_holiday_year_start: dateKey(sourceStart),
      source_holiday_year_end: dateKey(sourceEnd),
      source_accrued_hours: Number(row.autoCarriedOverHours || 0),
      source_taken_hours: 0,
      source_closing_balance_hours: carriedHours,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase
      .from('staff_holiday_year_rollovers')
      .upsert([payload], {
        onConflict: 'staff_id,company_key,holiday_year_start',
      })

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage('Carried holiday override saved.')
    fetchReports()
  }

  return (
    <StaffPermissionGate permission="reports">
      <main className="min-h-screen bg-zinc-950 p-5 text-white">
        <div className="app-header mb-5 flex flex-wrap items-start justify-between gap-4 rounded-3xl bg-black p-4 text-white shadow-2xl sm:p-5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
            <div>
              <h1 className="text-2xl font-black tracking-normal">Reports</h1>
              <p className="text-sm text-zinc-300">
                Sales, stock flow, staff output, payroll, and profit reports
              </p>
            </div>

            <AppNav current="reports" />
          </div>

          <div className="flex items-center gap-3">
            {message && (
              <span className="rounded-lg border border-yellow-700 bg-yellow-950 px-4 py-2 text-sm font-bold text-yellow-300">
                {message}
              </span>
            )}

            <button
              onClick={fetchReports}
              className="rounded-xl bg-white px-5 py-2 text-sm font-black text-black hover:bg-zinc-200"
            >
              Refresh
            </button>
          </div>
        </div>

        {activePayrollTooltipRow && payrollTooltipPosition && (
          <div
            className="pointer-events-none fixed z-[9999] w-64 -translate-x-1/2 -translate-y-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-left text-xs font-bold text-white shadow-2xl"
            style={{ left: payrollTooltipPosition.x, top: payrollTooltipPosition.y }}
          >
            <p className="text-[11px] font-black uppercase text-zinc-400">
              {activePayrollTooltipRow.label}
            </p>
            {activePayrollTooltipStaffRows.length > 0 ? (
              <div className="mt-2 space-y-1.5">
                {activePayrollTooltipStaffRows.map((row) => (
                  <div key={row.staffId} className="rounded-lg bg-zinc-900 px-2 py-1.5">
                    <p className="font-black text-zinc-100">
                      {row.staffName}
                      {row.preview && <span className="ml-1 text-[10px] uppercase text-yellow-300">preview</span>}
                    </p>
                    <p className="mt-0.5 text-emerald-300">Work: {hours(row.workHours)}</p>
                    <p className="text-blue-300">Holiday: {hours(row.holidayHours)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-zinc-400">No staff hours for this section.</p>
            )}
            {activePayrollTooltipRow.hasPreviewHours && (
              <p className="mt-2 text-[10px] font-bold leading-snug text-yellow-300">
                Includes unfinalised rota hours up to today. Finalised reports may change this.
              </p>
            )}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[260px_1fr]">
          <aside className="h-fit rounded-2xl border border-zinc-800 bg-zinc-900 p-3">
            <p className="mb-2 px-2 text-xs font-black uppercase tracking-wide text-zinc-500">
              Report menu
            </p>

            <div className="space-y-2">
              {reportMenu.map((report) => (
                <button
                  key={report.key}
                  type="button"
                  onClick={() => setActiveReport(report.key)}
                  className={`w-full rounded-xl border p-3 text-left ${
                    activeReport === report.key
                      ? 'border-emerald-500 bg-emerald-950 text-white'
                      : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600'
                  }`}
                >
                  <span className="block text-sm font-black">{report.label}</span>
                  <span className="mt-1 block text-xs font-bold text-zinc-500">{report.detail}</span>
                </button>
              ))}
            </div>
          </aside>

          <div className="min-w-0">
        {activeReport === 'sales' && (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-black">Sales Report</h2>
              <p className="text-sm text-zinc-400">
                Daily groups by hour. Weekly and monthly group by day.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="grid grid-cols-3 rounded-xl border border-zinc-700 bg-zinc-950 p-1">
                {(['day', 'week', 'month'] as SalesPeriod[]).map((period) => (
                  <button
                    key={period}
                    type="button"
                    onClick={() => setSalesPeriod(period)}
                    className={`rounded-lg px-4 py-2 text-xs font-black uppercase ${
                      salesPeriod === period ? 'bg-white text-black' : 'text-zinc-300'
                    }`}
                  >
                    {period}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => moveSalesPeriod(-1)}
                className="rounded-xl border border-zinc-700 px-4 py-3 text-sm font-black"
              >
                Previous
              </button>

              <input
                type="date"
                value={dateInputValue(salesAnchor)}
                onChange={(event) => setSalesAnchor(new Date(`${event.target.value}T00:00:00`))}
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm font-black text-white"
              />

              <button
                type="button"
                onClick={() => moveSalesPeriod(1)}
                className="rounded-xl border border-zinc-700 px-4 py-3 text-sm font-black"
              >
                Next
              </button>
            </div>
          </div>

          <div className="mb-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
            <p className="text-sm font-black uppercase tracking-wide text-zinc-500">
              {formatPeriodLabel(salesPeriod, salesAnchor)}
            </p>

            {salesSummary.estimated && (
              <p className="mt-1 text-xs font-bold text-yellow-300">
                Online totals use item selling price where Linnworks order value is not stored locally yet.
              </p>
            )}
          </div>

          <div className="mb-4 grid gap-3 md:grid-cols-5">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs font-bold uppercase text-zinc-500">Sales total</p>
              <p className="mt-1 text-3xl font-black">{money(salesSummary.total)}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs font-bold uppercase text-zinc-500">Units</p>
              <p className="mt-1 text-3xl font-black">{salesSummary.units}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs font-bold uppercase text-zinc-500">Cash</p>
              <p className="mt-1 text-3xl font-black text-emerald-300">{money(salesSummary.cash)}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs font-bold uppercase text-zinc-500">Card</p>
              <p className="mt-1 text-3xl font-black text-blue-300">{money(salesSummary.card)}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs font-bold uppercase text-zinc-500">Online</p>
              <p className="mt-1 text-3xl font-black text-purple-300">{money(salesSummary.online)}</p>
            </div>
          </div>

          <div className="mb-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-black uppercase tracking-wide text-zinc-500">
                Sales graph
              </h3>
              <span className="text-xs font-bold text-zinc-500">
                {salesPeriod === 'day' ? 'Grouped by hour' : 'Grouped by day'}
              </span>
            </div>

            <div className="grid grid-cols-[64px_1fr] gap-3">
              <div className="relative h-72">
                {yAxisTicks.map((tick, index) => (
                  <div
                    key={tick}
                    className="absolute right-0 text-right text-[10px] font-black text-zinc-500"
                    style={{ top: `${index * 25}%`, transform: 'translateY(-50%)' }}
                  >
                    {money(tick)}
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto">
                <div className="relative h-72 min-w-[720px] border-b border-l border-zinc-700 pl-3">
                  {yAxisTicks.map((tick) => (
                    <div
                      key={tick}
                      className="absolute left-0 right-0 border-t border-zinc-800"
                      style={{ bottom: `${(tick / graphMax) * 100}%` }}
                    />
                  ))}

                  <div
                    className="relative z-10 grid h-full items-end gap-2"
                    style={{ gridTemplateColumns: `repeat(${graphRows.length}, minmax(22px, 1fr))` }}
                  >
                    {graphRows.map((row) => {
                      const barHeight = Math.max(2, (row.amount / graphMax) * 100)

                      return (
                        <div key={row.label} className="flex h-full flex-col items-center justify-end gap-2">
                          <span className="text-[10px] font-black text-zinc-400">{row.amount > 0 ? money(row.amount) : ''}</span>
                          <div
                            className="w-full rounded-t-lg bg-emerald-400"
                            style={{ height: `${barHeight}%` }}
                            title={`${row.label}: ${money(row.amount)}`}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div
                  className="mt-2 grid min-w-[720px] gap-2 pl-3"
                  style={{ gridTemplateColumns: `repeat(${graphRows.length}, minmax(22px, 1fr))` }}
                >
                  {graphRows.map((row) => (
                    <span
                      key={row.label}
                      className="flex flex-col items-center text-center text-[10px] font-black uppercase leading-tight text-zinc-500"
                    >
                      {salesPeriod === 'day' ? (
                        <span>{row.label.replace(':00', '')}</span>
                      ) : (
                        <>
                          <span>{row.labelTop || row.label}</span>
                          {row.labelBottom && <span>{row.labelBottom}</span>}
                        </>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_2fr]">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
              <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-zinc-500">
                Channel split
              </h3>

              <div className="space-y-2">
                {channelRows.length === 0 ? (
                  <p className="text-sm font-bold text-zinc-500">No sales in this period.</p>
                ) : (
                  channelRows.map((row) => (
                    <div key={row.channel} className="rounded-xl bg-zinc-900 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-black">{row.channel}</p>
                        <p className="text-sm font-black">{money(row.amount)}</p>
                      </div>
                      <p className="mt-1 text-xs font-bold text-zinc-500">{row.units} unit(s)</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
              <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-zinc-500">
                {salesPeriod === 'day' ? 'Daily item list' : 'Items in period'}
              </h3>

              <div className="grid gap-2 md:grid-cols-2">
                {periodEvents.length === 0 ? (
                  <p className="text-sm font-bold text-zinc-500">No items sold in this period.</p>
                ) : (
                  periodEvents.slice(0, salesPeriod === 'day' ? 80 : 40).map((event) => (
                    <div key={event.id} className="flex gap-3 rounded-xl bg-zinc-900 p-3">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
                        {event.imageUrl ? (
                          <img src={event.imageUrl} alt="" className="h-full w-full object-cover" />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate font-black">{event.sku}</p>
                          <p className="shrink-0 text-sm font-black">{money(event.amount)}</p>
                        </div>
                        <p className="truncate text-xs font-bold text-zinc-400">{event.title}</p>
                        <p className="mt-1 text-xs font-bold text-zinc-500">
                          {event.channel} / {event.paymentMethod} / {event.quantity} unit(s)
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
        )}

        {activeReport === 'stock' && (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-black">Stock On Floor</h2>
              <p className="text-sm text-zinc-400">
                Current stock by location, category, and sub category, with sales movement for the selected report period.
              </p>
            </div>

            <div className="grid gap-2 md:grid-cols-3">
              <select
                value={floorLocation}
                onChange={(event) => setFloorLocation(event.target.value)}
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm font-black text-white"
              >
                {Object.keys(locationLabels).map((location) => (
                  <option key={location} value={location}>
                    {displayLocation(location)}
                  </option>
                ))}
              </select>

              <select
                value={floorCategory}
                onChange={(event) => {
                  setFloorCategory(event.target.value)
                  setFloorSubCategory('ALL')
                }}
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm font-black text-white"
              >
                <option value="ALL">All categories</option>
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>

              <select
                value={floorSubCategory}
                onChange={(event) => setFloorSubCategory(event.target.value)}
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm font-black"
              >
                <option value="ALL">All sub categories</option>
                {subCategoryOptions.map((subCategory) => (
                  <option key={subCategory} value={subCategory}>
                    {subCategory}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs font-bold uppercase text-zinc-500">
                Quantity at {displayLocation(floorLocation)}
              </p>
              <p className="mt-1 text-4xl font-black">{floorSummary.totalQty}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs font-bold uppercase text-zinc-500">Sold in selected period</p>
              <p className="mt-1 text-4xl font-black text-red-300">-{floorSummary.soldInPeriod}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs font-bold uppercase text-zinc-500">Movement ledger</p>
              <p className="mt-2 text-sm font-bold text-zinc-400">
                Sales are live now. Allocation/transfer deltas need the new stock movement SQL below.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-zinc-500">
                By category
              </h3>
              <div className="space-y-2">
                {Object.entries(floorSummary.byCategory).map(([category, qty]) => (
                  <div key={category} className="flex justify-between rounded-lg bg-zinc-900 p-3 text-sm font-black">
                    <span>{category}</span>
                    <span>{qty}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-zinc-500">
                By sub category
              </h3>
              <div className="space-y-2">
                {Object.entries(floorSummary.bySubCategory).map(([subCategory, qty]) => (
                  <div key={subCategory} className="flex justify-between rounded-lg bg-zinc-900 p-3 text-sm font-black">
                    <span>{subCategory}</span>
                    <span>{qty}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
        )}

        {activeReport === 'staff' && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black">Staff Reports</h2>
              <p className="text-sm text-zinc-400">
                Counts items sent to review using sent_to_review_at and sent_to_review_by.
              </p>
            </div>

            <select
              value={historyDays}
              onChange={(event) => setHistoryDays(Number(event.target.value))}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-bold text-white"
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>

          {loading ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-8 text-center text-zinc-400">
              Loading reports...
            </div>
          ) : (
            <>
              <div className="mb-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <p className="text-xs font-bold uppercase text-zinc-500">Sent today</p>
                  <p className="mt-1 text-4xl font-black">{totalToday}</p>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <p className="text-xs font-bold uppercase text-zinc-500">Sent this week</p>
                  <p className="mt-1 text-4xl font-black">{totalWeek}</p>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <p className="text-xs font-bold uppercase text-zinc-500">Sent this month</p>
                  <p className="mt-1 text-4xl font-black">{totalMonth}</p>
                </div>
              </div>

              <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {staffPerformanceRows.length === 0 ? (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm font-bold text-zinc-400">
                    No staff review history yet.
                  </div>
                ) : (
                  staffPerformanceRows.map((row) => (
                    <div key={row.staffId} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="truncate text-lg font-black">{row.staffName}</p>
                        <span className="rounded-full bg-blue-950 px-3 py-1 text-xs font-black text-blue-300">
                          {row.todayCount} today
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-center text-xs font-bold">
                        <div className="rounded-lg bg-zinc-900 p-2">
                          <p className="text-zinc-500">Week</p>
                          <p className="text-lg text-white">{row.weekCount}</p>
                        </div>
                        <div className="rounded-lg bg-zinc-900 p-2">
                          <p className="text-zinc-500">Avg / day</p>
                          <p className="text-lg text-white">{row.averagePerDay.toFixed(1)}</p>
                        </div>
                        <div className="rounded-lg bg-zinc-900 p-2">
                          <p className="text-zinc-500">Est / hour today</p>
                          <p className="text-lg text-white">{row.estimatedPerHour.toFixed(1)}</p>
                        </div>
                        <div className="rounded-lg bg-zinc-900 p-2">
                          <p className="text-zinc-500">Month</p>
                          <p className="text-lg text-white">{row.monthCount}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-zinc-500">
                  Review history
                </h3>

                {Object.keys(historyByDate).length === 0 ? (
                  <p className="text-sm font-bold text-zinc-500">No history for this period.</p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(historyByDate).map(([date, staffRows]) => (
                      <div key={date} className="rounded-lg bg-zinc-900 p-3">
                        <p className="mb-2 text-sm font-black text-white">{date}</p>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(staffRows).map(([staffName, count]) => (
                            <span
                              key={`${date}-${staffName}`}
                              className="rounded-lg bg-blue-950 px-3 py-2 text-xs font-black text-blue-300"
                            >
                              {staffName}: {count}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-zinc-500">
                  Latest review submissions
                </h3>

                <div className="space-y-2">
                  {historyItems.slice(0, 30).map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-zinc-900 p-3 text-sm"
                    >
                      <div>
                        <p className="font-black">SKU: {item.sku}</p>
                        <p className="text-xs font-bold text-zinc-500">
                          {staffNameById[item.sent_to_review_by || ''] || 'Unknown staff'} / {formatDateTime(item.sent_to_review_at)}
                        </p>
                      </div>

                      <p className="rounded-full bg-zinc-800 px-3 py-1 text-xs font-black text-zinc-300">
                        {item.status}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>
        )}

        {activeReport === 'payroll' && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-black">Payroll & Holiday Report</h2>
              <p className="text-sm text-zinc-400">
                Totals use finalised rota weeks. The chart also previews saved unfinalised rota hours up to today.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => movePayrollPeriod(-1)}
                className="rounded-xl border border-zinc-700 px-4 py-3 text-sm font-black"
              >
                Previous
              </button>

              <input
                type="date"
                value={dateInputValue(payrollAnchor)}
                onChange={(event) => setPayrollAnchor(parseDateInput(event.target.value))}
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm font-black"
              />

              <button
                type="button"
                onClick={() => movePayrollPeriod(1)}
                className="rounded-xl border border-zinc-700 px-4 py-3 text-sm font-black"
              >
                Next
              </button>
            </div>
          </div>

          <div className="mb-4 grid gap-3 xl:grid-cols-[1fr_220px_220px]">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs font-black uppercase tracking-wide text-zinc-500">
                {payrollViewMode === 'holiday_year'
                  ? 'Holiday year'
                  : `${payrollSettings.payroll_period.replace('biweekly', 'bi-weekly')} payroll period`}
              </p>
              <p className="mt-1 text-lg font-black">
                {rangeLabel(payrollRange.start, payrollRange.end)}
              </p>
            </div>

            <select
              value={payrollViewMode}
              onChange={(event) => setPayrollViewMode(event.target.value as PayrollViewMode)}
              className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm font-black"
            >
              <option value="period">Payroll period</option>
              <option value="holiday_year">Holiday year</option>
            </select>

            <select
              value={selectedPayrollCompany}
              onChange={(event) => setSelectedPayrollCompany(event.target.value)}
              className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm font-black"
            >
              <option value="ALL">All companies</option>
              {payrollCompanyOptions.map((company) => (
                <option key={company} value={company}>
                  {company === 'dlretail' ? 'DL Retail' : company === 'dohpe' ? 'Dohpe' : company}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_220px]">
            <select
              value={selectedPayrollStaffId}
              onChange={(event) => setSelectedPayrollStaffId(event.target.value)}
              className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm font-black"
            >
              <option value="ALL">All staff</option>
              {staffUsers.filter((staff) => staff.is_active !== false).map((staff) => (
                <option key={staff.id} value={staff.id}>
                  {staff.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs font-bold uppercase text-zinc-500">Work hours</p>
              <p className="mt-1 text-3xl font-black">{hours(payrollSummary.workHours)}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs font-bold uppercase text-zinc-500">Paid hours</p>
              <p className="mt-1 text-3xl font-black text-emerald-300">{hours(payrollSummary.paidHours)}</p>
            </div>
          </div>

          <div className="mb-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black uppercase tracking-wide text-zinc-400">
                  {selectedPayrollStaffId === 'ALL'
                    ? 'All staff hours'
                    : `${staffNameById[selectedPayrollStaffId] || 'Staff'} hours`}
                </h3>
                <p className="text-xs font-bold text-zinc-500">
                  {payrollViewMode === 'holiday_year'
                    ? 'Grouped by month'
                    : payrollSettings.payroll_period === 'monthly'
                      ? 'Grouped by day of month'
                      : payrollSettings.payroll_period === 'biweekly'
                        ? 'Grouped by day across the bi-weekly period'
                        : 'Grouped by day of week'}
                </p>
              </div>

              <div className="flex items-center gap-3 text-xs font-black uppercase">
                <span className="flex items-center gap-2 text-emerald-300">
                  <span className="h-3 w-3 rounded-sm bg-emerald-500" />
                  Work
                </span>
                <span className="flex items-center gap-2 text-blue-300">
                  <span className="h-3 w-3 rounded-sm bg-blue-500" />
                  Holiday
                </span>
              </div>
            </div>

            <div className="grid grid-cols-[56px_1fr] gap-3">
              <div className="relative h-64">
                {payrollYAxisTicks.map((tick, index) => (
                  <div
                    key={`${tick}-${index}`}
                    className="absolute right-0 text-right text-[10px] font-black text-zinc-500"
                    style={{ top: `${index * 25}%`, transform: 'translateY(-50%)' }}
                  >
                    {tick}h
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto pb-2">
                <div className="relative h-64 min-w-[720px] border-b border-l border-zinc-700 pl-3">
                  {payrollYAxisTicks.map((tick) => (
                    <div
                      key={tick}
                      className="absolute left-0 right-0 border-t border-zinc-800"
                      style={{ bottom: `${(tick / payrollChartMax) * 100}%` }}
                    />
                  ))}

                  <div
                    className="relative z-10 grid h-full items-end gap-2"
                    style={{ gridTemplateColumns: `repeat(${payrollChartRows.length}, minmax(24px, 1fr))` }}
                  >
                    {payrollChartRows.map((row) => {
                      const workHeight = Math.max(0, (row.workHours / payrollChartMax) * 100)
                      const holidayHeight = Math.max(0, (row.holidayHours / payrollChartMax) * 100)
                      const hasHours = row.workHours + row.holidayHours > 0
                      const staffLabel = row.staffNames.join(' / ')

                      return (
                        <div key={row.key} className="relative flex h-full flex-col items-center justify-end gap-2">
                          <div
                            role="button"
                            tabIndex={0}
                            aria-label={`${row.label}: Work ${hours(row.workHours)}, Holiday ${hours(row.holidayHours)}${staffLabel ? `, Staff: ${staffLabel}` : ''}`}
                            onPointerEnter={(event) => queuePayrollTooltip(row.key, event.currentTarget)}
                            onPointerLeave={() => hidePayrollTooltip(row.key)}
                            onFocus={(event) => queuePayrollTooltip(row.key, event.currentTarget)}
                            onBlur={() => hidePayrollTooltip(row.key)}
                            onClick={(event) => {
                              clearPayrollTooltipTimer()
                              setPinnedPayrollTooltipKey((current) => {
                                const next = current === row.key ? null : row.key
                                setPayrollTooltipPosition(next ? tooltipPositionForElement(event.currentTarget) : null)
                                setActivePayrollTooltipKey(next)
                                return next
                              })
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                clearPayrollTooltipTimer()
                                setPinnedPayrollTooltipKey((current) => {
                                  const next = current === row.key ? null : row.key
                                  setPayrollTooltipPosition(next ? tooltipPositionForElement(event.currentTarget) : null)
                                  setActivePayrollTooltipKey(next)
                                  return next
                                })
                              }
                            }}
                            className="relative flex h-full w-full max-w-10 cursor-pointer flex-col justify-end overflow-hidden rounded-t-md bg-zinc-900 outline-none ring-offset-2 ring-offset-zinc-950 focus:ring-2 focus:ring-emerald-300"
                          >
                            {row.holidayHours > 0 && (
                              <div
                                className="w-full bg-blue-500"
                                style={{ height: `${Math.max(3, holidayHeight)}%` }}
                              />
                            )}
                            {row.workHours > 0 && (
                              <div
                                className="w-full bg-emerald-500"
                                style={{ height: `${Math.max(3, workHeight)}%` }}
                              />
                            )}
                            {!hasHours && <div className="h-[2px] w-full bg-zinc-800" />}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div
                  className="mt-2 grid min-w-[720px] gap-2 pl-3"
                  style={{ gridTemplateColumns: `repeat(${payrollChartRows.length}, minmax(24px, 1fr))` }}
                >
                  {payrollChartRows.map((row) => (
                    <span
                      key={row.key}
                      className="flex flex-col items-center text-center text-[10px] font-black uppercase leading-tight text-zinc-500"
                    >
                      <span>{row.labelTop || row.label}</span>
                      {row.labelBottom && <span>{row.labelBottom}</span>}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-950">
            <table className="min-w-[860px] w-full text-left text-sm">
              <thead className="bg-zinc-900 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Staff</th>
                  <th className="px-4 py-3 text-right">Work</th>
                  <th className="px-4 py-3 text-right">Breaks</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3 text-right">Holiday accrued</th>
                  {payrollViewMode === 'holiday_year' && (
                    <th className="px-4 py-3 text-right">Carried</th>
                  )}
                  <th className="px-4 py-3 text-right">Holiday taken</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {payrollRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={payrollViewMode === 'holiday_year' ? 8 : 7}
                      className="px-4 py-8 text-center font-bold text-zinc-500"
                    >
                      No finalised rota weeks found for this payroll period.
                    </td>
                  </tr>
                ) : (
                  payrollRows.map((row) => (
                    <tr key={row.staffId} className="border-t border-zinc-800">
                      <td className="px-4 py-3 font-black">{row.staffName}</td>
                      <td className="px-4 py-3 text-right font-bold">{hours(row.workHours)}</td>
                      <td className="px-4 py-3 text-right font-bold text-red-300">{hours(row.breakHours)}</td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-300">{hours(row.paidHours)}</td>
                      <td className="px-4 py-3 text-right font-bold text-blue-300">{hours(row.holidayAccruedHours)}</td>
                      {payrollViewMode === 'holiday_year' && (
                        <td className="px-4 py-3 text-right font-bold">
                          {selectedPayrollCompany === 'ALL' ? (
                            hours(row.carriedOverHours)
                          ) : (
                            <div className="flex flex-col items-end gap-1">
                              <input
                                key={`${holidayYearStartKey}-${selectedPayrollCompany}-${row.staffId}-${row.carriedOverHours}`}
                                type="number"
                                min="0"
                                step="0.25"
                                defaultValue={row.carriedOverHours.toFixed(2)}
                                onBlur={(event) => {
                                  const next = Number(event.currentTarget.value)
                                  if (Number.isFinite(next) && Math.abs(next - row.carriedOverHours) > 0.004) {
                                    saveCarriedOverOverride(row, event.currentTarget.value)
                                  }
                                }}
                                className="w-24 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-right font-black text-white"
                              />
                              {row.carriedOverOverridden && (
                                <span className="text-[10px] font-black uppercase text-yellow-300">
                                  Auto {hours(row.autoCarriedOverHours)}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3 text-right font-bold text-purple-300">{hours(row.holidayHours)}</td>
                      <td className="px-4 py-3 text-right font-black">{hours(row.holidayBalanceHours)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {rotaFinalisations.some((row) => row.totals && !row.totals.shifts) && (
            <p className="mt-4 rounded-xl border border-yellow-800 bg-yellow-950 p-4 text-sm font-bold text-yellow-200">
              Older finalised weeks do not contain shift-level detail, so break deductions can only be calculated fully for newly finalised weeks.
            </p>
          )}
        </section>
        )}

        {activeReport === 'profit' && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-xl font-black">Profit / Loss Report</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs font-bold uppercase text-zinc-500">Sales</p>
              <p className="mt-1 text-3xl font-black">{money(salesSummary.total)}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs font-bold uppercase text-zinc-500">Units</p>
              <p className="mt-1 text-3xl font-black">{salesSummary.units}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs font-bold uppercase text-zinc-500">Fixed costs</p>
              <p className="mt-1 text-3xl font-black text-yellow-300">Next</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs font-bold uppercase text-zinc-500">Rota wages</p>
              <p className="mt-1 text-3xl font-black text-yellow-300">Next</p>
            </div>
          </div>
          <p className="mt-4 rounded-xl border border-dashed border-zinc-700 bg-zinc-950 p-6 text-sm font-bold text-zinc-500">
            Profit and loss is now shaped around sales, fixed costs, and finalised rota wages. The next data hook is to read fixed_costs and rota_week_finalisations.
          </p>
        </section>
        )}
          </div>
        </div>
      </main>
    </StaffPermissionGate>
  )
}

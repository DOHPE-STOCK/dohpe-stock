'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { setStoredTheme } from '@/app/components/ThemeProvider'
import IntegrationsPanel from '@/app/settings/integrations/IntegrationsPanel'

type StaffUser = {
  id: string
  name: string
  pin_code: string
  is_active: boolean
  created_at?: string
  must_change_pin?: boolean
  pin_updated_at?: string | null
  role?: string
  permissions?: Record<string, boolean>
  payroll_settings?: PayrollStaffSettings | null
}

type PayrollPeriod = 'weekly' | 'biweekly' | 'monthly'
type HolidayMethod = 'fixed_weeks' | 'accrual_percent'

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
  include_in_payroll?: boolean
  holiday_method?: HolidayMethod
  holiday_weeks?: number
  accrual_percent?: number
  carried_over_hours?: number
  break_4h_minutes?: number
  break_6h_minutes?: number
}

type LocationSetting = {
  id?: string
  code?: string
  name: string
  label: string
  is_active: boolean
  bin_mode: 'basic' | 'range'
  basic_bins: string[]
}

type FixedCost = {
  id?: string
  name: string
  amount: number
  cadence: string
  category: string
  location_name: string
  is_active: boolean
}

type OpenSection =
  | 'integrations'
  | 'processing'
  | 'locations'
  | 'users'
  | 'payroll'
  | 'appearance'
  | 'fixed_costs'
  | 'photo'
  | 'export'
  | 'copy'
  | null

const permissionOptions = [
  { key: 'working', label: 'Working' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'review', label: 'Review' },
  { key: 'finalised', label: 'Finalised' },
  { key: 'reports', label: 'Reports' },
  { key: 'settings', label: 'Settings' },
  { key: 'scanner', label: 'Scanner' },
  { key: 'checkout', label: 'Checkout' },
  { key: 'integrations', label: 'Integrations' },
]

const roleOptions = ['admin', 'manager', 'staff', 'checkout', 'scanner']

const defaultLocationSettings: LocationSetting[] = [
  { name: 'LOCATION-1', label: 'WAREHOUSE', is_active: true, bin_mode: 'range', basic_bins: ['Default'] },
  { name: 'LOCATION-2', label: 'SHOP-1', is_active: true, bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
  { name: 'LOCATION-3', label: 'SHOP-2', is_active: true, bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
  { name: 'LOCATION-4', label: 'SHOP-3', is_active: true, bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
  { name: 'LOCATION-5', label: 'SHOP-4', is_active: true, bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
]

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
  include_in_payroll: true,
  holiday_method: 'fixed_weeks',
  holiday_weeks: 5.6,
  accrual_percent: 12.07,
  carried_over_hours: 0,
  break_4h_minutes: 15,
  break_6h_minutes: 30,
}

const monthOptions = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const monthDayOptions = Array.from({ length: 31 }, (_, index) => index + 1)

function normalisePayrollStaffSettings(settings?: PayrollStaffSettings | null): Required<PayrollStaffSettings> {
  return {
    ...defaultPayrollStaffSettings,
    ...(settings || {}),
    include_in_payroll: settings?.include_in_payroll !== false,
    holiday_method:
      settings?.holiday_method === 'accrual_percent' ? 'accrual_percent' : 'fixed_weeks',
    holiday_weeks: Number(settings?.holiday_weeks ?? defaultPayrollStaffSettings.holiday_weeks),
    accrual_percent: Number(settings?.accrual_percent ?? defaultPayrollStaffSettings.accrual_percent),
    carried_over_hours: Number(settings?.carried_over_hours ?? 0),
    break_4h_minutes: Number(settings?.break_4h_minutes ?? defaultPayrollStaffSettings.break_4h_minutes),
    break_6h_minutes: Number(settings?.break_6h_minutes ?? defaultPayrollStaffSettings.break_6h_minutes),
  }
}

function emptyPermissions() {
  return {
    working: false,
    inventory: false,
    review: false,
    finalised: false,
    reports: false,
    settings: false,
    scanner: false,
    checkout: false,
    integrations: false,
  }
}

function defaultPermissions(role = '') {
  if (role === 'admin') {
    return {
      working: true,
      inventory: true,
      review: true,
      finalised: true,
      reports: true,
      settings: true,
      scanner: true,
      checkout: true,
      integrations: true,
    }
  }

  if (role === 'manager') {
    return {
      working: true,
      inventory: true,
      review: true,
      finalised: true,
      reports: true,
      settings: false,
      scanner: true,
      checkout: true,
      integrations: false,
    }
  }

  if (role === 'checkout') {
    return {
      working: false,
      inventory: false,
      review: false,
      finalised: false,
      reports: false,
      settings: false,
      scanner: false,
      checkout: true,
      integrations: false,
    }
  }

  if (role === 'scanner') {
    return {
      working: true,
      inventory: true,
      review: false,
      finalised: false,
      reports: false,
      settings: false,
      scanner: true,
      checkout: false,
      integrations: false,
    }
  }

  if (role === 'staff') {
    return {
      working: true,
      inventory: true,
      review: false,
      finalised: false,
      reports: false,
      settings: false,
      scanner: true,
      checkout: true,
      integrations: false,
    }
  }

  return emptyPermissions()
}

function normalisePermissions(role?: string, permissions?: Record<string, boolean>) {
  if (role === 'admin') return defaultPermissions('admin')

  const base = emptyPermissions()

  for (const option of permissionOptions) {
    base[option.key as keyof ReturnType<typeof emptyPermissions>] = Boolean(
      permissions?.[option.key]
    )
  }

  return base
}

function hasAnyPermission(permissions?: Record<string, boolean>) {
  return permissionOptions.some((option) => Boolean(permissions?.[option.key]))
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>(null)
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([])
  const [locations, setLocations] = useState<LocationSetting[]>(defaultLocationSettings)
  const [originalLocationModes, setOriginalLocationModes] = useState<Record<string, 'basic' | 'range'>>({})
  const [fixedCosts, setFixedCosts] = useState<FixedCost[]>([])
  const [payrollSettings, setPayrollSettings] = useState<PayrollSettings>(defaultPayrollSettings)
  const [message, setMessage] = useState('')
  const [newStaffName, setNewStaffName] = useState('')
  const [newStaffPin, setNewStaffPin] = useState('')
  const [newStaffRole, setNewStaffRole] = useState('')
  const [newStaffPermissions, setNewStaffPermissions] = useState<Record<string, boolean>>(emptyPermissions())
  const [savingStaffId, setSavingStaffId] = useState('')
  const [openSection, setOpenSection] = useState<OpenSection>('integrations')
  const [payrollDirty, setPayrollDirty] = useState(false)
  const [holidayStartPickerOpen, setHolidayStartPickerOpen] = useState(false)

  const activeAdminCount = useMemo(() => {
    return staffUsers.filter((user) => user.is_active && user.role === 'admin').length
  }, [staffUsers])

  const canAddNewStaff =
    newStaffName.trim().length > 0 &&
    newStaffPin.trim().length >= 4 &&
    newStaffRole.trim().length > 0 &&
    hasAnyPermission(newStaffPermissions)

  useEffect(() => {
    fetchSettings()
    fetchStaffUsers()
    fetchLocations()
    fetchFixedCosts()
    fetchPayrollSettings()
  }, [])

  useEffect(() => {
    if (!message) return

    const timer = window.setTimeout(() => {
      setMessage('')
    }, 5000)

    return () => window.clearTimeout(timer)
  }, [message])

  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!payrollDirty) return
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [payrollDirty])

  function markPayrollDirty() {
    setPayrollDirty(true)
  }

  function updatePayrollSettings(patch: Partial<PayrollSettings>) {
    setPayrollSettings((current) => ({ ...current, ...patch }))
    markPayrollDirty()
  }

  async function changeSettingsSection(section: OpenSection) {
    if (openSection === 'payroll' && section !== 'payroll' && payrollDirty) {
      const save = window.confirm(
        'Save payroll and holiday changes before leaving this section?\n\nOK = save changes\nCancel = discard unsaved changes',
      )

      if (save) {
        const saved = await savePayrollSettings()
        if (!saved) return
      } else {
        await Promise.all([fetchStaffUsers(), fetchPayrollSettings()])
        setPayrollDirty(false)
      }
    }

    setOpenSection(section)
  }

  async function fetchSettings() {
    const { data, error } = await supabase
      .from('app_settings')
      .select('*')
      .eq('id', 'default')
      .single()

    if (error) {
      setMessage(error.message)
      return
    }

    setSettings(data)
    setStoredTheme(data.ui_theme || 'dark')
  }

  async function fetchStaffUsers() {
    const { data, error } = await supabase
      .from('staff_users')
      .select('*')
      .order('name', { ascending: true })

    if (error) {
      setMessage(error.message)
      return
    }

    setStaffUsers(
      (data || [])
        .map((user: StaffUser) => ({
          ...user,
          role: user.role || 'staff',
          permissions: normalisePermissions(user.role || 'staff', user.permissions || {}),
          payroll_settings: normalisePayrollStaffSettings(user.payroll_settings),
        }))
        .sort((a: StaffUser, b: StaffUser) => {
          if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
          return (a.name || '').localeCompare(b.name || '')
        })
    )
  }

  async function fetchPayrollSettings() {
    const { data, error } = await supabase
      .from('payroll_settings')
      .select('*')
      .eq('id', 'default')
      .maybeSingle()

    if (error) {
      setMessage(error.message)
      return
    }

    setPayrollSettings({
      ...defaultPayrollSettings,
      ...(data || {}),
      payroll_period: ((data as any)?.payroll_period || 'weekly') as PayrollPeriod,
      default_holiday_method: ((data as any)?.default_holiday_method || 'fixed_weeks') as HolidayMethod,
    })
  }

  async function savePayrollSettings() {
    const payload = {
      id: 'default',
      payroll_period: payrollSettings.payroll_period,
      payroll_start_day: Number(payrollSettings.payroll_start_day || 1),
      payroll_start_date: null,
      holiday_year_start_month: Number(payrollSettings.holiday_year_start_month || 4),
      holiday_year_start_day: Number(payrollSettings.holiday_year_start_day || 1),
      default_holiday_method: payrollSettings.default_holiday_method,
      default_holiday_weeks: Number(payrollSettings.default_holiday_weeks || 5.6),
      default_accrual_percent: Number(payrollSettings.default_accrual_percent || 12.07),
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase
      .from('payroll_settings')
      .upsert(payload, { onConflict: 'id' })

    if (error) {
      setMessage(error.message)
      return false
    }

    for (const user of staffUsers) {
      const { error: staffError } = await supabase
        .from('staff_users')
        .update({
          payroll_settings: normalisePayrollStaffSettings(user.payroll_settings),
        })
        .eq('id', user.id)

      if (staffError) {
        setMessage(staffError.message)
        return false
      }
    }

    setPayrollDirty(false)
    setMessage('Payroll and holiday settings saved')
    await Promise.all([fetchPayrollSettings(), fetchStaffUsers()])
    return true
  }

  async function fetchLocations() {
    const { data, error } = await supabase
      .from('locations')
      .select('id, code, name, label, is_active, bin_mode, basic_bins')
      .in('name', defaultLocationSettings.map((location) => location.name))
      .order('name', { ascending: true })

    if (error) {
      setMessage(error.message)
      return
    }

    const saved = new Map(
      (data || []).map((location: any) => [location.name, location as LocationSetting])
    )

    const mergedLocations = defaultLocationSettings.map((location) => ({
      ...location,
      ...(saved.get(location.name) || {}),
      bin_mode: ((saved.get(location.name) as any)?.bin_mode || location.bin_mode) as 'basic' | 'range',
      basic_bins: Array.isArray((saved.get(location.name) as any)?.basic_bins)
        ? (saved.get(location.name) as any).basic_bins
        : location.basic_bins,
    }))

    setLocations(mergedLocations)
    setOriginalLocationModes(
      Object.fromEntries(
        mergedLocations.map((location) => [location.name, location.bin_mode])
      )
    )
  }

  async function getLocationStockSummary(locationName: string) {
    const { data, error } = await supabase
      .from('item_stock_locations')
      .select('sku, bin_code, stock_level')
      .eq('location_name', locationName)
      .gt('stock_level', 0)
      .limit(25)

    if (error) throw new Error(error.message)

    const rows = data || []
    const totalStock = rows.reduce((sum, row: any) => sum + Number(row.stock_level || 0), 0)
    const skuCount = new Set(rows.map((row: any) => row.sku).filter(Boolean)).size
    const bins = Array.from(
      new Set(rows.map((row: any) => String(row.bin_code || '').trim()).filter(Boolean))
    ).slice(0, 8)

    return {
      locationName,
      totalStock,
      skuCount,
      bins,
      rowsChecked: rows.length,
    }
  }

  async function saveLocations() {
    const changedBinModeLocations = locations.filter((location) => {
      const originalMode = originalLocationModes[location.name]
      return originalMode && originalMode !== location.bin_mode
    })

    if (changedBinModeLocations.length > 0) {
      const stockSummaries = []

      for (const location of changedBinModeLocations) {
        stockSummaries.push(await getLocationStockSummary(location.name))
      }

      const locationsWithStock = stockSummaries.filter((summary) => summary.totalStock > 0)

      if (locationsWithStock.length > 0) {
        const warningLines = locationsWithStock.map((summary) => {
          const location = locations.find((item) => item.name === summary.locationName)
          const originalMode = originalLocationModes[summary.locationName]
          const nextMode = location?.bin_mode || 'basic'
          const bins = summary.bins.length > 0 ? summary.bins.join(', ') : 'none found'

          return `${summary.locationName} (${location?.label || summary.locationName}) is changing ${originalMode} → ${nextMode}. Current positive stock found: ${summary.totalStock} units across ${summary.skuCount} SKU(s). Existing bins include: ${bins}.`
        })

        const confirmed = window.confirm(
          `Warning: you are changing bin setup for a location that already has stock.\n\n${warningLines.join(
            '\n\n'
          )}\n\nWhy this matters:\n- Basic locations treat bins like FLOOR/STOCK and sync Linnworks as one location total.\n- Range / allocate locations treat bins as exact pick locations and can push BinRack values to Linnworks.\n- Changing mode with stock already present may cause wrong pick bins, wrong deduction order, or misleading Linnworks BinRack until the stock is reallocated/checked.\n\nOnly continue if you have checked/reallocated the stock rows for these locations.`
        )

        if (!confirmed) {
          setMessage('Location bin setup change cancelled. Check/reallocate stock first.')
          return
        }
      }
    }

    for (const location of locations) {
      const cleanName = location.name.trim().toUpperCase()
      const cleanLabel = location.label.trim().toUpperCase()

      if (!cleanName || !cleanLabel) {
        setMessage('Every location needs a code and display name')
        return
      }

      if (location.id) {
        const { error } = await supabase
          .from('locations')
          .update({
            label: cleanLabel,
            is_active: location.is_active,
            bin_mode: location.bin_mode,
            basic_bins: location.basic_bins
              .map((bin) => bin.trim().toUpperCase())
              .filter(Boolean)
              .slice(0, 3),
          })
          .eq('id', location.id)

        if (error) {
          setMessage(error.message)
          return
        }
      } else {
        const { error } = await supabase
          .from('locations')
          .insert({
            code: cleanName,
            name: cleanName,
            label: cleanLabel,
            is_active: location.is_active,
            bin_mode: location.bin_mode,
            basic_bins: location.basic_bins
              .map((bin) => bin.trim().toUpperCase())
              .filter(Boolean)
              .slice(0, 3),
          })

        if (error) {
          setMessage(error.message)
          return
        }
      }
    }

    setMessage('Location names saved')
    fetchLocations()
  }

  async function fetchFixedCosts() {
    const { data, error } = await supabase
      .from('fixed_costs')
      .select('id, name, amount, cadence, category, location_name, is_active')
      .order('name', { ascending: true })

    if (error) {
      setMessage(error.message)
      return
    }

    setFixedCosts((data || []) as FixedCost[])
  }

  function addFixedCost() {
    setFixedCosts((current) => [
      ...current,
      {
        name: '',
        amount: 0,
        cadence: 'monthly',
        category: '',
        location_name: '',
        is_active: true,
      },
    ])
  }

  function updateFixedCost(index: number, patch: Partial<FixedCost>) {
    setFixedCosts((current) =>
      current.map((cost, costIndex) => (costIndex === index ? { ...cost, ...patch } : cost))
    )
  }

  async function saveFixedCosts() {
    const rows = fixedCosts
      .map((cost) => ({
        id: cost.id,
        name: cost.name.trim(),
        amount: Number(cost.amount || 0),
        cadence: cost.cadence || 'monthly',
        category: cost.category.trim() || null,
        location_name: cost.location_name.trim() || null,
        is_active: Boolean(cost.is_active),
        updated_at: new Date().toISOString(),
      }))
      .filter((cost) => cost.name)

    if (rows.length === 0) {
      setMessage('Add at least one named fixed cost before saving')
      return
    }

    for (const row of rows) {
      const payload = {
        name: row.name,
        amount: row.amount,
        cadence: row.cadence,
        category: row.category,
        location_name: row.location_name,
        is_active: row.is_active,
        updated_at: row.updated_at,
      }

      const result = row.id
        ? await supabase.from('fixed_costs').update(payload).eq('id', row.id)
        : await supabase.from('fixed_costs').insert(payload)

      if (result.error) {
        setMessage(result.error.message)
        return
      }
    }

    setMessage('Fixed costs saved')
    fetchFixedCosts()
  }

  function updateLocation(index: number, patch: Partial<LocationSetting>) {
    setLocations((current) =>
      current.map((location, locationIndex) =>
        locationIndex === index ? { ...location, ...patch } : location
      )
    )
  }

  function updateLocationBasicBin(index: number, binIndex: number, value: string) {
    setLocations((current) =>
      current.map((location, locationIndex) => {
        if (locationIndex !== index) return location

        const basicBins = [...(location.basic_bins || [])]
        basicBins[binIndex] = value.toUpperCase().replace(/[^A-Z0-9-]/g, '')

        return {
          ...location,
          basic_bins: basicBins.slice(0, 3),
        }
      })
    )
  }

  async function saveSettings() {
    const { error } = await supabase
      .from('app_settings')
      .update({
        photo_reference_url: settings.photo_reference_url,
        photo_reference_urls: settings.photo_reference_urls,
        photo_ai_rules: settings.photo_ai_rules,
        photo_background_colour: settings.photo_background_colour,
        image_export_size: Number(settings.image_export_size),
        image_export_quality: Number(settings.image_export_quality),
        ai_copy_rules: settings.ai_copy_rules,
        ui_theme: settings.ui_theme || 'dark',
        enable_rfid_receiving: Boolean(settings.enable_rfid_receiving),
        updated_at: new Date().toISOString(),
      })
      .eq('id', 'default')

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage('Settings saved')
    setStoredTheme(settings.ui_theme || 'dark')
  }

  function updateNewStaffRole(role: string) {
    setNewStaffRole(role)
    setNewStaffPermissions(defaultPermissions(role))
  }

  function toggleNewStaffPermission(permissionKey: string) {
    if (newStaffRole === 'admin') return

    setNewStaffPermissions((current) => ({
      ...current,
      [permissionKey]: !Boolean(current[permissionKey]),
    }))
  }

  async function addStaffUser() {
    const name = newStaffName.trim()
    const pin = newStaffPin.trim()
    const role = newStaffRole.trim()

    if (!name) {
      setMessage('Enter a staff name')
      return
    }

    if (!pin || pin.length < 4) {
      setMessage('Enter a PIN of at least 4 digits')
      return
    }

    if (!role) {
      setMessage('Select a role before creating the user')
      return
    }

    const permissions = normalisePermissions(role, newStaffPermissions)

    if (!hasAnyPermission(permissions)) {
      setMessage('Select at least one permission before creating the user')
      return
    }

    const { error } = await supabase.from('staff_users').insert({
      name,
      pin_code: pin,
      is_active: true,
      must_change_pin: true,
      pin_updated_at: new Date().toISOString(),
      role,
      permissions,
    })

    if (error) {
      setMessage(error.message)
      return
    }

    setNewStaffName('')
    setNewStaffPin('')
    setNewStaffRole('')
    setNewStaffPermissions(emptyPermissions())
    setMessage(`Staff user ${name} added`)
    fetchStaffUsers()
  }

  function isLastActiveAdmin(user: StaffUser) {
    return user.is_active && user.role === 'admin' && activeAdminCount <= 1
  }

  async function saveStaffUser(user: StaffUser) {
    if (isLastActiveAdmin(user)) {
      if (user.role !== 'admin' || user.is_active === false) {
        setMessage('Cannot disable or downgrade the last active admin')
        return
      }
    }

    const permissions = normalisePermissions(user.role || 'staff', user.permissions || {})

    if (user.role === 'admin' && !permissions.settings) {
      setMessage('Admin users must keep Settings access')
      return
    }

    if (!hasAnyPermission(permissions)) {
      setMessage('User must have at least one permission')
      return
    }

    setSavingStaffId(user.id)

    const { error } = await supabase
      .from('staff_users')
      .update({
        name: user.name,
        pin_code: user.pin_code,
        is_active: user.is_active,
        must_change_pin: Boolean(user.must_change_pin),
        role: user.role || 'staff',
        permissions,
        payroll_settings: normalisePayrollStaffSettings(user.payroll_settings),
        pin_updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    setSavingStaffId('')

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage(`${user.name} saved`)
    fetchStaffUsers()
  }

  async function deleteStaffUser(user: StaffUser) {
    if (isLastActiveAdmin(user)) {
      setMessage('Cannot delete the last active admin')
      return
    }

    const confirmed = window.confirm(
      `Delete ${user.name}?\n\nThey will be hidden from live staff lists, but historical rota and item records will be kept.`,
    )

    if (!confirmed) return

    setSavingStaffId(user.id)

    const { error } = await supabase
      .from('staff_users')
      .update({
        is_active: false,
      })
      .eq('id', user.id)

    setSavingStaffId('')

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage(`${user.name} deleted`)
    fetchStaffUsers()
  }

  async function reactivateStaffUser(user: StaffUser) {
    setSavingStaffId(user.id)

    const { error } = await supabase
      .from('staff_users')
      .update({
        is_active: true,
      })
      .eq('id', user.id)

    setSavingStaffId('')

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage(`${user.name} reactivated`)
    fetchStaffUsers()
  }

  async function resetPin(user: StaffUser) {
    const newPin = window.prompt(`Enter new PIN for ${user.name}`)

    if (!newPin) return

    if (newPin.trim().length < 4) {
      setMessage('PIN must be at least 4 digits')
      return
    }

    const updatedUser = {
      ...user,
      pin_code: newPin.trim(),
      must_change_pin: true,
      pin_updated_at: new Date().toISOString(),
    }

    await saveStaffUser(updatedUser)
  }

  function updateStaffUser(id: string, patch: Partial<StaffUser>) {
    setStaffUsers((current) =>
      current.map((user) => {
        if (user.id !== id) return user

        const patched = { ...user, ...patch }

        if (isLastActiveAdmin(user)) {
          patched.is_active = true
          patched.role = 'admin'
          patched.permissions = defaultPermissions('admin')
        }

        return patched
      })
    )
  }

  function updateStaffPayrollSettings(id: string, patch: Partial<PayrollStaffSettings>) {
    setStaffUsers((current) =>
      current.map((user) => {
        if (user.id !== id) return user

        return {
          ...user,
          payroll_settings: {
            ...normalisePayrollStaffSettings(user.payroll_settings),
            ...patch,
          },
        }
      })
    )
    markPayrollDirty()
  }

  function updateStaffRole(id: string, role: string) {
    setStaffUsers((current) =>
      current.map((user) => {
        if (user.id !== id) return user

        if (isLastActiveAdmin(user) && role !== 'admin') {
          setMessage('Cannot downgrade the last active admin')
          return {
            ...user,
            role: 'admin',
            permissions: defaultPermissions('admin'),
          }
        }

        return {
          ...user,
          role,
          permissions: defaultPermissions(role),
        }
      })
    )
  }

  function togglePermission(id: string, permissionKey: string) {
    setStaffUsers((current) =>
      current.map((user) => {
        if (user.id !== id) return user

        if (user.role === 'admin') {
          return {
            ...user,
            permissions: defaultPermissions('admin'),
          }
        }

        return {
          ...user,
          permissions: {
            ...normalisePermissions(user.role || 'staff', user.permissions || {}),
            [permissionKey]: !Boolean(user.permissions?.[permissionKey]),
          },
        }
      })
    )
  }

  function updateField(field: string, value: any) {
    setSettings({
      ...settings,
      [field]: value,
    })
  }

  function getReferenceUrls() {
    return (settings.photo_reference_urls || '')
      .split('\n')
      .map((url: string) => url.trim())
      .filter(Boolean)
      .slice(0, 3)
  }

  async function getAverageColourFromImage(url: string) {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = url

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error(`Could not load image: ${url}`))
    })

    const canvas = document.createElement('canvas')
    const size = 80
    canvas.width = size
    canvas.height = size

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not create canvas')

    ctx.drawImage(img, 0, 0, size, size)

    const imageData = ctx.getImageData(0, 0, size, size).data

    let r = 0
    let g = 0
    let b = 0
    let count = 0

    for (let i = 0; i < imageData.length; i += 4) {
      r += imageData[i]
      g += imageData[i + 1]
      b += imageData[i + 2]
      count++
    }

    return {
      r: Math.round(r / count),
      g: Math.round(g / count),
      b: Math.round(b / count),
    }
  }

  async function calculateAverageBackgroundColour() {
    try {
      const urls = getReferenceUrls()

      if (urls.length === 0) {
        setMessage('Add at least one reference image URL first')
        return
      }

      setMessage('Calculating average background colour...')

      const colours = await Promise.all(
        urls.map((url: string) => getAverageColourFromImage(url))
      )

      const avg = colours.reduce(
        (total, colour) => ({
          r: total.r + colour.r,
          g: total.g + colour.g,
          b: total.b + colour.b,
        }),
        { r: 0, g: 0, b: 0 }
      )

      const r = Math.round(avg.r / colours.length)
      const g = Math.round(avg.g / colours.length)
      const b = Math.round(avg.b / colours.length)

      const hex =
        '#' +
        [r, g, b]
          .map((value) => value.toString(16).padStart(2, '0'))
          .join('')

      updateField('photo_background_colour', hex)
      setMessage(`Background colour set to ${hex}`)
    } catch (error: any) {
      setMessage(
        error.message ||
          'Could not calculate colour. The image URL may block browser access.'
      )
    }
  }

  function SectionHeader({
    section,
    title,
    description,
    colour = 'zinc',
  }: {
    section: OpenSection
    title: string
    description: string
    colour?: 'zinc' | 'blue' | 'emerald' | 'purple'
  }) {
    return null
  }

  if (!settings) {
    return (
      <StaffPermissionGate permission="settings">
        <main className="min-h-screen bg-zinc-950 p-5 text-white">
          Loading settings...
        </main>
      </StaffPermissionGate>
    )
  }

  const settingsMenu: {
    section: Exclude<OpenSection, null>
    title: string
    description: string
  }[] = [
    {
      section: 'integrations',
      title: 'Channel Integrations',
      description: 'Linnworks, eBay, Shopify, Vinted and other channels.',
    },
    {
      section: 'processing',
      title: 'Processing',
      description: 'Inbound, receiving and working workflow options.',
    },
    {
      section: 'locations',
      title: 'Locations',
      description: 'Display names and bin modes.',
    },
    {
      section: 'users',
      title: 'Users & Permissions',
      description: 'PINs, roles and access.',
    },
    {
      section: 'payroll',
      title: 'Payroll & Holidays',
      description: 'Payroll periods, holiday accrual and staff breaks.',
    },
    {
      section: 'appearance',
      title: 'Appearance',
      description: 'Light or dark mode.',
    },
    {
      section: 'fixed_costs',
      title: 'Fixed Costs',
      description: 'Profit and loss overheads.',
    },
    {
      section: 'photo',
      title: 'AI Photo Settings',
      description: 'Reference images and photo rules.',
    },
    {
      section: 'export',
      title: 'Image Export',
      description: 'Export size and quality.',
    },
    {
      section: 'copy',
      title: 'AI Copy Rules',
      description: 'Title and description generation.',
    },
  ]

  return (
    <StaffPermissionGate permission="settings">
      <main className="min-h-screen bg-zinc-950 p-5 text-white">
        <div className="app-header mb-5 flex flex-wrap items-start justify-between gap-4 rounded-3xl bg-black p-4 text-white shadow-2xl sm:p-5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
            <div>
              <h1 className="text-2xl font-black tracking-normal">Settings</h1>

              <p className="text-sm text-zinc-300">
                Open a section to change settings.
              </p>
            </div>

            <AppNav current="settings" />
          </div>

          <div className="flex items-center gap-3">
            {message && (
              <span className="rounded-lg border border-yellow-700 bg-yellow-950 px-4 py-2 text-sm font-bold text-yellow-300">
                {message}
              </span>
            )}

            <button
              onClick={saveSettings}
              className="rounded-lg bg-green-600 px-5 py-2 text-sm font-black text-white hover:bg-green-500"
            >
              Save Settings
            </button>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[280px_1fr]">
          <aside className="h-fit rounded-2xl border border-zinc-800 bg-zinc-900 p-3">
            <p className="mb-2 px-2 text-xs font-black uppercase tracking-wide text-zinc-500">
              Settings menu
            </p>

            <div className="space-y-2">
              {settingsMenu.map((item) => {
                const selected = openSection === item.section

                return (
                  <button
                    key={item.section}
                    type="button"
                    onClick={() => changeSettingsSection(item.section)}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      selected
                        ? 'border-emerald-500 bg-emerald-950 text-white'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600'
                    }`}
                  >
                    <span className="block text-sm font-black">{item.title}</span>
                    <span className="mt-1 block text-xs font-bold text-zinc-500">{item.description}</span>
                  </button>
                )
              })}
            </div>
          </aside>

          <div className="min-w-0 space-y-4">
          <SectionHeader
            section="integrations"
            title="Channel Integrations"
            description="Manage Linnworks, eBay, Shopify, Vinted, Square, Loyverse, Depop and TikTok Shop sync settings."
            colour="blue"
          />

          {openSection === 'integrations' && (
            <IntegrationsPanel />
          )}

          <SectionHeader
            section="processing"
            title="Processing"
            description="Choose whether receiving uses the RFID table workflow or the normal barcode/batch workflow."
            colour="emerald"
          />

          {openSection === 'processing' && (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-300">
                    Receiving Workflow
                  </h2>

                  <p className="mt-1 text-sm text-zinc-500">
                    This only controls Processing &gt; Receiving. RFID tags already linked to items still scan in Search/Create and Checkout.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  setSettings({
                    ...settings,
                    enable_rfid_receiving: !Boolean(settings.enable_rfid_receiving),
                  })
                }
                className={`w-full rounded-xl border p-4 text-left transition ${
                  settings.enable_rfid_receiving
                    ? 'border-emerald-600 bg-emerald-950 text-white'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-300'
                }`}
              >
                <span className="block text-sm font-black">
                  {settings.enable_rfid_receiving ? 'RFID receiving enabled' : 'RFID receiving disabled'}
                </span>
                <span className="mt-1 block text-sm font-bold text-zinc-400">
                  {settings.enable_rfid_receiving
                    ? 'Receiving will show the RFID table bridge, live TID count and TID-linked batch creation.'
                    : 'Receiving will create normal working batches without requiring the RFID table bridge.'}
                </span>
              </button>
            </section>
          )}

          <SectionHeader
            section="locations"
            title="Locations"
            description="Set display names for the five stable location slots used by bins, scanners and stock movement."
            colour="zinc"
          />

          {openSection === 'locations' && (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-300">
                    Location Display Names
                  </h2>

                  <p className="mt-1 text-sm text-zinc-500">
                    Internal codes stay fixed. Change the display names to match your business.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={saveLocations}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-black text-white hover:bg-green-500"
                >
                  Save Locations
                </button>
              </div>

              <div className="space-y-3">
                {locations.map((location, index) => (
                  <div
                    key={location.name}
                    className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4 xl:grid-cols-[150px_1fr_150px_1.5fr_120px]"
                  >
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-zinc-500">
                        Internal code
                      </label>

                      <div className="flex h-10 items-center rounded-lg border border-zinc-800 bg-zinc-900 px-3 font-mono text-sm font-black text-zinc-300">
                        {location.name}
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-zinc-500">
                        Display name
                      </label>

                      <input
                        value={location.label}
                        onChange={(event) =>
                          updateLocation(index, {
                            label: event.target.value.toUpperCase(),
                          })
                        }
                        className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm font-black uppercase text-white outline-none focus:border-white"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-zinc-500">
                        Bin setup
                      </label>

                      <select
                        value={location.bin_mode}
                        onChange={(event) =>
                          updateLocation(index, {
                            bin_mode: event.target.value as 'basic' | 'range',
                          })
                        }
                        className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm font-black uppercase text-white outline-none focus:border-white"
                      >
                        <option value="basic">Basic bins</option>
                        <option value="range">Range / allocate</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-zinc-500">
                        Basic bins
                      </label>

                      <div className="grid grid-cols-3 gap-2">
                        {[0, 1, 2].map((binIndex) => (
                          <input
                            key={binIndex}
                            value={location.basic_bins?.[binIndex] || ''}
                            onChange={(event) =>
                              updateLocationBasicBin(index, binIndex, event.target.value)
                            }
                            disabled={location.bin_mode !== 'basic'}
                            placeholder={`BIN ${binIndex + 1}`}
                            className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-2 text-xs font-black uppercase text-white outline-none focus:border-white disabled:opacity-40"
                          />
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-zinc-500">
                        Active
                      </label>

                      <button
                        type="button"
                        onClick={() =>
                          updateLocation(index, {
                            is_active: !location.is_active,
                          })
                        }
                        className={`h-10 w-full rounded-lg px-3 text-sm font-black ${
                          location.is_active
                            ? 'bg-green-700 text-white'
                            : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {location.is_active ? 'Active' : 'Hidden'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <SectionHeader
            section="users"
            title="Users & Permissions"
            description="Manage staff PINs, active users, roles and page permissions."
            colour="emerald"
          />

          {openSection === 'users' && (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-300">
                    Users & Roles
                  </h2>

                  <p className="mt-1 text-sm text-zinc-500">
                    Email login controls device/app access. Staff PIN controls who is using the app and what they can access.
                  </p>
                </div>

                <button
                  onClick={fetchStaffUsers}
                  className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-bold hover:bg-zinc-700"
                >
                  Refresh Users
                </button>
              </div>

              <div className="mb-5 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <h3 className="mb-3 text-sm font-bold text-zinc-300">
                  Add Staff User
                </h3>

                <div className="grid gap-3 md:grid-cols-[1fr_180px_180px_160px]">
                  <input
                    value={newStaffName}
                    onChange={(e) => setNewStaffName(e.target.value)}
                    placeholder="Staff name"
                    className="h-10 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-white"
                  />

                  <input
                    value={newStaffPin}
                    onChange={(e) => setNewStaffPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="PIN"
                    type="password"
                    inputMode="numeric"
                    className="h-10 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-white"
                  />

                  <select
                    value={newStaffRole}
                    onChange={(e) => updateNewStaffRole(e.target.value)}
                    className="h-10 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-white"
                  >
                    <option value="">Select role...</option>

                    {roleOptions.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={addStaffUser}
                    disabled={!canAddNewStaff}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
                  >
                    Add User
                  </button>
                </div>

                <div className="mt-4">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">
                    New User Permissions
                  </p>

                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {permissionOptions.map((permission) => {
                      const enabled = Boolean(newStaffPermissions[permission.key])
                      const locked = newStaffRole === 'admin'

                      return (
                        <button
                          key={permission.key}
                          type="button"
                          onClick={() => toggleNewStaffPermission(permission.key)}
                          disabled={locked || !newStaffRole}
                          className={`rounded-lg px-3 py-2 text-left text-xs font-black disabled:cursor-not-allowed ${
                            enabled
                              ? 'bg-emerald-900 text-emerald-100'
                              : 'bg-zinc-800 text-zinc-500'
                          }`}
                        >
                          {enabled ? '✓ ' : '— '}
                          {permission.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {staffUsers.length === 0 ? (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm font-bold text-zinc-500">
                    No staff users found.
                  </div>
                ) : (
                  staffUsers.map((user) => {
                    const lastAdmin = isLastActiveAdmin(user)

                    if (user.is_active === false) {
                      return (
                        <div
                          key={user.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-900 bg-red-950/30 p-4"
                        >
                          <div>
                            <p className="text-sm font-black text-white">{user.name}</p>
                            <p className="mt-1 text-xs font-bold uppercase tracking-wide text-red-300">
                              Inactive user
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => reactivateStaffUser(user)}
                            disabled={savingStaffId === user.id}
                            className="h-10 rounded-lg bg-emerald-700 px-4 text-xs font-black text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {savingStaffId === user.id ? 'Saving' : 'Reactivate'}
                          </button>
                        </div>
                      )
                    }

                    return (
                      <div
                        key={user.id}
                        className={`rounded-xl border p-4 ${
                          user.is_active
                            ? 'border-zinc-800 bg-zinc-950'
                            : 'border-red-900 bg-red-950/30'
                        }`}
                      >
                        <div className="grid gap-3 xl:grid-cols-[1fr_160px_120px_240px]">
                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-zinc-500">
                              Name
                            </label>

                            <input
                              value={user.name || ''}
                              onChange={(e) =>
                                updateStaffUser(user.id, { name: e.target.value })
                              }
                              className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-white outline-none focus:border-white"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-zinc-500">
                              Role
                            </label>

                            <select
                              value={user.role || 'staff'}
                              onChange={(e) => updateStaffRole(user.id, e.target.value)}
                              disabled={lastAdmin}
                              className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-white outline-none focus:border-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {roleOptions.map((role) => (
                                <option key={role} value={role}>
                                  {role}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-zinc-500">
                              Active
                            </label>

                            <button
                              type="button"
                              onClick={() =>
                                updateStaffUser(user.id, {
                                  is_active: !user.is_active,
                                })
                              }
                              disabled={lastAdmin}
                              className={`h-10 w-full rounded-lg px-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-60 ${
                                user.is_active
                                  ? 'bg-green-700 text-white'
                                  : 'bg-red-800 text-white'
                              }`}
                            >
                              {user.is_active ? 'Active' : 'Disabled'}
                            </button>
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-zinc-500">
                              Actions
                            </label>

                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => resetPin(user)}
                                className="h-10 flex-1 rounded-lg bg-yellow-700 px-3 text-xs font-black text-white hover:bg-yellow-600"
                              >
                                Reset PIN
                              </button>

                              <button
                                type="button"
                                onClick={() => saveStaffUser(user)}
                                disabled={savingStaffId === user.id}
                                className="h-10 flex-1 rounded-lg bg-blue-600 px-3 text-xs font-black text-white hover:bg-blue-500 disabled:opacity-40"
                              >
                                {savingStaffId === user.id ? 'Saving' : 'Save'}
                              </button>

                              <button
                                type="button"
                                onClick={() => deleteStaffUser(user)}
                                disabled={savingStaffId === user.id || lastAdmin || !user.is_active}
                                className="h-10 flex-1 rounded-lg bg-red-700 px-3 text-xs font-black text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4">
                          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">
                            Permissions
                          </p>

                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            {permissionOptions.map((permission) => {
                              const enabled = Boolean(user.permissions?.[permission.key])
                              const locked = user.role === 'admin'

                              return (
                                <button
                                  key={permission.key}
                                  type="button"
                                  onClick={() =>
                                    togglePermission(user.id, permission.key)
                                  }
                                  disabled={locked}
                                  className={`rounded-lg px-3 py-2 text-left text-xs font-black disabled:cursor-not-allowed disabled:opacity-80 ${
                                    enabled
                                      ? 'bg-emerald-900 text-emerald-100'
                                      : 'bg-zinc-800 text-zinc-500'
                                  }`}
                                >
                                  {enabled ? '✓ ' : '— '}
                                  {permission.label}
                                  {locked ? ' locked' : ''}
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-zinc-500">
                          <span>ID: {user.id}</span>

                          {lastAdmin && (
                            <span className="rounded bg-emerald-950 px-2 py-1 text-emerald-300">
                              Protected last active admin
                            </span>
                          )}

                          {user.must_change_pin && (
                            <span className="rounded bg-yellow-950 px-2 py-1 text-yellow-300">
                              Must change PIN
                            </span>
                          )}

                          {user.pin_updated_at && (
                            <span>
                              PIN updated:{' '}
                              {new Date(user.pin_updated_at).toLocaleString('en-GB')}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </section>
          )}

          <SectionHeader
            section="payroll"
            title="Payroll & Holidays"
            description="Set payroll periods, holiday year start, and per-staff holiday and break rules."
            colour="emerald"
          />

          {openSection === 'payroll' && (
            <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-300">
                    Payroll Defaults
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Reports use finalised rota weeks only. Breaks are deducted from work shifts, not holiday hours.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={savePayrollSettings}
                  className={`rounded-lg px-4 py-2 text-sm font-black text-white ${
                    payrollDirty ? 'bg-green-600 hover:bg-green-500' : 'bg-zinc-700'
                  }`}
                >
                  {payrollDirty ? 'Save Payroll Settings' : 'Payroll Settings Saved'}
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase text-zinc-500">
                    Pay period
                  </span>
                  <select
                    value={payrollSettings.payroll_period}
                    onChange={(event) =>
                      updatePayrollSettings({
                        payroll_period: event.target.value as PayrollPeriod,
                      })
                    }
                    className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm font-black text-white"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Bi-weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>

                {payrollSettings.payroll_period === 'monthly' ? (
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold uppercase text-zinc-500">
                      Pay period start date
                    </span>
                    <select
                      value={payrollSettings.payroll_start_day || 1}
                      onChange={(event) =>
                        updatePayrollSettings({
                          payroll_start_day: Number(event.target.value),
                        })
                      }
                      className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm font-black text-white"
                    >
                      {monthDayOptions.slice(0, 28).map((day) => (
                        <option key={day} value={day}>
                          {day}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold uppercase text-zinc-500">
                      Pay period start day
                    </span>
                    <select
                      value={payrollSettings.payroll_start_day || 1}
                      onChange={(event) =>
                        updatePayrollSettings({
                          payroll_start_day: Number(event.target.value),
                        })
                      }
                      className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm font-black text-white"
                    >
                      <option value={1}>Monday</option>
                      <option value={2}>Tuesday</option>
                      <option value={3}>Wednesday</option>
                      <option value={4}>Thursday</option>
                      <option value={5}>Friday</option>
                      <option value={6}>Saturday</option>
                      <option value={7}>Sunday</option>
                    </select>
                  </label>
                )}
              </div>

              <div className="relative max-w-xl">
                <span className="mb-1 block text-xs font-bold uppercase text-zinc-500">
                  Holiday year start date
                </span>
                <button
                  type="button"
                  onClick={() => setHolidayStartPickerOpen((value) => !value)}
                  className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-left text-sm font-black text-white"
                >
                  {monthOptions[(payrollSettings.holiday_year_start_month || 1) - 1]}{' '}
                  {payrollSettings.holiday_year_start_day || 1}
                </button>

                {holidayStartPickerOpen && (
                  <div className="absolute z-20 mt-2 grid w-[min(560px,90vw)] gap-3 rounded-xl border border-zinc-700 bg-zinc-950 p-4 shadow-2xl">
                    <div>
                      <p className="mb-2 text-xs font-black uppercase text-zinc-500">Month</p>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {monthOptions.map((month, index) => {
                          const selected = payrollSettings.holiday_year_start_month === index + 1
                          return (
                            <button
                              key={month}
                              type="button"
                              onClick={() =>
                                updatePayrollSettings({
                                  holiday_year_start_month: index + 1,
                                })
                              }
                              className={`rounded-lg px-3 py-2 text-xs font-black ${
                                selected ? 'bg-emerald-600 text-white' : 'bg-zinc-900 text-zinc-300'
                              }`}
                            >
                              {month.slice(0, 3)}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-black uppercase text-zinc-500">Day</p>
                      <div className="grid grid-cols-7 gap-1">
                        {monthDayOptions.map((day) => {
                          const selected = payrollSettings.holiday_year_start_day === day
                          return (
                            <button
                              key={day}
                              type="button"
                              onClick={() => {
                                updatePayrollSettings({ holiday_year_start_day: day })
                                setHolidayStartPickerOpen(false)
                              }}
                              className={`rounded-lg px-2 py-2 text-xs font-black ${
                                selected ? 'bg-emerald-600 text-white' : 'bg-zinc-900 text-zinc-300'
                              }`}
                            >
                              {day}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-zinc-500">
                  Staff Rules
                </h3>

                <div className="space-y-3">
                  {staffUsers.filter((user) => user.is_active !== false).map((user) => {
                    const staffPayroll = normalisePayrollStaffSettings(user.payroll_settings)

                    return (
                      <div
                        key={user.id}
                        className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 xl:grid-cols-[1.2fr_170px_150px_140px_220px]"
                      >
                        <div>
                          <p className="text-sm font-black text-white">{user.name}</p>
                          <p className="mt-1 text-xs font-bold text-zinc-500">{user.role || 'staff'}</p>
                        </div>

                        <div>
                          <span className="mb-1 block text-xs font-bold uppercase text-zinc-500">
                            Reports
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              updateStaffPayrollSettings(user.id, {
                                include_in_payroll: !staffPayroll.include_in_payroll,
                              })
                            }
                            className={`h-10 w-full rounded-lg px-3 text-xs font-black ${
                              staffPayroll.include_in_payroll
                                ? 'bg-emerald-700 text-white'
                                : 'bg-zinc-800 text-zinc-400'
                            }`}
                          >
                            {staffPayroll.include_in_payroll ? 'Included' : 'Excluded'}
                          </button>
                          <p className="mt-1 text-[10px] font-bold text-zinc-500">
                            Payroll & holiday figures
                          </p>
                        </div>

                        <label>
                          <span className="mb-1 block text-xs font-bold uppercase text-zinc-500">
                            Holiday
                          </span>
                          <select
                            value={staffPayroll.holiday_method}
                            onChange={(event) =>
                              updateStaffPayrollSettings(user.id, {
                                holiday_method: event.target.value as HolidayMethod,
                              })
                            }
                            className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-xs font-black text-white"
                          >
                            <option value="fixed_weeks">Fixed</option>
                            <option value="accrual_percent">Accrual</option>
                          </select>
                        </label>

                        {staffPayroll.holiday_method === 'accrual_percent' ? (
                          <label>
                            <span className="mb-1 block text-xs font-bold uppercase text-zinc-500">
                              Accrual %
                            </span>
                            <input
                              type="number"
                              step="0.01"
                              value={staffPayroll.accrual_percent}
                              onChange={(event) =>
                                updateStaffPayrollSettings(user.id, {
                                  accrual_percent: Number(event.target.value),
                                })
                              }
                              className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-xs font-black text-white"
                            />
                          </label>
                        ) : (
                          <label>
                            <span className="mb-1 block text-xs font-bold uppercase text-zinc-500">
                              Fixed weeks
                            </span>
                            <input
                              type="number"
                              step="0.1"
                              value={staffPayroll.holiday_weeks}
                              onChange={(event) =>
                                updateStaffPayrollSettings(user.id, {
                                  holiday_weeks: Number(event.target.value),
                                })
                              }
                              className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-xs font-black text-white"
                            />
                          </label>
                        )}

                        <div>
                          <span className="mb-1 block text-xs font-bold uppercase text-zinc-500">
                            Unpaid break deduction
                          </span>
                          <div className="grid grid-cols-2 gap-2">
                            <label>
                              <span className="sr-only">Over 3 hours</span>
                              <input
                                type="number"
                                value={staffPayroll.break_4h_minutes}
                                onChange={(event) =>
                                  updateStaffPayrollSettings(user.id, {
                                    break_4h_minutes: Number(event.target.value),
                                  })
                                }
                                placeholder=">3 hrs"
                                className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-xs font-black text-white"
                              />
                              <span className="mt-1 block text-[10px] font-bold text-zinc-500">
                                &gt;3 hrs
                              </span>
                            </label>
                            <label>
                              <span className="sr-only">6 hours or more</span>
                              <input
                                type="number"
                                value={staffPayroll.break_6h_minutes}
                                onChange={(event) =>
                                  updateStaffPayrollSettings(user.id, {
                                    break_6h_minutes: Number(event.target.value),
                                  })
                                }
                                placeholder=">=6 hrs"
                                className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 text-xs font-black text-white"
                              />
                              <span className="mt-1 block text-[10px] font-bold text-zinc-500">
                                &ge;6 hrs
                              </span>
                            </label>
                          </div>
                        </div>

                      </div>
                    )
                  })}
                </div>
              </div>
            </section>
          )}

          <SectionHeader
            section="appearance"
            title="Appearance"
            description="Set the global light or dark display mode for app pages."
            colour="zinc"
          />

          {openSection === 'appearance' && (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
              <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-zinc-300">
                Global Theme
              </h2>

              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { key: 'light', label: 'Light', description: 'White page, black headers, green action accents.' },
                  { key: 'dark', label: 'Dark', description: 'Current dark warehouse/scanner style.' },
                ].map((option) => {
                  const selected = (settings.ui_theme || 'dark') === option.key

                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => {
                        updateField('ui_theme', option.key)
                        setStoredTheme(option.key)
                      }}
                      className={`rounded-xl border p-4 text-left ${
                        selected
                          ? 'border-green-500 bg-green-950 text-green-100'
                          : 'border-zinc-800 bg-zinc-950 text-zinc-300'
                      }`}
                    >
                      <span className="block text-lg font-black">{option.label}</span>
                      <span className="mt-1 block text-sm">{option.description}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          <SectionHeader
            section="fixed_costs"
            title="Fixed Costs"
            description="Recurring overheads used by the profit and loss report."
            colour="zinc"
          />

          {openSection === 'fixed_costs' && (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-300">
                    Fixed Costs
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Add rent, software, utilities, insurance, and other fixed costs for future profit/loss reports.
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={addFixedCost}
                    className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-black text-white hover:bg-zinc-700"
                  >
                    Add Cost
                  </button>
                  <button
                    type="button"
                    onClick={saveFixedCosts}
                    className="rounded-lg bg-green-600 px-4 py-2 text-sm font-black text-white hover:bg-green-500"
                  >
                    Save Costs
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {fixedCosts.length === 0 ? (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm font-bold text-zinc-500">
                    No fixed costs added yet.
                  </div>
                ) : (
                  fixedCosts.map((cost, index) => (
                    <div
                      key={cost.id || `new-${index}`}
                      className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4 xl:grid-cols-[1.5fr_130px_150px_1fr_120px]"
                    >
                      <input
                        value={cost.name}
                        onChange={(event) => updateFixedCost(index, { name: event.target.value })}
                        placeholder="Cost name"
                        className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm font-bold text-white outline-none focus:border-white"
                      />
                      <input
                        type="number"
                        value={cost.amount}
                        onChange={(event) => updateFixedCost(index, { amount: Number(event.target.value) })}
                        placeholder="Amount"
                        className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm font-bold text-white outline-none focus:border-white"
                      />
                      <select
                        value={cost.cadence}
                        onChange={(event) => updateFixedCost(index, { cadence: event.target.value })}
                        className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm font-bold text-white outline-none focus:border-white"
                      >
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                      <input
                        value={cost.category || ''}
                        onChange={(event) => updateFixedCost(index, { category: event.target.value })}
                        placeholder="Category"
                        className="h-10 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm font-bold text-white outline-none focus:border-white"
                      />
                      <button
                        type="button"
                        onClick={() => updateFixedCost(index, { is_active: !cost.is_active })}
                        className={`h-10 rounded-lg px-3 text-sm font-black ${
                          cost.is_active ? 'bg-green-700 text-white' : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {cost.is_active ? 'Active' : 'Paused'}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          <SectionHeader
            section="photo"
            title="AI Photo Settings"
            description="Reference images, AI photo rules and background colour matching."
            colour="zinc"
          />

          {openSection === 'photo' && (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
              <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-zinc-300">
                AI Photo Settings
              </h2>

              <div className="space-y-4">
                <textarea
                  value={settings.photo_reference_urls || ''}
                  onChange={(e) =>
                    updateField('photo_reference_urls', e.target.value)
                  }
                  placeholder="Reference image URLs (one per line)"
                  className="h-28 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm"
                />

                <textarea
                  value={settings.photo_ai_rules || ''}
                  onChange={(e) => updateField('photo_ai_rules', e.target.value)}
                  className="h-40 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm"
                />

                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <input
                    value={settings.photo_background_colour || ''}
                    onChange={(e) =>
                      updateField('photo_background_colour', e.target.value)
                    }
                    className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm"
                  />

                  <button
                    onClick={calculateAverageBackgroundColour}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold"
                  >
                    Average
                  </button>
                </div>
              </div>
            </section>
          )}

          <SectionHeader
            section="export"
            title="Image Export"
            description="Default export size and JPEG quality for processed images."
            colour="zinc"
          />

          {openSection === 'export' && (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
              <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-zinc-300">
                Image Export
              </h2>

              <div className="grid gap-4 md:grid-cols-2">
                <input
                  type="number"
                  value={settings.image_export_size || 1600}
                  onChange={(e) => updateField('image_export_size', e.target.value)}
                  className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm"
                />

                <input
                  type="number"
                  value={settings.image_export_quality || 0.85}
                  onChange={(e) =>
                    updateField('image_export_quality', e.target.value)
                  }
                  className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm"
                />
              </div>
            </section>
          )}

          <SectionHeader
            section="copy"
            title="AI Copy Rules"
            description="Rules used when generating item titles, descriptions and website copy."
            colour="purple"
          />

          {openSection === 'copy' && (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
              <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-zinc-300">
                AI Copy Rules
              </h2>

              <textarea
                value={settings.ai_copy_rules || ''}
                onChange={(e) => updateField('ai_copy_rules', e.target.value)}
                className="h-56 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm"
              />
            </section>
          )}
          </div>
        </div>
      </main>
    </StaffPermissionGate>
  )
}


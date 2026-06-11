'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { useCompany } from '@/app/context/CompanyContext'
import { supabase } from '@/lib/supabase'

type MembershipRow = {
  id: string
  role: string
  status: string
  user_id: string
  created_at: string
}

type InviteRow = {
  id: string
  email: string
  role: string
  status: string
  expires_at: string | null
  created_at: string
}

type IncomingInviteRow = InviteRow & {
  company?: {
    id: string
    name: string
    slug: string
    access_state: string
  } | null
}

type SubscriptionRow = {
  id: string
  provider: string
  plan_key: string
  status: string
  payment_status: string | null
  trial_ends_at: string | null
  current_period_end: string | null
  limits: Record<string, any>
}

type BillingPlanRow = {
  id: string
  plan_key: string
  name: string
  description: string | null
  is_public: boolean
  is_custom: boolean
  billing_plan_versions?: Array<{
    monthly_price: number | null
    yearly_price: number | null
    limits: Record<string, any>
    version: number
  }>
}

type DepartmentRow = {
  id?: string
  code: string
  name: string
  department_type: 'internal' | '3pl_client'
  royal_mail_department_id: string | null
  is_default: boolean
  is_active: boolean
}

type DeviceRow = {
  id?: string
  device_key: string
  name: string
  device_type: 'checkout' | 'scanner' | 'receiving' | 'admin_station' | 'station'
  allowed_areas: string[]
  is_active: boolean
}

const emptyDepartment: DepartmentRow = {
  code: '',
  name: '',
  department_type: 'internal',
  royal_mail_department_id: '',
  is_default: false,
  is_active: true,
}

const emptyDevice: DeviceRow = {
  device_key: '',
  name: '',
  device_type: 'station',
  allowed_areas: [],
  is_active: true,
}

const deviceAreaOptions = ['checkout', 'allocate', 'receiving', 'transfers', 'loan']

const settingsMenu = [
  {
    title: 'Company / Departments',
    description: 'Companies, members, billing, departments and devices.',
    href: '/settings/company',
    active: true,
  },
  {
    title: 'Channel Integrations',
    description: 'Marketplace and sync settings.',
    href: '/settings?section=integrations',
  },
  {
    title: 'Processing',
    description: 'Receiving workflow and RFID settings.',
    href: '/settings?section=processing',
  },
  {
    title: 'Locations',
    description: 'Location display names and bin modes.',
    href: '/settings?section=locations',
  },
  {
    title: 'Users & Permissions',
    description: 'Staff PINs, roles and permissions.',
    href: '/settings?section=users',
  },
  {
    title: 'Payroll & Holidays',
    description: 'Payroll periods, rates, holidays and breaks.',
    href: '/settings?section=payroll',
  },
  {
    title: 'Appearance',
    description: 'Light and dark mode.',
    href: '/settings?section=appearance',
  },
  {
    title: 'Fixed Costs',
    description: 'Overheads for reports.',
    href: '/settings?section=fixed_costs',
  },
  {
    title: 'AI Photo Settings',
    description: 'Reference images and photo rules.',
    href: '/settings?section=photo',
  },
  {
    title: 'Image Export',
    description: 'Export size and quality.',
    href: '/settings?section=export',
  },
  {
    title: 'AI Copy Rules',
    description: 'Title and description generation.',
    href: '/settings?section=copy',
  },
]

function statusLabel(value: string) {
  return (value || 'unknown').replaceAll('_', ' ')
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('en-GB')
}

function planPrice(plan: BillingPlanRow) {
  const version = plan.billing_plan_versions?.[0]
  const monthly = Number(version?.monthly_price || 0)
  return monthly > 0 ? `£${monthly.toFixed(0)} / month` : 'Custom'
}

function planName(planKey?: string | null) {
  return String(planKey || 'starter')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatLimit(value: any) {
  return value === null || value === undefined ? 'Unlimited' : String(value)
}

function usageText(used: number, limit: any) {
  return `${used} / ${formatLimit(limit)}`
}

function limitReached(used: number, limit: any) {
  if (limit === null || limit === undefined) return false
  return used >= Number(limit || 0)
}

export default function CompanySettingsPanel({
  embedded = false,
  onOpenBilling,
}: { embedded?: boolean; onOpenBilling?: () => void } = {}) {
  const {
    activeCompany,
    activeCompanyId,
    companies,
    deviceLockedCompany,
    deviceLockedCompanyId,
    lockDeviceToCompany,
    loading,
    memberships,
    refreshCompanies,
    schemaReady,
    serviceRestricted,
    setActiveCompanyId,
    unlockDeviceCompany,
  } = useCompany()
  const [members, setMembers] = useState<MembershipRow[]>([])
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [incomingInvites, setIncomingInvites] = useState<IncomingInviteRow[]>([])
  const [departments, setDepartments] = useState<DepartmentRow[]>([])
  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([])
  const [plans, setPlans] = useState<BillingPlanRow[]>([])
  const [usage, setUsage] = useState({
    staff: 0,
    devices: 0,
    locations: 0,
    channels: 0,
    skus: 0,
  })
  const [departmentDraft, setDepartmentDraft] = useState<DepartmentRow>(emptyDepartment)
  const [deviceDraft, setDeviceDraft] = useState<DeviceRow>(emptyDevice)
  const [companyNameDraft, setCompanyNameDraft] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')

  const activeSubscription = subscriptions[0] || null
  const companyLimit = activeSubscription?.limits?.company_limit
  const effectiveCompanyLimit =
    activeCompany?.billing_exempt || activeCompany?.internal_account ? null : companyLimit ?? 1
  const effectiveDepartmentLimit =
    activeCompany?.billing_exempt || activeCompany?.internal_account
      ? null
      : activeSubscription?.limits?.department_limit
  const effectiveDeviceLimit =
    activeCompany?.billing_exempt || activeCompany?.internal_account
      ? null
      : activeSubscription?.limits?.device_limit
  const activeMembership = memberships.find((membership) => membership.company_id === activeCompanyId)
  const canManageCompany = ['owner', 'admin'].includes(String(activeMembership?.role || ''))
  const hasRealCompanyMembership = memberships.length > 0
  const managedCompanyCount = hasRealCompanyMembership ? companies.length : 0
  const canCreateAdditionalCompany =
    !hasRealCompanyMembership ||
    activeCompany?.billing_exempt ||
    activeCompany?.internal_account ||
    companyLimit === null ||
    managedCompanyCount < Number(companyLimit || 1)

  useEffect(() => {
    fetchCompanySettings()
  }, [activeCompanyId, schemaReady])

  useEffect(() => {
    fetchIncomingInvites()
  }, [schemaReady])

  async function fetchIncomingInvites() {
    if (!schemaReady) {
      setIncomingInvites([])
      return
    }

    const response = await fetch('/api/companies/invites/incoming')
    const data = await response.json().catch(() => null)

    if (!response.ok || !data?.ok) {
      setIncomingInvites([])
      return
    }

    setIncomingInvites((data.invites || []) as IncomingInviteRow[])
  }

  async function fetchCompanySettings() {
    if (!schemaReady || !activeCompanyId || activeCompanyId === 'single-company-fallback') {
      setMembers([])
      setInvites([])
      setDepartments([])
      setDevices([])
      setSubscriptions([])
      setUsage({ staff: 0, devices: 0, locations: 0, channels: 0, skus: 0 })
      return
    }

    const [
      membershipResult,
      inviteResult,
      departmentResult,
      deviceResult,
      subscriptionResult,
      planResult,
      staffCountResult,
      locationCountResult,
      channelCountResult,
      skuCountResult,
    ] = await Promise.all([
      supabase
        .from('company_memberships')
        .select('id, role, status, user_id, created_at')
        .eq('company_id', activeCompanyId)
        .order('created_at', { ascending: true }),
      supabase
        .from('company_invites')
        .select('id, email, role, status, expires_at, created_at')
        .eq('company_id', activeCompanyId)
        .order('created_at', { ascending: false }),
      supabase
        .from('company_departments')
        .select('id, code, name, department_type, royal_mail_department_id, is_default, is_active')
        .eq('company_id', activeCompanyId)
        .order('is_default', { ascending: false })
        .order('name', { ascending: true }),
      supabase
        .from('company_devices')
        .select('id, device_key, name, device_type, allowed_areas, is_active')
        .eq('company_id', activeCompanyId)
        .order('name', { ascending: true }),
      supabase
        .from('company_subscriptions')
        .select('id, provider, plan_key, status, payment_status, trial_ends_at, current_period_end, limits')
        .eq('company_id', activeCompanyId)
        .order('created_at', { ascending: false }),
      supabase
        .from('billing_plans')
        .select('id, plan_key, name, description, is_public, is_custom, billing_plan_versions(monthly_price, yearly_price, limits, version)')
        .eq('is_active', true)
        .order('is_public', { ascending: false }),
      supabase
        .from('staff_users')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', activeCompanyId)
        .eq('is_active', true),
      supabase
        .from('locations')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', activeCompanyId)
        .eq('is_active', true),
      supabase
        .from('integration_settings')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', activeCompanyId)
        .eq('enabled', true),
      supabase
        .from('items')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', activeCompanyId),
    ])

    if (membershipResult.error) {
      setMessage(membershipResult.error.message)
      return
    }

    if (inviteResult.error) setMessage(inviteResult.error.message)
    if (departmentResult.error) setMessage(departmentResult.error.message)
    if (deviceResult.error) setMessage(deviceResult.error.message)
    if (subscriptionResult.error) setMessage(subscriptionResult.error.message)
    if (planResult.error) setMessage(planResult.error.message)
    if (staffCountResult.error) setMessage(staffCountResult.error.message)
    if (locationCountResult.error) setMessage(locationCountResult.error.message)
    if (channelCountResult.error) setMessage(channelCountResult.error.message)
    if (skuCountResult.error) setMessage(skuCountResult.error.message)

    setMembers((membershipResult.data || []) as MembershipRow[])
    setInvites((inviteResult.data || []) as InviteRow[])
    setDepartments((departmentResult.data || []) as DepartmentRow[])
    setDevices((deviceResult.data || []) as DeviceRow[])
    setSubscriptions((subscriptionResult.data || []) as SubscriptionRow[])
    setPlans((planResult.data || []) as BillingPlanRow[])
    setUsage({
      staff: staffCountResult.count || 0,
      devices: (deviceResult.data || []).filter((device: any) => device.is_active).length,
      locations: locationCountResult.count || 0,
      channels: channelCountResult.count || 0,
      skus: skuCountResult.count || 0,
    })
  }

  async function createCompany() {
    if (!canManageCompany && hasRealCompanyMembership) {
      setMessage('Only company owners or admins can create another company.')
      return
    }

    const name = companyNameDraft.trim()
    if (!name) {
      setMessage('Enter a company name first.')
      return
    }

    setBusy('company')
    const response = await fetch('/api/companies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })

    const data = await response.json().catch(() => null)
    setBusy('')

    if (!response.ok || !data?.ok) {
      setMessage(data?.message || 'Company could not be created.')
      return
    }

    setCompanyNameDraft('')
    setMessage(`${data.company.name} created.`)
    await refreshCompanies()
    await setActiveCompanyId(data.company.id)
  }

  async function createInvite() {
    if (!canManageCompany) {
      setMessage('Only company owners or admins can invite members.')
      return
    }

    const email = inviteEmail.trim()
    if (!email) {
      setMessage('Enter an email address first.')
      return
    }

    setBusy('invite')
    const response = await fetch('/api/companies/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, role: inviteRole }),
    })

    const data = await response.json().catch(() => null)
    setBusy('')

    if (!response.ok || !data?.ok) {
      setMessage(data?.message || 'Invite could not be created.')
      return
    }

    setInviteEmail('')
    setInviteRole('member')
    setMessage(`Invite created for ${data.invite.email}.`)
    fetchCompanySettings()
  }

  async function acceptInvite(inviteId: string) {
    setBusy(`accept-${inviteId}`)
    const response = await fetch('/api/companies/invites/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inviteId }),
    })

    const data = await response.json().catch(() => null)
    setBusy('')

    if (!response.ok || !data?.ok) {
      setMessage(data?.message || 'Invite could not be accepted.')
      return
    }

    setMessage('Invite accepted.')
    await refreshCompanies()
    if (data.companyId) {
      await setActiveCompanyId(data.companyId)
    }
    await fetchIncomingInvites()
    await fetchCompanySettings()
  }

  async function saveDepartment() {
    if (!schemaReady || !activeCompanyId) return
    if (!canManageCompany) {
      setMessage('Only company owners or admins can manage departments.')
      return
    }

    const code = departmentDraft.code.trim().toUpperCase()
    const name = departmentDraft.name.trim()

    if (!code || !name) {
      setMessage('Department code and name are required.')
      return
    }

    const existingDepartment = departments.find((department) => department.code === code)
    if (!existingDepartment && limitReached(departments.length, effectiveDepartmentLimit)) {
      setMessage('This plan has reached its department / 3PL client limit.')
      return
    }

    setBusy('department')

    const { error } = await supabase.from('company_departments').upsert(
      {
        company_id: activeCompanyId,
        code,
        name,
        department_type: departmentDraft.department_type,
        royal_mail_department_id: departmentDraft.royal_mail_department_id?.trim() || null,
        is_default: departmentDraft.is_default,
        is_active: departmentDraft.is_active,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,code' }
    )

    setBusy('')

    if (error) {
      setMessage(error.message)
      return
    }

    setDepartmentDraft(emptyDepartment)
    setMessage('Department saved.')
    fetchCompanySettings()
  }

  async function saveDevice() {
    if (!schemaReady || !activeCompanyId) return
    if (!canManageCompany) {
      setMessage('Only company owners or admins can manage devices.')
      return
    }

    const deviceKey = deviceDraft.device_key.trim().toLowerCase()
    const name = deviceDraft.name.trim()

    if (!deviceKey || !name) {
      setMessage('Device key and name are required.')
      return
    }

    const existingDevice = devices.find((device) => device.device_key === deviceKey)
    if (!existingDevice && limitReached(usage.devices, effectiveDeviceLimit)) {
      setMessage('This plan has reached its device profile limit.')
      return
    }

    setBusy('device')

    const { error } = await supabase.from('company_devices').upsert(
      {
        company_id: activeCompanyId,
        device_key: deviceKey,
        name,
        device_type: deviceDraft.device_type,
        allowed_areas: deviceDraft.allowed_areas,
        is_active: deviceDraft.is_active,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,device_key' }
    )

    setBusy('')

    if (error) {
      setMessage(error.message)
      return
    }

    setDeviceDraft(emptyDevice)
    setMessage('Device saved.')
    fetchCompanySettings()
  }

  function toggleDeviceArea(area: string) {
    setDeviceDraft((current) => {
      const selected = current.allowed_areas.includes(area)
      return {
        ...current,
        allowed_areas: selected
          ? current.allowed_areas.filter((item) => item !== area)
          : [...current.allowed_areas, area],
      }
    })
  }

  return (
    <StaffPermissionGate permission="settings">
      <main className={embedded ? 'contents' : 'min-h-screen bg-zinc-950 p-5 text-white'}>
        {!embedded && (
          <div className="app-header mb-5 flex flex-wrap items-start justify-between gap-4 rounded-3xl bg-black p-4 text-white shadow-2xl sm:p-5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
              <div>
                <h1 className="text-2xl font-black tracking-normal">Company</h1>
                <p className="text-sm text-zinc-300">
                  Company access, members, billing status, and SaaS workspace controls.
                </p>
              </div>

              <AppNav current="settings" />
            </div>
          </div>
        )}

        <div className={embedded ? 'space-y-4' : 'grid gap-5 xl:grid-cols-[280px_1fr]'}>
          {!embedded && (
          <aside className="h-fit rounded-2xl border border-zinc-800 bg-zinc-900 p-3">
            <p className="mb-2 px-2 text-xs font-black uppercase tracking-wide text-zinc-500">
              Settings menu
            </p>

            <div className="space-y-2">
              {settingsMenu.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block w-full rounded-xl border p-3 text-left transition ${
                    item.active
                      ? 'border-emerald-400 bg-emerald-700 text-white shadow-sm'
                      : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600'
                  }`}
                >
                  <span className="block text-sm font-black">{item.title}</span>
                  <span
                    className={`mt-1 block text-xs font-bold ${
                      item.active ? 'text-emerald-50' : 'text-zinc-500'
                    }`}
                  >
                    {item.description}
                  </span>
                </Link>
              ))}
            </div>
          </aside>
          )}

          <div className="min-w-0 space-y-4">
        {message && (
          <p className="rounded-xl border border-yellow-800 bg-yellow-950 p-3 text-sm font-bold text-yellow-200">
            {message}
          </p>
        )}

        {schemaReady && hasRealCompanyMembership && !canManageCompany && (
          <p className="rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-sm font-bold text-zinc-300">
            You can view company settings. Owner or admin membership is required to change
            members, departments, devices, billing, or company creation.
          </p>
        )}

        {!loading && !schemaReady && (
          <section className="rounded-2xl border border-yellow-800 bg-yellow-950/40 p-4">
            <h2 className="text-lg font-black text-yellow-100">Tenant migration not run yet</h2>
            <p className="mt-1 text-sm font-bold text-yellow-200">
              Run `sql/2026-06-07_multi_tenant_foundation.sql` to enable company
              memberships, billing state, and company switching.
            </p>
          </section>
        )}

        {incomingInvites.length > 0 && (
          <section className="rounded-2xl border border-emerald-800 bg-emerald-950/35 p-4">
            <h2 className="text-lg font-black text-emerald-100">Company Invites</h2>
            <p className="mt-1 text-sm font-bold text-emerald-200">
              These companies have invited your logged-in email.
            </p>

            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {incomingInvites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-800 bg-zinc-950 p-3"
                >
                  <div>
                    <p className="text-sm font-black text-white">
                      {invite.company?.name || 'Company invite'}
                    </p>
                    <p className="mt-1 text-xs font-bold uppercase text-emerald-200">
                      {invite.role} - expires {formatDate(invite.expires_at)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => acceptInvite(invite.id)}
                    disabled={busy === `accept-${invite.id}`}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {busy === `accept-${invite.id}` ? 'Accepting' : 'Accept'}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <h2 className="text-xl font-black">Company Details</h2>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                <p className="text-xs font-black uppercase text-zinc-500">Active company</p>
                <p className="mt-1 text-lg font-black">{activeCompany?.name || 'Loopbase'}</p>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                <p className="text-xs font-black uppercase text-zinc-500">Access state</p>
                <p className="mt-1 text-lg font-black">
                  {statusLabel(activeCompany?.access_state || 'active')}
                </p>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                <p className="text-xs font-black uppercase text-zinc-500">Billing</p>
                <p className="mt-1 text-lg font-black">
                  {activeCompany?.billing_exempt
                    ? 'Manual lifetime access'
                    : statusLabel(activeCompany?.subscription_status || 'not configured')}
                </p>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                <p className="text-xs font-black uppercase text-zinc-500">Known companies</p>
                <p className="mt-1 text-lg font-black">{companies.length}</p>
              </div>
            </div>

            {serviceRestricted && (
              <div className="mt-4 rounded-xl border border-red-800 bg-red-950 p-4 text-red-100">
                <p className="font-black">Operational access would be restricted.</p>
                <p className="mt-1 text-sm font-bold">
                  This placeholder is ready for the future billing gate. It does not block
                  the current app yet.
                </p>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <h2 className="text-xl font-black">Plan Usage</h2>
            <p className="mt-1 text-sm font-bold text-zinc-400">
              Current usage for the active company. These limits are enforced for non-internal
              companies.
            </p>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {[
                ['Companies', managedCompanyCount, effectiveCompanyLimit],
                ['Staff', usage.staff, activeSubscription?.limits?.staff_limit],
                ['Devices', usage.devices, activeSubscription?.limits?.device_limit],
                ['Locations', usage.locations, activeSubscription?.limits?.location_limit],
                ['Channels', usage.channels, activeSubscription?.limits?.channel_limit],
                ['Departments', departments.length, activeSubscription?.limits?.department_limit],
                ['SKUs', usage.skus, activeSubscription?.limits?.sku_limit],
              ].map(([label, used, limit]) => (
                <div key={String(label)} className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                  <p className="text-xs font-black uppercase text-zinc-500">{label}</p>
                  <p className="mt-1 text-lg font-black text-white">
                    {usageText(Number(used), limit)}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="hidden">
            <h2 className="text-xl font-black">Add Company</h2>
            <p className="mt-1 text-sm font-bold text-zinc-400">
              Creates a new tenant under your login. Additional companies require
              Enterprise or internal access.
            </p>

            <p className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs font-bold text-zinc-300">
              Current companies: {managedCompanyCount} · Plan company limit:{' '}
              {activeCompany?.billing_exempt || activeCompany?.internal_account
                ? 'Internal unlimited'
                : formatLimit(companyLimit ?? 1)}
            </p>

            <div className="mt-4 flex gap-2">
              <input
                value={companyNameDraft}
                onChange={(event) => setCompanyNameDraft(event.target.value)}
                placeholder="Company name"
                className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-bold text-white outline-none"
              />

              <button
                type="button"
                onClick={createCompany}
                disabled={
                  busy === 'company' ||
                  !schemaReady ||
                  (!canManageCompany && hasRealCompanyMembership) ||
                  !canCreateAdditionalCompany
                }
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {busy === 'company' ? 'Creating' : 'Create'}
              </button>
            </div>

            {!canCreateAdditionalCompany && (
              <p className="mt-3 text-xs font-bold text-yellow-300">
                Enterprise is required before adding another company.
              </p>
            )}
          </section>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_420px]">
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <h2 className="text-xl font-black">Members</h2>
            <p className="mt-1 text-sm font-bold text-zinc-400">
              Supabase auth accounts that can access this company.
            </p>

            <div className="mt-4 grid gap-2 lg:grid-cols-[1fr_150px_auto]">
              <input
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="Invite email"
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-bold text-white outline-none"
              />
              <select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value)}
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-bold text-white outline-none"
              >
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="member">Member</option>
                <option value="billing">Billing</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="button"
                onClick={createInvite}
                disabled={busy === 'invite' || !schemaReady || !canManageCompany}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {busy === 'invite' ? 'Inviting' : 'Invite'}
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {members.length === 0 ? (
                <p className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm font-bold text-zinc-400">
                  No membership rows loaded yet.
                </p>
              ) : (
                members.map((member) => (
                  <div
                    key={member.id}
                    className="rounded-xl border border-zinc-800 bg-zinc-950 p-3"
                  >
                    <p className="truncate text-sm font-black">{member.user_id}</p>
                    <p className="mt-1 text-xs font-bold uppercase text-zinc-500">
                      {member.role} - {statusLabel(member.status)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <h2 className="text-xl font-black">Pending Invites</h2>
            <p className="mt-1 text-sm font-bold text-zinc-400">
              Email sending and invite acceptance can be connected next.
            </p>

            <div className="mt-4 space-y-2">
              {invites.length === 0 ? (
                <p className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm font-bold text-zinc-400">
                  No pending invites.
                </p>
              ) : (
                invites.map((invite) => (
                  <div
                    key={invite.id}
                    className="rounded-xl border border-zinc-800 bg-zinc-950 p-3"
                  >
                    <p className="truncate text-sm font-black">{invite.email}</p>
                    <p className="mt-1 text-xs font-bold uppercase text-zinc-500">
                      {invite.role} - {statusLabel(invite.status)} - expires{' '}
                      {formatDate(invite.expires_at)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <h2 className="text-xl font-black">Departments / 3PL Clients</h2>
            <p className="mt-1 text-sm font-bold text-zinc-400">
              Add internal cost centres or third-party fulfilment clients.
            </p>
            <p className="mt-2 text-xs font-bold text-zinc-500">
              Usage: {usageText(departments.length, effectiveDepartmentLimit)}
            </p>

            <div className="mt-4 grid gap-3 lg:grid-cols-[110px_1fr_150px]">
              <input
                value={departmentDraft.code}
                onChange={(event) =>
                  setDepartmentDraft((current) => ({ ...current, code: event.target.value }))
                }
                placeholder="Code"
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-bold text-white outline-none"
              />

              <input
                value={departmentDraft.name}
                onChange={(event) =>
                  setDepartmentDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Department or client name"
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-bold text-white outline-none"
              />

              <select
                value={departmentDraft.department_type}
                onChange={(event) =>
                  setDepartmentDraft((current) => ({
                    ...current,
                    department_type: event.target.value as DepartmentRow['department_type'],
                  }))
                }
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-bold text-white outline-none"
              >
                <option value="internal">Internal</option>
                <option value="3pl_client">3PL client</option>
              </select>

              <input
                value={departmentDraft.royal_mail_department_id || ''}
                onChange={(event) =>
                  setDepartmentDraft((current) => ({
                    ...current,
                    royal_mail_department_id: event.target.value,
                  }))
                }
                placeholder="Royal Mail department ID"
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-bold text-white outline-none lg:col-span-2"
              />

              <button
                type="button"
                onClick={saveDepartment}
                disabled={
                  busy === 'department' ||
                  !schemaReady ||
                  !canManageCompany ||
                  (!departments.some(
                    (department) => department.code === departmentDraft.code.trim().toUpperCase()
                  ) &&
                    limitReached(departments.length, effectiveDepartmentLimit))
                }
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {busy === 'department' ? 'Saving' : 'Save Department'}
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {departments.length === 0 ? (
                <p className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm font-bold text-zinc-400">
                  No departments yet.
                </p>
              ) : (
                departments.map((department) => (
                  <div
                    key={department.id || department.code}
                    className="rounded-xl border border-zinc-800 bg-zinc-950 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-black">{department.name}</p>
                        <p className="mt-1 text-xs font-bold uppercase text-zinc-500">
                          {department.code} -{' '}
                          {department.department_type === '3pl_client'
                            ? '3PL client'
                            : 'Internal'}
                        </p>
                      </div>

                      {department.is_default && (
                        <span className="rounded-full bg-emerald-700 px-2 py-1 text-xs font-black text-white">
                          Default
                        </span>
                      )}
                    </div>

                    {department.royal_mail_department_id && (
                      <p className="mt-2 text-xs font-bold text-zinc-400">
                        Royal Mail: {department.royal_mail_department_id}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <h2 className="text-xl font-black">Devices / Stations</h2>
            <p className="mt-1 text-sm font-bold text-zinc-400">
              Limited device profiles for tills, scanners, and receiving stations.
            </p>
            <p className="mt-2 text-xs font-bold text-zinc-500">
              Usage: {usageText(usage.devices, effectiveDeviceLimit)}
            </p>

            <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-black text-white">This browser/device</p>
                  <p className="mt-1 text-xs font-bold text-zinc-400">
                    {deviceLockedCompany
                      ? `Operational pages are locked to ${deviceLockedCompany.name}.`
                      : 'Operational pages use the current company until this browser is locked.'}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => lockDeviceToCompany(activeCompanyId)}
                    disabled={!schemaReady || !activeCompanyId}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    Lock to {activeCompany?.name || 'company'}
                  </button>

                  {deviceLockedCompanyId && (
                    <button
                      type="button"
                      onClick={unlockDeviceCompany}
                      className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-black text-white hover:bg-zinc-800"
                    >
                      Unlock
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[130px_1fr_150px]">
              <input
                value={deviceDraft.device_key}
                onChange={(event) =>
                  setDeviceDraft((current) => ({ ...current, device_key: event.target.value }))
                }
                placeholder="device-key"
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-bold text-white outline-none"
              />

              <input
                value={deviceDraft.name}
                onChange={(event) =>
                  setDeviceDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Device name"
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-bold text-white outline-none"
              />

              <select
                value={deviceDraft.device_type}
                onChange={(event) =>
                  setDeviceDraft((current) => ({
                    ...current,
                    device_type: event.target.value as DeviceRow['device_type'],
                  }))
                }
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-bold text-white outline-none"
              >
                <option value="checkout">Checkout</option>
                <option value="scanner">Scanner</option>
                <option value="receiving">Receiving</option>
                <option value="admin_station">Admin station</option>
                <option value="station">Station</option>
              </select>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {deviceAreaOptions.map((area) => {
                const selected = deviceDraft.allowed_areas.includes(area)
                return (
                  <button
                    key={area}
                    type="button"
                    onClick={() => toggleDeviceArea(area)}
                    className={`rounded-lg px-3 py-2 text-xs font-black ${
                      selected
                        ? 'bg-emerald-600 text-white'
                        : 'border border-zinc-700 bg-zinc-950 text-zinc-300'
                    }`}
                  >
                    {area}
                  </button>
                )
              })}
            </div>

            <button
              type="button"
              onClick={saveDevice}
              disabled={
                busy === 'device' ||
                !schemaReady ||
                !canManageCompany ||
                (!devices.some(
                  (device) => device.device_key === deviceDraft.device_key.trim().toLowerCase()
                ) &&
                  limitReached(usage.devices, effectiveDeviceLimit))
              }
              className="mt-3 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy === 'device' ? 'Saving' : 'Save Device'}
            </button>

            <div className="mt-4 space-y-2">
              {devices.length === 0 ? (
                <p className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm font-bold text-zinc-400">
                  No device profiles yet.
                </p>
              ) : (
                devices.map((device) => (
                  <div
                    key={device.id || device.device_key}
                    className="rounded-xl border border-zinc-800 bg-zinc-950 p-3"
                  >
                    <p className="font-black">{device.name}</p>
                    <p className="mt-1 text-xs font-bold uppercase text-zinc-500">
                      {device.device_key} - {device.device_type}
                    </p>
                    <p className="mt-2 text-xs font-bold text-zinc-400">
                      Areas: {device.allowed_areas?.length ? device.allowed_areas.join(', ') : 'none'}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <section className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-xl font-black">Billing / Plan</h2>
          <p className="mt-1 text-sm font-bold text-zinc-400">
            Membership controls who belongs to the company. Billing controls whether this
            company has active service.
          </p>

          <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase text-zinc-500">Current plan</p>
                <p className="mt-1 text-2xl font-black text-white">
                  {activeCompany?.billing_exempt || activeCompany?.internal_account
                    ? 'Internal Lifetime'
                    : planName(activeSubscription?.plan_key)}
                </p>
                <p className="mt-2 text-sm font-bold text-zinc-400">
                  {activeSubscription
                    ? `${statusLabel(activeSubscription.status)} - ${statusLabel(
                        activeSubscription.payment_status || 'no payment status'
                      )}`
                    : 'No subscription row found for this company.'}
                </p>
                {activeSubscription?.trial_ends_at && (
                  <p className="mt-1 text-xs font-bold text-zinc-500">
                    Trial ends: {formatDate(activeSubscription.trial_ends_at)}
                  </p>
                )}
              </div>

              {onOpenBilling ? (
                <button
                  type="button"
                  onClick={onOpenBilling}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-500"
                >
                  Change Subscription
                </button>
              ) : (
                <Link
                  href="/settings?section=billing"
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-500"
                >
                  Change Subscription
                </Link>
              )}
            </div>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-black">Add Company</h2>
              <p className="mt-1 text-sm font-bold text-zinc-400">
                Creates a new tenant under your login. Additional companies require
                Enterprise or internal access.
              </p>
            </div>

            <p className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs font-bold text-zinc-300">
              Current companies: {managedCompanyCount} · Plan company limit:{' '}
              {activeCompany?.billing_exempt || activeCompany?.internal_account
                ? 'Internal unlimited'
                : formatLimit(companyLimit ?? 1)}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <input
              value={companyNameDraft}
              onChange={(event) => setCompanyNameDraft(event.target.value)}
              placeholder="Company name"
              className="min-w-[220px] flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-bold text-white outline-none"
            />

            <button
              type="button"
              onClick={createCompany}
              disabled={
                busy === 'company' ||
                !schemaReady ||
                (!canManageCompany && hasRealCompanyMembership) ||
                !canCreateAdditionalCompany
              }
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy === 'company' ? 'Creating' : 'Create'}
            </button>
          </div>

          {!canCreateAdditionalCompany && (
            <p className="mt-3 text-xs font-bold text-yellow-300">
              Enterprise is required before adding another company.
            </p>
          )}
        </section>
          </div>
        </div>
      </main>
    </StaffPermissionGate>
  )
}


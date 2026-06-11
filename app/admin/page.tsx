'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type CompanyRow = {
  id: string
  name: string
  slug: string
  access_state: string
  billing_exempt: boolean | null
  internal_account: boolean | null
}

type FeatureModuleRow = {
  feature_key: string
  name: string
  description: string | null
  category: string
  is_active: boolean
}

type CompanyFeatureRow = {
  id: string
  company_id: string
  feature_key: string
  enabled: boolean
}

type AdminRow = {
  id: string
  role: string
  is_active: boolean
}

type SupportTicketRow = {
  id: string
  company_id: string
  subject: string
  status: string
  priority: string
  category: string
  created_by: string
  last_reply_at: string | null
  last_customer_reply_at: string | null
  last_admin_reply_at: string | null
  created_at: string
  updated_at: string
  company?: {
    name?: string | null
    slug?: string | null
  } | null
}

type SupportTicketMessageRow = {
  id: string
  sender_type: 'customer' | 'admin'
  body: string
  is_internal_note: boolean
  created_at: string
}

type BillingPlanVersionRow = {
  id: string
  version: number
  monthly_price: number | null
  yearly_price: number | null
  limits: Record<string, any>
  features: Record<string, any>
}

type BillingPlanRow = {
  id: string
  plan_key: string
  name: string
  description: string | null
  is_public: boolean
  is_custom: boolean
  is_active: boolean
  billing_plan_versions?: BillingPlanVersionRow[]
}

type PlanDraft = {
  description: string
  monthly_price: string
  yearly_price: string
  limits: Record<string, any>
  features: Record<string, any>
  apply_existing: boolean
}

const planOrder = ['starter', 'growth', 'pro', 'enterprise', 'internal_lifetime']

const planLimitDefinitions = [
  { key: 'company_limit', label: 'Companies', type: 'number' },
  { key: 'sku_limit', label: 'SKUs', type: 'number' },
  { key: 'user_limit', label: 'Login users', type: 'number' },
  { key: 'staff_limit', label: 'Staff / PIN profiles', type: 'number' },
  { key: 'device_limit', label: 'Devices', type: 'number' },
  { key: 'location_limit', label: 'Locations', type: 'number' },
  { key: 'channel_limit', label: 'Channels', type: 'number' },
  { key: 'department_limit', label: 'Departments / 3PL clients', type: 'number' },
  { key: 'monthly_pos_transactions', label: 'POS transactions / month', type: 'number' },
  { key: 'monthly_online_orders', label: 'Online orders / month', type: 'number' },
  { key: 'monthly_ai_generations', label: 'AI generations / month', type: 'number' },
  { key: 'api_calls_per_month', label: 'API calls / month', type: 'number' },
  { key: 'storage_gb', label: 'Storage GB', type: 'number' },
  { key: 'photo_storage_gb', label: 'Photo storage GB', type: 'number' },
  { key: 'audit_log_retention_days', label: 'Audit log retention days', type: 'number' },
  { key: 'data_retention_days', label: 'Data retention days', type: 'number' },
  { key: 'cron_interval_minutes', label: 'Minimum cron interval minutes', type: 'number' },
  { key: 'support_sla_hours', label: 'Support SLA hours', type: 'number' },
]

const planFeatureDefinitions = [
  { key: 'rfid_workflows', label: 'RFID workflows' },
  { key: 'advanced_reports', label: 'Advanced reports' },
  { key: 'payroll_reports', label: 'Payroll reports' },
  { key: 'pos_offline_queue', label: 'Offline POS queue' },
  { key: 'marketplace_listing', label: 'Marketplace listing' },
  { key: 'linnworks_sync', label: 'Linnworks sync' },
  { key: 'direct_ebay', label: 'Direct eBay publish' },
  { key: 'royal_mail_integration', label: 'Royal Mail integration' },
  { key: 'multi_warehouse', label: 'Multi-warehouse' },
  { key: 'custom_domain', label: 'Custom domain' },
  { key: 'priority_support', label: 'Priority support' },
  { key: 'dedicated_support', label: 'Dedicated support' },
]

function isMissingSchema(error: any) {
  const message = String(error?.message || '').toLowerCase()
  return message.includes('does not exist') || message.includes('schema cache')
}

export default function PlatformAdminPage() {
  const [admin, setAdmin] = useState<AdminRow | null>(null)
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [features, setFeatures] = useState<FeatureModuleRow[]>([])
  const [companyFeatures, setCompanyFeatures] = useState<CompanyFeatureRow[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState('')
  const [message, setMessage] = useState('')
  const [supportMessage, setSupportMessage] = useState('')
  const [schemaReady, setSchemaReady] = useState(true)
  const [currentUser, setCurrentUser] = useState<{ id: string; email?: string | null } | null>(null)
  const [supportTickets, setSupportTickets] = useState<SupportTicketRow[]>([])
  const [selectedTicketId, setSelectedTicketId] = useState('')
  const [ticketReply, setTicketReply] = useState('')
  const [ticketStatus, setTicketStatus] = useState('waiting_on_customer')
  const [supportBusy, setSupportBusy] = useState(false)
  const [ticketMessages, setTicketMessages] = useState<SupportTicketMessageRow[]>([])
  const [billingPlans, setBillingPlans] = useState<BillingPlanRow[]>([])
  const [selectedPlanKey, setSelectedPlanKey] = useState('starter')
  const [planDraft, setPlanDraft] = useState<PlanDraft>({
    description: '',
    monthly_price: '',
    yearly_price: '',
    limits: {},
    features: {},
    apply_existing: false,
  })
  const [billingBusy, setBillingBusy] = useState(false)
  const [billingMessage, setBillingMessage] = useState('')

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId) || companies[0] || null,
    [companies, selectedCompanyId]
  )

  const featureState = useMemo(() => {
    const map = new Map<string, CompanyFeatureRow>()

    for (const row of companyFeatures) {
      if (row.company_id === selectedCompany?.id) {
        map.set(row.feature_key, row)
      }
    }

    return map
  }, [companyFeatures, selectedCompany?.id])

  useEffect(() => {
    loadAdminData()
  }, [])

  const selectedTicket = useMemo(
    () => supportTickets.find((ticket) => ticket.id === selectedTicketId) || supportTickets[0] || null,
    [supportTickets, selectedTicketId]
  )

  const selectedPlan = useMemo(
    () =>
      billingPlans.find((plan) => plan.plan_key === selectedPlanKey) ||
      [...billingPlans].sort(sortPlans)[0] ||
      null,
    [billingPlans, selectedPlanKey]
  )

  const selectedPlanVersion = useMemo(
    () => latestPlanVersion(selectedPlan),
    [selectedPlan]
  )

  async function loadAdminData() {
    setLoading(true)
    setMessage('')

    const response = await fetch('/api/admin/feature-flags', {
      method: 'GET',
      cache: 'no-store',
    })

    const payload = await response.json().catch(() => null)
    setCurrentUser(payload?.user || null)

    if (!response.ok || !payload?.ok) {
      if (isMissingSchema({ message: payload?.message })) {
        setSchemaReady(false)
      } else {
        setMessage(payload?.message || 'Could not load admin area.')
      }
      setAdmin(null)
      setLoading(false)
      return
    }

    if (!payload.isAdmin) {
      setAdmin(null)
      setLoading(false)
      return
    }

    setAdmin(payload.admin as AdminRow)
    const nextCompanies = (payload.companies || []) as CompanyRow[]
    setCompanies(nextCompanies)
    setFeatures((payload.features || []) as FeatureModuleRow[])
    setCompanyFeatures((payload.companyFeatures || []) as CompanyFeatureRow[])
    setSelectedCompanyId((current) => current || nextCompanies[0]?.id || '')
    await Promise.all([loadSupportTickets(), loadBillingPlans()])
    setLoading(false)
  }

  function latestPlanVersion(plan?: BillingPlanRow | null) {
    return [...(plan?.billing_plan_versions || [])].sort((a, b) => b.version - a.version)[0] || null
  }

  function sortPlans(a: BillingPlanRow, b: BillingPlanRow) {
    const aIndex = planOrder.indexOf(a.plan_key)
    const bIndex = planOrder.indexOf(b.plan_key)
    return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex)
  }

  function applyPlanToDraft(plan: BillingPlanRow) {
    const version = latestPlanVersion(plan)
    setSelectedPlanKey(plan.plan_key)
    setPlanDraft({
      description: plan.description || '',
      monthly_price: version?.monthly_price === null || version?.monthly_price === undefined ? '' : String(version.monthly_price),
      yearly_price: version?.yearly_price === null || version?.yearly_price === undefined ? '' : String(version.yearly_price),
      limits: { ...(version?.limits || {}) },
      features: { ...(version?.features || {}) },
      apply_existing: false,
    })
  }

  async function loadBillingPlans() {
    const response = await fetch('/api/admin/billing-plans', { cache: 'no-store' })
    const payload = await response.json().catch(() => null)

    if (!response.ok || !payload?.ok) {
      setBillingMessage(payload?.message || 'Could not load billing plans.')
      return
    }

    const rows = ((payload.plans || []) as BillingPlanRow[]).sort(sortPlans)
    setBillingPlans(rows)

    const nextPlan =
      rows.find((plan) => plan.plan_key === selectedPlanKey) ||
      rows.find((plan) => plan.plan_key === 'starter') ||
      rows[0]

    if (nextPlan) applyPlanToDraft(nextPlan)
  }

  function updatePlanLimit(key: string, value: string) {
    setPlanDraft((current) => ({
      ...current,
      limits: {
        ...current.limits,
        [key]: value === '' ? null : Number(value),
      },
    }))
  }

  function togglePlanFeature(key: string) {
    setPlanDraft((current) => ({
      ...current,
      features: {
        ...current.features,
        [key]: current.features?.[key] !== true,
      },
    }))
  }

  async function savePlanDraft() {
    if (!selectedPlan) return

    setBillingBusy(true)
    setBillingMessage('')

    const response = await fetch('/api/admin/billing-plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan_id: selectedPlan.id,
        plan_key: selectedPlan.plan_key,
        description: planDraft.description,
        monthly_price: planDraft.monthly_price,
        yearly_price: planDraft.yearly_price,
        limits: planDraft.limits,
        features: planDraft.features,
        apply_existing: planDraft.apply_existing,
      }),
    })
    const payload = await response.json().catch(() => null)
    setBillingBusy(false)

    if (!response.ok || !payload?.ok) {
      setBillingMessage(payload?.message || 'Could not save plan.')
      return
    }

    setBillingMessage(
      planDraft.apply_existing
        ? 'Plan version saved and existing subscription limits on this plan were updated.'
        : 'Plan version saved. Existing subscriptions were not changed.'
    )
    await loadBillingPlans()
  }

  async function loadSupportTickets() {
    const response = await fetch('/api/admin/support', { cache: 'no-store' })
    const payload = await response.json().catch(() => null)

    if (!response.ok || !payload?.ok) {
      setSupportMessage(payload?.message || 'Could not load support tickets.')
      return
    }

    const rows = (payload.tickets || []) as SupportTicketRow[]
    setSupportTickets(rows)
    setSelectedTicketId((current) => current || rows[0]?.id || '')
  }

  async function loadSupportTicket(ticketId: string) {
    const response = await fetch(`/api/admin/support?ticket_id=${encodeURIComponent(ticketId)}`, {
      cache: 'no-store',
    })
    const payload = await response.json().catch(() => null)

    if (!response.ok || !payload?.ok) {
      setSupportMessage(payload?.message || 'Could not load support ticket.')
      return
    }

    setTicketMessages((payload.messages || []) as SupportTicketMessageRow[])
  }

  useEffect(() => {
    if (selectedTicketId) loadSupportTicket(selectedTicketId)
  }, [selectedTicketId])

  async function sendSupportReply() {
    if (!selectedTicket || (!ticketReply.trim() && !ticketStatus)) return

    setSupportBusy(true)
    setSupportMessage('')

    const response = await fetch('/api/admin/support', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticket_id: selectedTicket.id,
        message: ticketReply,
        status: ticketStatus,
      }),
    })
    const payload = await response.json().catch(() => null)
    setSupportBusy(false)

    if (!response.ok || !payload?.ok) {
      setSupportMessage(payload?.message || 'Could not send support reply.')
      return
    }

    setTicketReply('')
    setSupportMessage('Support reply sent. The customer notification bell has been updated.')
    await Promise.all([loadSupportTickets(), loadSupportTicket(selectedTicket.id)])
  }

  async function toggleCompanyFeature(featureKey: string, enabled: boolean) {
    if (!selectedCompany) return

    setSavingKey(featureKey)
    setMessage('')

    const response = await fetch('/api/admin/feature-flags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        company_id: selectedCompany.id,
        feature_key: featureKey,
        enabled,
      }),
    })

    const payload = await response.json().catch(() => null)

    setSavingKey('')

    if (!response.ok || !payload?.ok) {
      setMessage(payload?.message || 'Could not update feature.')
      return
    }

    setCompanyFeatures((current) => {
      const without = current.filter(
        (row) => !(row.company_id === selectedCompany.id && row.feature_key === featureKey)
      )
      return [...without, payload.row as CompanyFeatureRow]
    })
  }

  return (
    <main className="min-h-screen bg-zinc-950 p-5 text-white">
      <header className="app-header mb-5 rounded-3xl bg-black p-5 text-white shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-white/50">
              Platform admin
            </p>
            <h1 className="text-3xl font-black">Loopbase Admin</h1>
            <p className="mt-1 text-sm font-bold text-white/60">
              Internal SaaS controls for customer features and custom modules.
            </p>
          </div>

          <Link
            href="/"
            className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white hover:bg-white/20"
          >
            Back to app
          </Link>
        </div>
      </header>

      {loading ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-sm font-bold text-zinc-300">
          Loading admin area...
        </section>
      ) : !schemaReady ? (
        <section className="rounded-2xl border border-yellow-800 bg-yellow-950/50 p-6">
          <h2 className="text-xl font-black text-yellow-100">Admin migration not run yet</h2>
          <p className="mt-2 text-sm font-bold text-yellow-200">
            Run `sql/2026-06-11_platform_admin_feature_flags.sql`, then reopen this page.
          </p>
        </section>
      ) : !admin ? (
        <section className="rounded-2xl border border-red-800 bg-red-950/50 p-6">
          <h2 className="text-xl font-black text-red-100">No platform admin access</h2>
          <p className="mt-2 text-sm font-bold text-red-200">
            Your login is not marked as an active platform admin.
          </p>
          {currentUser && (
            <p className="mt-4 rounded-xl border border-red-800 bg-red-950 p-3 text-xs font-bold text-red-100">
              Current login: {currentUser.email || 'no email'} · {currentUser.id}
            </p>
          )}
        </section>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
          <aside className="h-fit rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <h2 className="text-lg font-black">Customers / Companies</h2>
            <p className="mt-1 text-sm font-bold text-zinc-400">
              Select a company to control custom modules for that tenant.
            </p>

            <div className="mt-4 space-y-2">
              {companies.map((company) => {
                const selected = selectedCompany?.id === company.id

                return (
                  <button
                    key={company.id}
                    type="button"
                    onClick={() => setSelectedCompanyId(company.id)}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      selected
                        ? 'border-emerald-400 bg-emerald-700 text-white'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600'
                    }`}
                  >
                    <span className="block text-sm font-black">{company.name}</span>
                    <span className={`mt-1 block text-xs font-bold ${selected ? 'text-emerald-50' : 'text-zinc-500'}`}>
                      {company.slug} · {company.access_state}
                    </span>
                  </button>
                )
              })}
            </div>
          </aside>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black">
                  {selectedCompany?.name || 'Select a company'}
                </h2>
                <p className="mt-1 text-sm font-bold text-zinc-400">
                  Enable custom modules for this company. Disabled modules disappear from navigation and direct pages are blocked.
                </p>
              </div>

              {selectedCompany && (
                <span className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-black text-zinc-300">
                  {selectedCompany.internal_account || selectedCompany.billing_exempt
                    ? 'Internal/manual account'
                    : 'Customer account'}
                </span>
              )}
            </div>

            {message && (
              <p className="mt-4 rounded-xl border border-yellow-800 bg-yellow-950 p-3 text-sm font-bold text-yellow-200">
                {message}
              </p>
            )}

            <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-black text-white">Billing Plans & Limits</h3>
                  <p className="mt-1 text-sm font-bold text-zinc-400">
                    Edit plan prices, enforcement variables and feature flags. Saving creates a new plan version.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={loadBillingPlans}
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-black text-white hover:bg-zinc-800"
                >
                  Refresh Plans
                </button>
              </div>

              {billingMessage && (
                <p className="mt-4 rounded-xl border border-yellow-800 bg-yellow-950 p-3 text-sm font-bold text-yellow-200">
                  {billingMessage}
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {billingPlans.map((plan) => {
                  const selected = selectedPlan?.id === plan.id

                  return (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => applyPlanToDraft(plan)}
                      className={`rounded-lg border px-3 py-2 text-sm font-black ${
                        selected
                          ? 'border-emerald-400 bg-emerald-700 text-white'
                          : 'border-zinc-800 bg-black text-zinc-300 hover:border-zinc-600'
                      }`}
                    >
                      {plan.name}
                    </button>
                  )
                })}
              </div>

              {selectedPlan ? (
                <div className="mt-4 space-y-4">
                  <div className="grid gap-3 lg:grid-cols-[1fr_150px_150px_160px]">
                    <label className="block">
                      <span className="mb-1 block text-xs font-black uppercase text-zinc-500">
                        Description
                      </span>
                      <input
                        value={planDraft.description}
                        onChange={(event) =>
                          setPlanDraft((current) => ({ ...current, description: event.target.value }))
                        }
                        className="h-10 w-full rounded-lg border border-zinc-700 bg-black px-3 text-sm font-bold text-white outline-none focus:border-white"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-xs font-black uppercase text-zinc-500">
                        Monthly GBP
                      </span>
                      <input
                        type="number"
                        min="0"
                        value={planDraft.monthly_price}
                        onChange={(event) =>
                          setPlanDraft((current) => ({ ...current, monthly_price: event.target.value }))
                        }
                        className="h-10 w-full rounded-lg border border-zinc-700 bg-black px-3 text-sm font-bold text-white outline-none focus:border-white"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-xs font-black uppercase text-zinc-500">
                        Yearly GBP
                      </span>
                      <input
                        type="number"
                        min="0"
                        value={planDraft.yearly_price}
                        onChange={(event) =>
                          setPlanDraft((current) => ({ ...current, yearly_price: event.target.value }))
                        }
                        placeholder="Custom"
                        className="h-10 w-full rounded-lg border border-zinc-700 bg-black px-3 text-sm font-bold text-white outline-none focus:border-white"
                      />
                    </label>

                    <div>
                      <span className="mb-1 block text-xs font-black uppercase text-zinc-500">
                        Latest version
                      </span>
                      <div className="flex h-10 items-center rounded-lg border border-zinc-700 bg-black px-3 text-sm font-black text-white">
                        v{selectedPlanVersion?.version || 0}
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-zinc-500">
                      Numeric limits
                    </p>
                    <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {planLimitDefinitions.map((definition) => (
                        <label
                          key={definition.key}
                          className="rounded-lg border border-zinc-800 bg-black p-3"
                        >
                          <span className="block text-xs font-bold text-zinc-400">
                            {definition.label}
                          </span>
                          <input
                            type="number"
                            min="0"
                            value={
                              planDraft.limits?.[definition.key] === null ||
                              planDraft.limits?.[definition.key] === undefined
                                ? ''
                                : String(planDraft.limits?.[definition.key])
                            }
                            onChange={(event) => updatePlanLimit(definition.key, event.target.value)}
                            placeholder="Unlimited"
                            className="mt-2 h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-sm font-bold text-white outline-none focus:border-white"
                          />
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-zinc-500">
                      Feature switches
                    </p>
                    <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {planFeatureDefinitions.map((definition) => {
                        const enabled = planDraft.features?.[definition.key] === true

                        return (
                          <button
                            key={definition.key}
                            type="button"
                            onClick={() => togglePlanFeature(definition.key)}
                            className={`rounded-lg border p-3 text-left text-sm font-black ${
                              enabled
                                ? 'border-emerald-500 bg-emerald-700 text-white'
                                : 'border-zinc-800 bg-black text-zinc-400 hover:border-zinc-600'
                            }`}
                          >
                            {enabled ? 'Enabled' : 'Disabled'} · {definition.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-black p-3">
                    <label className="flex items-center gap-2 text-sm font-bold text-zinc-300">
                      <input
                        type="checkbox"
                        checked={planDraft.apply_existing}
                        onChange={(event) =>
                          setPlanDraft((current) => ({
                            ...current,
                            apply_existing: event.target.checked,
                          }))
                        }
                        className="h-4 w-4"
                      />
                      Apply these limits to existing companies already on this plan
                    </label>

                    <button
                      type="button"
                      onClick={savePlanDraft}
                      disabled={billingBusy}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {billingBusy ? 'Saving' : 'Save New Plan Version'}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-4 rounded-xl border border-zinc-800 bg-black p-4 text-sm font-bold text-zinc-500">
                  No billing plans found.
                </p>
              )}
            </div>

            <div className="mt-5 grid gap-3">
              {features.length === 0 ? (
                <p className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm font-bold text-zinc-400">
                  No feature modules are configured.
                </p>
              ) : (
                features.map((feature) => {
                  const row = featureState.get(feature.feature_key)
                  const enabled = row?.enabled === true

                  return (
                    <div
                      key={feature.feature_key}
                      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4"
                    >
                      <div>
                        <p className="text-lg font-black text-white">{feature.name}</p>
                        <p className="mt-1 text-sm font-bold text-zinc-400">
                          {feature.description || feature.feature_key}
                        </p>
                        <p className="mt-2 text-xs font-black uppercase text-zinc-500">
                          {feature.category} · {feature.feature_key}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleCompanyFeature(feature.feature_key, !enabled)}
                        disabled={savingKey === feature.feature_key || !selectedCompany}
                        className={`rounded-xl px-4 py-3 text-sm font-black text-white disabled:opacity-50 ${
                          enabled
                            ? 'bg-emerald-600 hover:bg-emerald-500'
                            : 'bg-zinc-700 hover:bg-zinc-600'
                        }`}
                      >
                        {savingKey === feature.feature_key
                          ? 'Saving'
                          : enabled
                            ? 'Enabled'
                            : 'Disabled'}
                      </button>
                    </div>
                  )
                })
              )}
            </div>

            <div className="mt-6 border-t border-zinc-800 pt-6">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-black text-white">Support Tickets</h3>
                  <p className="mt-1 text-sm font-bold text-zinc-400">
                    Reply to customer tickets. Replies create support notifications in the customer bell.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={loadSupportTickets}
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-black text-white hover:bg-zinc-800"
                >
                  Refresh
                </button>
              </div>

              {supportMessage && (
                <p className="mb-4 rounded-xl border border-yellow-800 bg-yellow-950 p-3 text-sm font-bold text-yellow-200">
                  {supportMessage}
                </p>
              )}

              <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
                <div className="space-y-2">
                  {supportTickets.length === 0 ? (
                    <p className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm font-bold text-zinc-500">
                      No support tickets yet.
                    </p>
                  ) : (
                    supportTickets.map((ticket) => {
                      const selected = selectedTicket?.id === ticket.id

                      return (
                        <button
                          key={ticket.id}
                          type="button"
                          onClick={() => {
                            setSelectedTicketId(ticket.id)
                            setTicketStatus(ticket.status === 'resolved' ? 'resolved' : 'waiting_on_customer')
                          }}
                          className={`w-full rounded-xl border p-3 text-left ${
                            selected
                              ? 'border-emerald-400 bg-emerald-700 text-white'
                              : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600'
                          }`}
                        >
                          <span className="block truncate text-sm font-black">{ticket.subject}</span>
                          <span className={`mt-1 block text-xs font-bold ${selected ? 'text-emerald-50' : 'text-zinc-500'}`}>
                            {ticket.company?.name || ticket.company?.slug || 'Company'} · {ticket.status.replaceAll('_', ' ')}
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  {!selectedTicket ? (
                    <p className="text-sm font-bold text-zinc-500">Select a ticket.</p>
                  ) : (
                    <div>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h4 className="text-lg font-black text-white">{selectedTicket.subject}</h4>
                          <p className="mt-1 text-sm font-bold text-zinc-500">
                            {selectedTicket.company?.name || selectedTicket.company?.slug || 'Company'} · {selectedTicket.category} · {selectedTicket.priority}
                          </p>
                        </div>

                        <select
                          value={ticketStatus}
                          onChange={(event) => setTicketStatus(event.target.value)}
                          className="h-10 rounded-lg border border-zinc-700 bg-black px-3 text-sm font-bold text-white"
                        >
                          <option value="open">Open</option>
                          <option value="waiting_on_support">Waiting on support</option>
                          <option value="waiting_on_customer">Waiting on customer</option>
                          <option value="resolved">Resolved</option>
                          <option value="closed">Closed</option>
                        </select>
                      </div>

                      <textarea
                        value={ticketReply}
                        onChange={(event) => setTicketReply(event.target.value)}
                        rows={5}
                        placeholder="Reply to customer"
                        className="mt-4 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm font-bold text-white outline-none focus:border-white"
                      />

                      <div className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
                        {ticketMessages.length === 0 ? (
                          <p className="rounded-lg border border-zinc-800 bg-black p-3 text-sm font-bold text-zinc-500">
                            No messages loaded for this ticket.
                          </p>
                        ) : (
                          ticketMessages.map((item) => (
                            <div
                              key={item.id}
                              className={`rounded-lg border p-3 ${
                                item.sender_type === 'admin'
                                  ? 'border-emerald-500/30 bg-emerald-500/10'
                                  : 'border-zinc-800 bg-black'
                              }`}
                            >
                              <div className="mb-1 flex items-center justify-between gap-3">
                                <p className="text-xs font-black uppercase text-zinc-500">
                                  {item.sender_type === 'admin' ? 'Loopbase' : 'Customer'}
                                </p>
                                <p className="text-xs font-bold text-zinc-600">
                                  {new Date(item.created_at).toLocaleString('en-GB')}
                                </p>
                              </div>
                              <p className="whitespace-pre-wrap text-sm font-bold leading-relaxed text-zinc-200">
                                {item.body}
                              </p>
                            </div>
                          ))
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={sendSupportReply}
                        disabled={supportBusy || (!ticketReply.trim() && !ticketStatus)}
                        className="mt-3 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {supportBusy ? 'Sending' : 'Send Reply / Update'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

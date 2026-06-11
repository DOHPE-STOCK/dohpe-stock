'use client'

import { useEffect, useMemo, useState } from 'react'
import { useCompany } from '@/app/context/CompanyContext'
import { supabase } from '@/lib/supabase'

type BillingCadence = 'monthly' | 'yearly'

type PlanVersion = {
  monthly_price: number | null
  yearly_price: number | null
  limits: Record<string, any>
  features: Record<string, any>
  version: number
}

type BillingPlan = {
  id: string
  plan_key: string
  name: string
  description: string | null
  is_public: boolean
  is_custom: boolean
  billing_plan_versions?: PlanVersion[]
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

const planOrder = ['starter', 'growth', 'pro', 'enterprise', 'internal_lifetime']

const limitRows = [
  { key: 'company_limit', label: 'Companies' },
  { key: 'sku_limit', label: 'SKUs' },
  { key: 'user_limit', label: 'Login users' },
  { key: 'staff_limit', label: 'Staff / PIN profiles' },
  { key: 'device_limit', label: 'Devices' },
  { key: 'location_limit', label: 'Locations' },
  { key: 'channel_limit', label: 'Channels' },
  { key: 'department_limit', label: 'Departments / 3PL clients' },
  { key: 'monthly_ai_generations', label: 'AI generations / month' },
  { key: 'storage_gb', label: 'Storage' },
]

const featureRows = [
  { key: 'rfid_workflows', label: 'RFID receiving workflows' },
  { key: 'advanced_reports', label: 'Advanced reports' },
  { key: 'priority_support', label: 'Priority support' },
]

function formatMoney(value?: number | null, cadence?: BillingCadence) {
  if (!value) return 'Custom'
  return `GBP ${Number(value).toLocaleString('en-GB')}${cadence === 'yearly' ? ' / year' : ' / month'}`
}

function formatLimit(value: any, suffix = '') {
  if (value === null || value === undefined || value === '') return 'Unlimited'
  if (typeof value === 'boolean') return value ? 'Included' : 'Not included'
  return `${Number(value).toLocaleString('en-GB')}${suffix}`
}

function statusLabel(value?: string | null) {
  return String(value || 'not configured').replaceAll('_', ' ')
}

function planVersion(plan: BillingPlan) {
  return [...(plan.billing_plan_versions || [])].sort((a, b) => b.version - a.version)[0] || null
}

function sortPlans(a: BillingPlan, b: BillingPlan) {
  const aIndex = planOrder.indexOf(a.plan_key)
  const bIndex = planOrder.indexOf(b.plan_key)
  return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex)
}

export default function BillingSettingsPanel() {
  const { activeCompany, activeCompanyId, schemaReady } = useCompany()
  const [cadence, setCadence] = useState<BillingCadence>('monthly')
  const [plans, setPlans] = useState<BillingPlan[]>([])
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const publicPlans = useMemo(
    () =>
      plans
        .filter((plan) => plan.is_public || plan.plan_key === 'enterprise' || plan.plan_key === 'internal_lifetime')
        .sort(sortPlans),
    [plans]
  )

  const currentPlan = useMemo(
    () => publicPlans.find((plan) => plan.plan_key === subscription?.plan_key) || null,
    [publicPlans, subscription?.plan_key]
  )

  const currentVersion = currentPlan ? planVersion(currentPlan) : null
  const isInternal = Boolean(activeCompany?.billing_exempt || activeCompany?.internal_account)

  useEffect(() => {
    loadBilling()
  }, [activeCompanyId, schemaReady])

  async function loadBilling() {
    if (!schemaReady || !activeCompanyId) return

    setLoading(true)
    setMessage('')

    const [plansResult, subscriptionResult] = await Promise.all([
      supabase
        .from('billing_plans')
        .select('id, plan_key, name, description, is_public, is_custom, billing_plan_versions(monthly_price, yearly_price, limits, features, version)')
        .order('plan_key', { ascending: true }),
      supabase
        .from('company_subscriptions')
        .select('id, provider, plan_key, status, payment_status, trial_ends_at, current_period_end, limits')
        .eq('company_id', activeCompanyId)
        .order('updated_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
    ])

    setLoading(false)

    if (plansResult.error) {
      setMessage(plansResult.error.message)
      return
    }

    if (subscriptionResult.error) {
      setMessage(subscriptionResult.error.message)
      return
    }

    setPlans((plansResult.data || []) as BillingPlan[])
    setSubscription((subscriptionResult.data || null) as SubscriptionRow | null)
  }

  function beginPlanChange(plan: BillingPlan) {
    if (plan.plan_key === subscription?.plan_key) return

    setMessage(
      plan.plan_key === 'enterprise'
        ? 'Enterprise contact flow will be connected when the sales/support workflow is finalised.'
        : 'Stripe checkout and prorated plan changes are the next billing integration step.'
    )
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-zinc-500">Billing</p>
            <h2 className="mt-1 text-2xl font-black text-white">
              {activeCompany?.name || 'Company'} subscription
            </h2>
            <p className="mt-1 text-sm font-bold text-zinc-400">
              Membership controls who can access the company. Billing controls whether the company has service access.
            </p>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-1">
            {(['monthly', 'yearly'] as BillingCadence[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setCadence(option)}
                className={`rounded-lg px-4 py-2 text-sm font-black ${
                  cadence === option ? 'bg-emerald-600 text-white' : 'text-zinc-300 hover:bg-zinc-900'
                }`}
              >
                {option === 'monthly' ? 'Monthly' : 'Yearly'}
              </button>
            ))}
          </div>
        </div>

        {message && (
          <p className="mt-4 rounded-xl border border-yellow-800 bg-yellow-950 p-3 text-sm font-bold text-yellow-200">
            {message}
          </p>
        )}

        <div className="mt-5 grid gap-4 lg:grid-cols-[360px_1fr]">
          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4">
            <p className="text-xs font-black uppercase tracking-wide text-emerald-200">Current plan</p>
            <p className="mt-2 text-3xl font-black text-white">
              {isInternal ? 'Internal Lifetime' : currentPlan?.name || statusLabel(subscription?.plan_key)}
            </p>
            <p className="mt-2 text-sm font-bold text-emerald-100">
              {isInternal
                ? 'Manual lifetime access. Plan limits are not enforced for this company.'
                : `${statusLabel(subscription?.status)} · ${statusLabel(subscription?.payment_status)}`}
            </p>

            {subscription?.trial_ends_at && !isInternal && (
              <p className="mt-3 rounded-lg bg-black/30 px-3 py-2 text-xs font-bold text-white">
                Trial ends {new Date(subscription.trial_ends_at).toLocaleDateString('en-GB')}
              </p>
            )}

            {subscription?.current_period_end && !isInternal && (
              <p className="mt-3 rounded-lg bg-black/30 px-3 py-2 text-xs font-bold text-white">
                Current period ends {new Date(subscription.current_period_end).toLocaleDateString('en-GB')}
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {limitRows.slice(0, 8).map((row) => (
              <div key={row.key} className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                <p className="text-xs font-black uppercase text-zinc-500">{row.label}</p>
                <p className="mt-1 text-lg font-black text-white">
                  {formatLimit((subscription?.limits || currentVersion?.limits || {})[row.key])}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-white">Plans</h2>
            <p className="mt-1 text-sm font-bold text-zinc-400">
              Prices and limits are read from billing plan versions. Stripe checkout will connect to these plan keys.
            </p>
          </div>

          {cadence === 'yearly' && (
            <span className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white">
              Yearly is roughly one month cheaper
            </span>
          )}
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-4">
          {loading ? (
            <p className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm font-bold text-zinc-400">
              Loading plans...
            </p>
          ) : (
            publicPlans
              .filter((plan) => plan.plan_key !== 'internal_lifetime' || isInternal)
              .map((plan) => {
                const version = planVersion(plan)
                const isCurrent = plan.plan_key === subscription?.plan_key || (isInternal && plan.plan_key === 'internal_lifetime')
                const price = cadence === 'monthly' ? version?.monthly_price : version?.yearly_price

                return (
                  <div
                    key={plan.plan_key}
                    className={`rounded-2xl border p-4 ${
                      isCurrent
                        ? 'border-emerald-400 bg-emerald-500/10'
                        : 'border-zinc-800 bg-zinc-950'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-black text-white">{plan.name}</p>
                        <p className="mt-1 text-2xl font-black text-emerald-300">
                          {formatMoney(price, cadence)}
                        </p>
                      </div>

                      {isCurrent && (
                        <span className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-black text-white">
                          Current
                        </span>
                      )}
                    </div>

                    <p className="mt-3 min-h-12 text-sm font-bold text-zinc-400">
                      {plan.description || 'Custom Loopbase plan.'}
                    </p>

                    <div className="mt-4 space-y-2">
                      {['sku_limit', 'user_limit', 'device_limit', 'channel_limit'].map((key) => (
                        <p key={key} className="text-xs font-bold text-zinc-300">
                          {limitRows.find((row) => row.key === key)?.label}: {formatLimit(version?.limits?.[key])}
                        </p>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => beginPlanChange(plan)}
                      disabled={isCurrent}
                      className={`mt-5 w-full rounded-xl px-4 py-2 text-sm font-black text-white disabled:cursor-default disabled:opacity-70 ${
                        isCurrent ? 'bg-zinc-700' : 'bg-emerald-600 hover:bg-emerald-500'
                      }`}
                    >
                      {isCurrent ? 'Current Plan' : plan.plan_key === 'enterprise' ? 'Contact Sales' : 'Change Plan'}
                    </button>
                  </div>
                )
              })
          )}
        </div>
      </section>

      <section className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900">
        <div className="min-w-[860px]">
          <div
            className="grid border-b border-zinc-800 bg-zinc-950 text-sm font-black"
            style={{ gridTemplateColumns: `240px repeat(${Math.max(publicPlans.length, 1)}, minmax(130px, 1fr))` }}
          >
            <div className="p-3 text-zinc-400">Limit / Feature</div>
            {publicPlans
              .filter((plan) => plan.plan_key !== 'internal_lifetime' || isInternal)
              .map((plan) => (
                <div key={plan.plan_key} className="p-3 text-white">
                  {plan.name}
                </div>
              ))}
          </div>

          {[...limitRows, ...featureRows].map((row) => (
            <div
              key={row.key}
              className="grid border-b border-zinc-800 text-sm last:border-b-0"
              style={{ gridTemplateColumns: `240px repeat(${Math.max(publicPlans.length, 1)}, minmax(130px, 1fr))` }}
            >
              <div className="bg-zinc-950 p-3 font-bold text-zinc-300">{row.label}</div>
              {publicPlans
                .filter((plan) => plan.plan_key !== 'internal_lifetime' || isInternal)
                .map((plan) => {
                  const version = planVersion(plan)
                  const value = version?.limits?.[row.key] ?? version?.features?.[row.key]
                  const suffix = row.key === 'storage_gb' ? ' GB' : ''

                  return (
                    <div key={plan.plan_key} className="p-3 font-black text-white">
                      {formatLimit(value, suffix)}
                    </div>
                  )
                })}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="text-xl font-black text-white">Invoices</h2>
        <p className="mt-1 text-sm font-bold text-zinc-400">
          Stripe invoice history, payment methods, proration credits and receipts will live here when billing is connected.
        </p>
        <div className="mt-4 rounded-xl border border-dashed border-zinc-700 bg-zinc-950 p-4 text-sm font-bold text-zinc-400">
          No invoices are available yet.
        </div>
      </section>
    </div>
  )
}

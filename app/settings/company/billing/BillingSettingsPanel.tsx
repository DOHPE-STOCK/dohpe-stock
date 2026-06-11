'use client'

import { useMemo, useState } from 'react'
import { useCompany } from '@/app/context/CompanyContext'

type BillingCadence = 'monthly' | 'yearly'

type Plan = {
  key: string
  name: string
  monthly: number | null
  yearly: number | null
  summary: string
  highlights: string[]
  features: Record<string, boolean | string>
}

const featureRows = [
  { key: 'companies', label: 'Companies' },
  { key: 'inventory', label: 'Inventory and barcode stock control' },
  { key: 'pos', label: 'POS checkout and offline queueing' },
  { key: 'marketplaces', label: 'Marketplace listing and sync tools' },
  { key: 'warehouse', label: 'Warehouse bins, transfers and picking' },
  { key: 'rfid', label: 'RFID receiving table workflows' },
  { key: 'reports', label: 'Reports, payroll and holiday reporting' },
  { key: 'invoices', label: 'Invoices and billing history' },
  { key: 'support', label: 'Support level' },
]

const plans: Plan[] = [
  {
    key: 'starter',
    name: 'Starter',
    monthly: 69,
    yearly: 759,
    summary: 'Single-company resale inventory, POS and channel foundations.',
    highlights: ['1 company', 'Up to 2 channels', 'Up to 2 devices'],
    features: {
      companies: '1',
      inventory: true,
      pos: true,
      marketplaces: true,
      warehouse: 'Core bins',
      rfid: false,
      reports: 'Basic',
      invoices: true,
      support: 'Standard',
    },
  },
  {
    key: 'growth',
    name: 'Growth',
    monthly: 149,
    yearly: 1639,
    summary: 'Higher-volume warehouse teams with RFID and more automation.',
    highlights: ['1 company', 'RFID workflows', 'More devices and channels'],
    features: {
      companies: '1',
      inventory: true,
      pos: true,
      marketplaces: true,
      warehouse: true,
      rfid: true,
      reports: true,
      invoices: true,
      support: 'Priority',
    },
  },
  {
    key: 'pro',
    name: 'Pro',
    monthly: 299,
    yearly: 3289,
    summary: 'Advanced operations, deeper reporting and larger limits.',
    highlights: ['1 company', 'Advanced reports', 'Higher SKU and device limits'],
    features: {
      companies: '1',
      inventory: true,
      pos: true,
      marketplaces: true,
      warehouse: true,
      rfid: true,
      reports: 'Advanced',
      invoices: true,
      support: 'Priority',
    },
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    monthly: null,
    yearly: null,
    summary: 'Multi-company, custom limits, onboarding and bespoke workflows.',
    highlights: ['2+ companies', 'Custom limits', 'Dedicated support'],
    features: {
      companies: '2+ / custom',
      inventory: true,
      pos: true,
      marketplaces: true,
      warehouse: true,
      rfid: true,
      reports: 'Advanced + custom',
      invoices: true,
      support: 'Dedicated',
    },
  },
]

function formatPrice(plan: Plan, cadence: BillingCadence) {
  const amount = cadence === 'monthly' ? plan.monthly : plan.yearly
  if (!amount) return 'Custom'
  return `£${amount.toLocaleString('en-GB')}${cadence === 'monthly' ? ' / month' : ' / year'}`
}

function featureValue(value: boolean | string) {
  if (value === true) return '✓'
  if (value === false) return '-'
  return value
}

export default function BillingSettingsPanel() {
  const { activeCompany } = useCompany()
  const [cadence, setCadence] = useState<BillingCadence>('monthly')
  const yearlySaving = useMemo(() => {
    const starter = plans.find((plan) => plan.key === 'starter')
    if (!starter?.monthly || !starter.yearly) return ''
    const saved = starter.monthly * 12 - starter.yearly
    return `Starter yearly saves £${saved.toLocaleString('en-GB')}`
  }, [])

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-white">Subscription</h2>
            <p className="mt-1 text-sm font-bold text-zinc-400">
              Current plan and subscription options for {activeCompany?.name || 'this company'}.
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

        <p className="mt-3 text-xs font-bold text-emerald-300">{yearlySaving}</p>

        <div className="mt-5 grid gap-4 xl:grid-cols-4">
          {plans.map((plan) => (
            <div key={plan.key} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-lg font-black text-white">{plan.name}</p>
              <p className="mt-1 text-2xl font-black text-emerald-300">
                {formatPrice(plan, cadence)}
              </p>
              <p className="mt-2 min-h-12 text-sm font-bold text-zinc-400">{plan.summary}</p>

              <div className="mt-4 space-y-2">
                {plan.highlights.map((highlight) => (
                  <p key={highlight} className="text-sm font-bold text-zinc-300">
                    ✓ {highlight}
                  </p>
                ))}
              </div>

              <button
                type="button"
                className="mt-5 w-full rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-500"
              >
                {plan.key === 'enterprise' ? 'Contact Sales' : 'Change to Plan'}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[220px_repeat(4,minmax(130px,1fr))] border-b border-zinc-800 bg-zinc-950 text-sm font-black">
            <div className="p-3 text-zinc-400">Feature</div>
            {plans.map((plan) => (
              <div key={plan.key} className="p-3 text-white">
                {plan.name}
              </div>
            ))}
          </div>

          {featureRows.map((feature) => (
            <div
              key={feature.key}
              className="grid grid-cols-[220px_repeat(4,minmax(130px,1fr))] border-b border-zinc-800 text-sm last:border-b-0"
            >
              <div className="bg-zinc-950 p-3 font-bold text-zinc-300">{feature.label}</div>
              {plans.map((plan) => (
                <div key={plan.key} className="p-3 font-black text-white">
                  {featureValue(plan.features[feature.key])}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="text-xl font-black text-white">Invoices</h2>
        <p className="mt-1 text-sm font-bold text-zinc-400">
          Invoice history and payment-provider actions will live here when Stripe billing is connected.
        </p>
        <div className="mt-4 rounded-xl border border-dashed border-zinc-700 bg-zinc-950 p-4 text-sm font-bold text-zinc-400">
          No invoices are available yet.
        </div>
      </section>
    </div>
  )
}

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
  const [schemaReady, setSchemaReady] = useState(true)
  const [currentUser, setCurrentUser] = useState<{ id: string; email?: string | null } | null>(null)

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
    setLoading(false)
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
          </section>
        </div>
      )}
    </main>
  )
}

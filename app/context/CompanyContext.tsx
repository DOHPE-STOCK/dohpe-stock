'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export type CompanyAccessState =
  | 'active'
  | 'trial'
  | 'payment_required'
  | 'past_due'
  | 'cancelled'
  | 'suspended'
  | 'archived'

export type Company = {
  id: string
  name: string
  slug: string
  access_state: CompanyAccessState
  billing_exempt: boolean
  subscription_status?: string | null
  internal_account?: boolean | null
}

export type CompanyMembership = {
  company_id: string
  role: string
  status: string
  company: Company
}

type CompanyContextType = {
  activeCompany: Company | null
  activeCompanyId: string
  companies: Company[]
  memberships: CompanyMembership[]
  deviceLockedCompanyId: string
  deviceLockedCompany: Company | null
  deviceLockApplies: boolean
  isOperationalDevicePage: boolean
  loading: boolean
  schemaReady: boolean
  serviceRestricted: boolean
  refreshCompanies: () => Promise<void>
  setActiveCompanyId: (companyId: string) => Promise<void>
  lockDeviceToCompany: (companyId?: string) => void
  unlockDeviceCompany: () => void
}

const FALLBACK_COMPANY: Company = {
  id: 'single-company-fallback',
  name: 'Loopbase',
  slug: 'loopbase',
  access_state: 'active',
  billing_exempt: true,
  subscription_status: 'manual_active',
  internal_account: true,
}

const CompanyContext = createContext<CompanyContextType>({
  activeCompany: FALLBACK_COMPANY,
  activeCompanyId: FALLBACK_COMPANY.id,
  companies: [FALLBACK_COMPANY],
  memberships: [],
  deviceLockedCompanyId: '',
  deviceLockedCompany: null,
  deviceLockApplies: false,
  isOperationalDevicePage: false,
  loading: true,
  schemaReady: false,
  serviceRestricted: false,
  refreshCompanies: async () => {},
  setActiveCompanyId: async () => {},
  lockDeviceToCompany: () => {},
  unlockDeviceCompany: () => {},
})

function normaliseCompany(row: any): Company | null {
  if (!row?.id || !row?.name) return null

  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug || row.id),
    access_state: (row.access_state || 'active') as CompanyAccessState,
    billing_exempt: row.billing_exempt === true,
    subscription_status: row.subscription_status || null,
    internal_account: row.internal_account === true,
  }
}

function setActiveCompanyCookie(companyId: string) {
  document.cookie = `active_company_id=${encodeURIComponent(
    companyId
  )}; path=/; max-age=2592000; SameSite=Lax`
}

const DEVICE_LOCK_COMPANY_KEY = 'loopbase_device_locked_company_id'

function isOperationalPath(pathname: string) {
  return (
    pathname === '/checkout' ||
    pathname.startsWith('/checkout/') ||
    pathname.startsWith('/scanner') ||
    pathname.startsWith('/transfers') ||
    pathname.startsWith('/processing')
  )
}

function isCompanyRestrictionAllowedPath(pathname: string) {
  return (
    pathname.startsWith('/settings/company') ||
    pathname.startsWith('/settings/integrations') ||
    pathname === '/settings' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/staff')
  )
}

function isSchemaMissing(error: any) {
  const message = String(error?.message || '').toLowerCase()
  return (
    message.includes('company_memberships') ||
    message.includes('companies') ||
    message.includes('user_company_preferences') ||
    message.includes('does not exist') ||
    message.includes('schema cache')
  )
}

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [companies, setCompanies] = useState<Company[]>([FALLBACK_COMPANY])
  const [memberships, setMemberships] = useState<CompanyMembership[]>([])
  const [activeCompanyId, setActiveCompanyIdState] = useState(FALLBACK_COMPANY.id)
  const [deviceLockedCompanyId, setDeviceLockedCompanyId] = useState('')
  const [loading, setLoading] = useState(true)
  const [schemaReady, setSchemaReady] = useState(false)

  const isOperationalDevicePage = isOperationalPath(pathname || '')

  useEffect(() => {
    const lockedCompanyId = window.localStorage.getItem(DEVICE_LOCK_COMPANY_KEY) || ''
    setDeviceLockedCompanyId(lockedCompanyId)

    refreshCompanies()

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      refreshCompanies()
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!deviceLockedCompanyId || !isOperationalDevicePage) return
    const lockedCompany = companies.find((company) => company.id === deviceLockedCompanyId)

    if (!lockedCompany) {
      window.localStorage.removeItem(DEVICE_LOCK_COMPANY_KEY)
      setDeviceLockedCompanyId('')
      return
    }

    if (activeCompanyId !== deviceLockedCompanyId) {
      setActiveCompanyIdState(deviceLockedCompanyId)
      window.localStorage.setItem('active_company_id', deviceLockedCompanyId)
      setActiveCompanyCookie(deviceLockedCompanyId)
    }
  }, [activeCompanyId, companies, deviceLockedCompanyId, isOperationalDevicePage])

  async function refreshCompanies() {
    setLoading(true)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setCompanies([FALLBACK_COMPANY])
      setMemberships([])
      setActiveCompanyIdState(FALLBACK_COMPANY.id)
      setActiveCompanyCookie(FALLBACK_COMPANY.id)
      setSchemaReady(false)
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('company_memberships')
      .select(
        `company_id, role, status,
        company:companies(id, name, slug, access_state, billing_exempt, subscription_status, internal_account)`
      )
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: true })

    if (error) {
      if (!isSchemaMissing(error)) {
        console.warn('Company lookup failed:', error.message)
      }

      setCompanies([FALLBACK_COMPANY])
      setMemberships([])
      setActiveCompanyIdState(FALLBACK_COMPANY.id)
      setActiveCompanyCookie(FALLBACK_COMPANY.id)
      setSchemaReady(false)
      setLoading(false)
      return
    }

    const nextMemberships = (data || [])
      .map((row: any) => {
        const company = normaliseCompany(Array.isArray(row.company) ? row.company[0] : row.company)
        if (!company) return null

        return {
          company_id: String(row.company_id || company.id),
          role: String(row.role || 'member'),
          status: String(row.status || 'active'),
          company,
        }
      })
      .filter(Boolean) as CompanyMembership[]

    const nextCompanies = nextMemberships.map((membership) => membership.company)

    if (nextCompanies.length === 0) {
      setCompanies([FALLBACK_COMPANY])
      setMemberships([])
      setActiveCompanyIdState(FALLBACK_COMPANY.id)
      setActiveCompanyCookie(FALLBACK_COMPANY.id)
      setSchemaReady(true)
      setLoading(false)
      return
    }

    const lockedCompanyId = window.localStorage.getItem(DEVICE_LOCK_COMPANY_KEY) || ''
    const savedCompanyId = window.localStorage.getItem('active_company_id') || ''
    let preferredCompanyId = savedCompanyId

    const { data: preference } = await supabase
      .from('user_company_preferences')
      .select('active_company_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (preference?.active_company_id) {
      preferredCompanyId = String(preference.active_company_id)
    }

    if (
      isOperationalPath(window.location.pathname) &&
      nextCompanies.some((company) => company.id === lockedCompanyId)
    ) {
      preferredCompanyId = lockedCompanyId
    }

    const nextActiveCompanyId = nextCompanies.some((company) => company.id === preferredCompanyId)
      ? preferredCompanyId
      : nextCompanies[0].id

    setCompanies(nextCompanies)
    setMemberships(nextMemberships)
    setActiveCompanyIdState(nextActiveCompanyId)
    window.localStorage.setItem('active_company_id', nextActiveCompanyId)
    setActiveCompanyCookie(nextActiveCompanyId)
    setSchemaReady(true)
    setLoading(false)
  }

  async function setActiveCompanyId(companyId: string) {
    const allowed = companies.some((company) => company.id === companyId)
    if (!allowed) return
    if (deviceLockedCompanyId && isOperationalDevicePage && companyId !== deviceLockedCompanyId) {
      return
    }

    setActiveCompanyIdState(companyId)
    window.localStorage.setItem('active_company_id', companyId)
    setActiveCompanyCookie(companyId)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user || !schemaReady) return

    await supabase.from('user_company_preferences').upsert(
      {
        user_id: user.id,
        active_company_id: companyId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
  }

  function lockDeviceToCompany(companyId?: string) {
    const targetCompanyId = companyId || activeCompanyId
    const allowed = companies.some((company) => company.id === targetCompanyId)
    if (!allowed) return

    window.localStorage.setItem(DEVICE_LOCK_COMPANY_KEY, targetCompanyId)
    setDeviceLockedCompanyId(targetCompanyId)

    if (isOperationalDevicePage) {
      setActiveCompanyIdState(targetCompanyId)
      window.localStorage.setItem('active_company_id', targetCompanyId)
      setActiveCompanyCookie(targetCompanyId)
    }
  }

  function unlockDeviceCompany() {
    window.localStorage.removeItem(DEVICE_LOCK_COMPANY_KEY)
    setDeviceLockedCompanyId('')
  }

  const activeCompany = useMemo(
    () => companies.find((company) => company.id === activeCompanyId) || companies[0] || null,
    [activeCompanyId, companies]
  )

  const deviceLockedCompany = useMemo(
    () => companies.find((company) => company.id === deviceLockedCompanyId) || null,
    [companies, deviceLockedCompanyId]
  )

  const deviceLockApplies = Boolean(deviceLockedCompany && isOperationalDevicePage)

  const serviceRestricted = Boolean(
    activeCompany &&
      !activeCompany.billing_exempt &&
      !['active', 'trial'].includes(activeCompany.access_state)
  )

  const shouldBlockForBilling = Boolean(
    serviceRestricted && pathname && !isCompanyRestrictionAllowedPath(pathname)
  )

  return (
    <CompanyContext.Provider
      value={{
        activeCompany,
        activeCompanyId,
        companies,
        memberships,
        deviceLockedCompanyId,
        deviceLockedCompany,
        deviceLockApplies,
        isOperationalDevicePage,
        loading,
        schemaReady,
        serviceRestricted,
        refreshCompanies,
        setActiveCompanyId,
        lockDeviceToCompany,
        unlockDeviceCompany,
      }}
    >
      {shouldBlockForBilling ? (
        <main className="min-h-screen bg-zinc-950 p-5 text-white">
          <section className="mx-auto mt-20 max-w-2xl rounded-2xl border border-red-800 bg-red-950 p-6 shadow-2xl">
            <p className="text-xs font-black uppercase text-red-200">Company access restricted</p>
            <h1 className="mt-2 text-3xl font-black">
              {activeCompany?.name || 'This company'} needs billing attention
            </h1>
            <p className="mt-3 text-sm font-bold text-red-100">
              Operational pages are paused while this company is{' '}
              {activeCompany?.access_state?.replaceAll('_', ' ') || 'restricted'}. Your data is
              preserved.
            </p>
            <a
              href="/settings/company"
              className="mt-5 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-black text-black hover:bg-zinc-200"
            >
              Open Company Settings
            </a>
          </section>
        </main>
      ) : (
        children
      )}
    </CompanyContext.Provider>
  )
}

export function useCompany() {
  return useContext(CompanyContext)
}

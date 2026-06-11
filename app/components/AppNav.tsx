'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useStaff } from '@/app/context/StaffContext'
import { useCompany } from '@/app/context/CompanyContext'
import NotificationBell from '@/app/components/NotificationBell'

type NavKey =
  | 'settings'
  | 'sku'
  | 'inventory'
  | 'processing'
  | 'working'
  | 'review'
  | 'finalised'
  | 'photo-imports'
  | 'transfers'
  | 'allocate'
  | 'loan'
  | 'rota'
  | 'reports'
  | 'admin'

type AppNavProps = {
  current?: NavKey
  onNavigate?: (url: string) => void
}

type NavItem = {
  key: NavKey
  label: string
  href: string
  permission?: string | string[]
  featureKey?: string
  platformAdminOnly?: boolean
}

const navItems: NavItem[] = [
  { key: 'sku', label: 'Search/Create', href: '/' },
  { key: 'inventory', label: 'Inventory', href: '/inventory', permission: 'inventory' },
  { key: 'processing', label: 'Processing', href: '/processing', permission: ['working', 'review', 'finalised'] },
  { key: 'transfers', label: 'Transfers', href: '/transfers', permission: 'scanner' },
  { key: 'allocate', label: 'Allocate', href: '/scanner/allocate', permission: 'scanner' },
  { key: 'loan', label: 'Loan', href: '/scanner/loan', permission: 'scanner', featureKey: 'loan_page' },
  { key: 'rota', label: 'Rota', href: '/rota', permission: 'reports' },
  { key: 'reports', label: 'Reports', href: '/reports', permission: 'reports' },
  { key: 'settings', label: 'Settings', href: '/settings', permission: 'settings' },
  { key: 'admin', label: 'Admin', href: '/admin', permission: 'settings', platformAdminOnly: true },
]

export default function AppNav({ current, onNavigate }: AppNavProps) {
  const router = useRouter()
  const { staff, can, clearStaff } = useStaff()
  const {
    activeCompany,
    activeCompanyId,
    companies,
    deviceLockedCompany,
    deviceLockApplies,
    setActiveCompanyId,
    schemaReady,
  } = useCompany()

  const [userLabel, setUserLabel] = useState('')
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [enabledFeatures, setEnabledFeatures] = useState<Record<string, boolean>>({})
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)

  useEffect(() => {
    async function loadUser() {
      const { data } = await supabase.auth.getUser()
      const user = data.user

      if (!user) {
        setUserLabel('')
        return
      }

      setUserLabel(
        user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.email ||
          'Logged in'
      )
    }

    loadUser()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user

      if (!user) {
        setUserLabel('')
        return
      }

      setUserLabel(
        user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.email ||
          'Logged in'
      )
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    async function loadFeatureFlags() {
      if (!schemaReady || !activeCompanyId) {
        setEnabledFeatures({})
        setIsPlatformAdmin(false)
        return
      }

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setEnabledFeatures({})
        setIsPlatformAdmin(false)
        return
      }

      const [companyFeatureResult, userOverrideResult, adminStatusResult] = await Promise.all([
        supabase
          .from('company_features')
          .select('feature_key, enabled')
          .eq('company_id', activeCompanyId),
        supabase
          .from('user_feature_overrides')
          .select('feature_key, enabled')
          .eq('company_id', activeCompanyId)
          .eq('user_id', user.id),
        fetch('/api/admin/status', { cache: 'no-store' }),
      ])

      const nextFeatures: Record<string, boolean> = {}

      if (!companyFeatureResult.error) {
        for (const row of companyFeatureResult.data || []) {
          nextFeatures[String(row.feature_key)] = row.enabled === true
        }
      }

      if (!userOverrideResult.error) {
        for (const row of userOverrideResult.data || []) {
          nextFeatures[String(row.feature_key)] = row.enabled === true
        }
      }

      const adminStatus = await adminStatusResult.json().catch(() => null)

      setEnabledFeatures(nextFeatures)
      setIsPlatformAdmin(Boolean(adminStatus?.ok && adminStatus.isAdmin))
    }

    loadFeatureFlags()
  }, [activeCompanyId, schemaReady])

  function canSeeNavItem(item: NavItem) {
    if (!staff || staff.is_active === false) {
      return item.key === 'sku'
    }

    if (item.platformAdminOnly && !isPlatformAdmin) return false
    if (item.featureKey && enabledFeatures[item.featureKey] !== true) return false
    if (staff.role === 'admin') return true
    if (!item.permission) return true

    if (Array.isArray(item.permission)) {
      return item.permission.some((permission) => can(permission))
    }

    return can(item.permission)
  }

  function switchStaff() {
    clearStaff()
    router.push('/staff')
  }

  async function signOut() {
    setBusy(true)
    clearStaff()
    await supabase.auth.signOut()
    setBusy(false)
    router.push('/login')
  }

  const visibleNavItems = navItems.filter(canSeeNavItem)
  const navButton =
    'rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs font-black text-white hover:border-white/25 hover:bg-white/20'
  const currentButton =
    'rounded-lg border border-emerald-400 bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-500'

  return (
    <div className="app-nav relative flex w-full flex-col gap-3 pt-1">
      <div className="app-nav-pages flex flex-wrap items-center gap-2 pr-0 sm:pr-44">
        {visibleNavItems.map((item) => {
          const className = current === item.key ? currentButton : navButton

          if (current === item.key) {
            return (
              <button key={item.key} type="button" disabled className={className}>
                {item.label}
              </button>
            )
          }

          if (onNavigate) {
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onNavigate(item.href)}
                className={className}
              >
                {item.label}
              </button>
            )
          }

          return (
            <Link key={item.key} href={item.href} className={className}>
              {item.label}
            </Link>
          )
        })}
      </div>

      <div className="app-session-controls flex items-center gap-2 sm:absolute sm:right-0 sm:top-0">
        {schemaReady && deviceLockApplies && deviceLockedCompany ? (
          <span
            title={`This device is locked to ${deviceLockedCompany.name} on operational pages`}
            className="max-w-[170px] truncate text-[11px] font-black text-emerald-200"
          >
            {deviceLockedCompany.name} locked
          </span>
        ) : schemaReady && companies.length > 1 ? (
          <select
            value={activeCompanyId}
            onChange={(event) => setActiveCompanyId(event.target.value)}
            title="Switch company"
            className="h-7 max-w-[150px] rounded-md border border-white/15 bg-black px-2 text-[11px] font-black text-white outline-none hover:bg-zinc-900"
          >
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        ) : (
          schemaReady &&
          activeCompany && (
            <span
              title={activeCompany.name}
              className="hidden max-w-[120px] truncate text-[11px] font-bold text-white/70 sm:inline"
            >
              {activeCompany.name}
            </span>
          )
        )}

        {staff ? (
          <button
            type="button"
            onClick={switchStaff}
            title="Switch staff"
            className="max-w-[120px] truncate rounded-md border border-emerald-300/25 bg-emerald-400/15 px-2 py-1 text-[11px] font-black text-emerald-100 hover:bg-emerald-400/25"
          >
            Staff: {staff.name}
          </button>
        ) : (
          <Link
            href="/staff"
            className="keep-dark-text rounded-md bg-yellow-300 px-2 py-1 text-[11px] font-black text-black hover:bg-yellow-200"
          >
            Staff PIN
          </Link>
        )}

        <NotificationBell
          activeCompanyId={activeCompanyId}
          schemaReady={schemaReady}
          enabled={Boolean(userLabel)}
        />

        {userLabel ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setUserMenuOpen((value) => !value)}
              title={userLabel}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-white/10 text-xs font-black text-white hover:bg-white/20"
            >
              {userLabel.slice(0, 1).toUpperCase()}
            </button>

            {userMenuOpen && (
              <div className="absolute right-0 top-9 z-30 w-52 rounded-xl border border-white/10 bg-black p-2 text-white shadow-2xl">
                <p className="mb-2 truncate px-2 text-[11px] font-bold text-white/70">
                  {userLabel}
                </p>

                <button
                  type="button"
                  onClick={signOut}
                  disabled={busy}
                  className="w-full rounded-lg bg-red-600 px-3 py-2 text-left text-xs font-black text-white hover:bg-red-500 disabled:opacity-50"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        ) : (
          <Link
            href="/login"
            title="Log in"
            className="keep-dark-text flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-black text-black hover:bg-zinc-200"
          >
            U
          </Link>
        )}
      </div>
    </div>
  )
}


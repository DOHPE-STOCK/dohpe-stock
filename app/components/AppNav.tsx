'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useStaff } from '@/app/context/StaffContext'

type NavKey =
  | 'settings'
  | 'sku'
  | 'inventory'
  | 'create-bin'
  | 'checkout'
  | 'working'
  | 'review'
  | 'finalised'
  | 'photo-imports'
  | 'transfers'
  | 'allocate'
  | 'loan'
  | 'rota'

type AppNavProps = {
  current?: NavKey
  onNavigate?: (url: string) => void
}

type NavItem = {
  key: NavKey
  label: string
  href: string
  iconOnly?: boolean
  permission?: string
}

const navItems: NavItem[] = [
  { key: 'sku', label: 'SKU Search', href: '/' },
  { key: 'inventory', label: 'Inventory', href: '/inventory', permission: 'working' },
  { key: 'create-bin', label: 'Create Bin', href: '/create-bin', permission: 'scanner' },
  { key: 'checkout', label: 'Checkout', href: '/checkout', permission: 'checkout' },
  { key: 'working', label: 'Working', href: '/working', permission: 'working' },
  { key: 'review', label: 'Review', href: '/review', permission: 'review' },
  { key: 'finalised', label: 'Finalised', href: '/finalised', permission: 'finalised' },
  { key: 'photo-imports', label: 'Photo Imports', href: '/photo-imports', permission: 'working' },
  { key: 'transfers', label: 'Transfers', href: '/transfers', permission: 'scanner' },
  { key: 'allocate', label: 'Allocate', href: '/scanner/allocate', permission: 'scanner' },
  { key: 'loan', label: 'Loan', href: '/scanner/loan', permission: 'scanner' },
  { key: 'rota', label: 'Rota', href: '/rota', permission: 'reports' },
  { key: 'settings', label: '⚙', href: '/settings', iconOnly: true, permission: 'settings' },
]

export default function AppNav({ current, onNavigate }: AppNavProps) {
  const router = useRouter()
  const { staff, can, clearStaff } = useStaff()

  const [userLabel, setUserLabel] = useState('')
  const [busy, setBusy] = useState(false)

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

  function canSeeNavItem(item: NavItem) {
    if (!staff || staff.is_active === false) {
      return item.key === 'sku'
    }

    if (staff.role === 'admin') return true
    if (!item.permission) return true

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

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {visibleNavItems.map((item) => {
          const isCurrent = current === item.key

          const normalClass =
            'rounded-lg px-4 py-2 text-xs font-bold bg-zinc-800 hover:bg-zinc-700 text-white'

          const iconClass = 'px-2 text-lg text-zinc-400 hover:text-white'

          if (isCurrent) {
            return (
              <button
                key={item.key}
                type="button"
                disabled
                className={
                  item.iconOnly
                    ? `${iconClass} text-white`
                    : `${normalClass} bg-zinc-700 ring-1 ring-zinc-500`
                }
              >
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
                className={item.iconOnly ? iconClass : normalClass}
              >
                {item.label}
              </button>
            )
          }

          return (
            <Link
              key={item.key}
              href={item.href}
              className={item.iconOnly ? iconClass : normalClass}
            >
              {item.label}
            </Link>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {staff ? (
          <>
            <span className="max-w-[150px] truncate rounded-lg bg-emerald-950 px-3 py-2 text-xs font-bold text-emerald-200">
              Staff: {staff.name}
            </span>

            <button
              type="button"
              onClick={switchStaff}
              className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-bold text-zinc-200 hover:bg-zinc-700"
            >
              Switch staff
            </button>
          </>
        ) : (
          <Link
            href="/staff"
            className="rounded-lg bg-yellow-300 px-3 py-2 text-xs font-black text-black hover:bg-yellow-200"
          >
            Staff PIN
          </Link>
        )}

        {userLabel ? (
          <>
            <span className="max-w-[180px] truncate rounded-lg bg-zinc-900 px-3 py-2 text-xs font-bold text-zinc-300">
              {userLabel}
            </span>

            <button
              type="button"
              onClick={signOut}
              disabled={busy}
              className="rounded-lg bg-red-900/60 px-3 py-2 text-xs font-bold text-red-100 hover:bg-red-800 disabled:opacity-50"
            >
              Sign out
            </button>
          </>
        ) : (
          <Link
            href="/login"
            className="rounded-lg bg-white px-3 py-2 text-xs font-black text-black hover:bg-zinc-200"
          >
            Log in
          </Link>
        )}
      </div>
    </div>
  )
}
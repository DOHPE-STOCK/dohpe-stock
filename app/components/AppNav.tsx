'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type NavKey =
  | 'settings'
  | 'sku'
  | 'checkout'
  | 'working'
  | 'review'
  | 'finalised'
  | 'photo-imports'
  | 'transfers'
  | 'allocate'
  | 'loan'

type AppNavProps = {
  current?: NavKey
  onNavigate?: (url: string) => void
}

type NavItem = {
  key: NavKey
  label: string
  href: string
  iconOnly?: boolean
}

const navItems: NavItem[] = [
  { key: 'sku', label: 'SKU Search', href: '/' },
  { key: 'checkout', label: 'Checkout', href: '/checkout' },
  { key: 'working', label: 'Working', href: '/working' },
  { key: 'review', label: 'Review', href: '/review' },
  { key: 'finalised', label: 'Finalised', href: '/finalised' },
  { key: 'photo-imports', label: 'Photo Imports', href: '/photo-imports' },
  { key: 'transfers', label: 'Transfers', href: '/transfers' },
  { key: 'allocate', label: 'Allocate', href: '/scanner/allocate' },
  { key: 'loan', label: 'Loan', href: '/scanner/loan' },
  { key: 'settings', label: '⚙', href: '/settings', iconOnly: true },
]

export default function AppNav({ current, onNavigate }: AppNavProps) {
  const router = useRouter()
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

  async function signOut() {
    setBusy(true)
    await supabase.auth.signOut()
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {navItems.map((item) => {
          const isCurrent = current === item.key

          const normalClass =
            'rounded-lg px-4 py-2 text-xs font-bold bg-zinc-800 hover:bg-zinc-700'

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
                    : `${normalClass} bg-zinc-700 text-white ring-1 ring-zinc-500`
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

      <div className="flex items-center gap-2">
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
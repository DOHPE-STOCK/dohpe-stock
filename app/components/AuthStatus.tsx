'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function AuthStatus() {
  const [email, setEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadUser() {
      const { data } = await supabase.auth.getUser()
      setEmail(data.user?.email || null)
      setLoading(false)
    }

    loadUser()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email || null)
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  if (loading) return null

  if (!email) {
    return (
      <a
        href="/login"
        className="rounded-xl bg-black px-3 py-2 text-xs font-black text-white"
      >
        Log in
      </a>
    )
  }

  const name = email.split('@')[0]

  return (
    <div className="flex items-center gap-2 rounded-xl bg-neutral-100 px-3 py-2 text-xs font-bold text-neutral-700">
      <span className="max-w-[140px] truncate">{name}</span>
      <button
        type="button"
        onClick={signOut}
        className="font-black text-red-600"
      >
        Sign out
      </button>
    </div>
  )
}
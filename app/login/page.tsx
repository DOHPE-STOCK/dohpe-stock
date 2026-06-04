'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

function cleanNextUrl(value: string | null) {
  if (!value) return '/'

  const clean = value.trim()

  if (!clean.startsWith('/')) return '/'
  if (clean.startsWith('//')) return '/'
  if (clean.startsWith('/login')) return '/'

  return clean
}

function LoginPageContent() {
  const searchParams = useSearchParams()
  const nextUrl = cleanNextUrl(searchParams.get('next'))

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function login() {
    if (busy) return

    setBusy(true)
    setMessage('')

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setBusy(false)

    if (error) {
      setMessage(error.message)
      return
    }

    // Force reload so proxy sees session.
    window.location.href = nextUrl
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 p-4 text-white">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
        <h1 className="mb-4 text-2xl font-bold">Dohpe Stock Login</h1>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            login()
          }}
        >
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="mb-3 w-full rounded-xl bg-neutral-950 p-3 outline-none"
            autoComplete="email"
          />

          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            type="password"
            className="mb-3 w-full rounded-xl bg-neutral-950 p-3 outline-none"
            autoComplete="current-password"
          />

          <button
            type="submit"
            disabled={busy || !email || !password}
            className="w-full rounded-xl bg-white p-3 font-bold text-black disabled:opacity-50"
          >
            {busy ? 'Logging in...' : 'Login'}
          </button>
        </form>

        {message && (
          <p className="mt-3 text-sm font-bold text-yellow-300">{message}</p>
        )}
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-neutral-950 p-4 text-white">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 text-sm font-bold">
            Loading login...
          </div>
        </main>
      }
    >
      <LoginPageContent />
    </Suspense>
  )
}


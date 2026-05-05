'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()

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

    // IMPORTANT: force reload so proxy sees session
    window.location.href = '/'
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
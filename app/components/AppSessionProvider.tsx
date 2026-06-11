'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompany } from '@/app/context/CompanyContext'

const SESSION_KEY_STORAGE = 'loopbase_app_session_key'
const DEVICE_LABEL_STORAGE = 'loopbase_device_label'

function createSessionKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function defaultDeviceLabel() {
  if (typeof navigator === 'undefined') return 'Browser device'
  const platform = navigator.platform || 'Device'
  return `${platform} browser`
}

function getSessionKey() {
  const existing = window.localStorage.getItem(SESSION_KEY_STORAGE)
  if (existing) return existing

  const next = createSessionKey()
  window.localStorage.setItem(SESSION_KEY_STORAGE, next)
  return next
}

function getDeviceLabel() {
  const existing = window.localStorage.getItem(DEVICE_LABEL_STORAGE)
  if (existing) return existing

  const next = defaultDeviceLabel()
  window.localStorage.setItem(DEVICE_LABEL_STORAGE, next)
  return next
}

export default function AppSessionProvider({ children }: { children: React.ReactNode }) {
  const { activeCompanyId, schemaReady } = useCompany()
  const [conflict, setConflict] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const startedRef = useRef(false)

  async function postSession(action: string, takeover = false) {
    if (!schemaReady || !activeCompanyId || activeCompanyId === 'single-company-fallback') return null

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return null

    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        session_key: getSessionKey(),
        device_label: getDeviceLabel(),
        path: window.location.pathname,
        takeover,
      }),
    }).catch(() => null)

    const payload = await response?.json().catch(() => null)

    if (response?.status === 409 && payload?.code === 'ACTIVE_SESSION_EXISTS') {
      setConflict(payload.session || {})
      return payload
    }

    if (!response?.ok || !payload?.ok) {
      if (payload?.message) setMessage(payload.message)
      return payload
    }

    setConflict(null)
    setMessage('')
    return payload
  }

  async function startSession(takeover = false) {
    setBusy(true)
    const payload = await postSession('start', takeover)
    setBusy(false)
    if (payload?.ok) startedRef.current = true
  }

  async function takeOverSession() {
    await startSession(true)
  }

  async function signOutHere() {
    setBusy(true)
    await postSession('end')
    window.localStorage.removeItem(SESSION_KEY_STORAGE)
    await supabase.auth.signOut()
    setBusy(false)
    window.location.href = '/login'
  }

  useEffect(() => {
    startedRef.current = false
    startSession(false)
  }, [activeCompanyId, schemaReady])

  useEffect(() => {
    if (!schemaReady || !activeCompanyId) return

    const timer = window.setInterval(() => {
      postSession(startedRef.current ? 'heartbeat' : 'start')
    }, 60_000)

    return () => window.clearInterval(timer)
  }, [activeCompanyId, schemaReady])

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        postSession(startedRef.current ? 'heartbeat' : 'start')
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [activeCompanyId, schemaReady])

  return (
    <>
      {children}

      {conflict && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 text-white">
          <section className="w-full max-w-md rounded-2xl border border-yellow-700 bg-zinc-950 p-5 shadow-2xl">
            <p className="text-xs font-black uppercase tracking-wide text-yellow-300">
              Active session already open
            </p>
            <h2 className="mt-2 text-2xl font-black">Take over this login?</h2>
            <p className="mt-3 text-sm font-bold leading-relaxed text-zinc-300">
              This account is already active on another device
              {conflict.device_label ? ` (${conflict.device_label})` : ''}. Taking over will revoke
              the other app session.
            </p>

            {message && (
              <p className="mt-3 rounded-lg border border-red-800 bg-red-950 p-3 text-sm font-bold text-red-100">
                {message}
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={takeOverSession}
                disabled={busy}
                className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {busy ? 'Working' : 'Take Over'}
              </button>

              <button
                type="button"
                onClick={signOutHere}
                disabled={busy}
                className="flex-1 rounded-xl border border-zinc-700 px-4 py-3 text-sm font-black text-white hover:bg-zinc-900 disabled:opacity-50"
              >
                Sign Out Here
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}

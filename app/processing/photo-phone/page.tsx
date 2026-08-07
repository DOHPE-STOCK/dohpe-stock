'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type PairedPhone = {
  source_token: string
  source: {
    id: string
    company_id: string
    station_id: string
    name: string
  }
  station: {
    id: string
    name: string
    code: string
  }
}

type StationRow = {
  id: string
  name: string
  code: string
  active_photo_session_id?: string | null
  active_session?: any
}

const PHONE_PAIRING_STORAGE = 'loopbase_photo_phone_pairing'
const PHONE_QUEUE_DB = 'loopbase_photo_phone_queue'
const PHONE_QUEUE_STORE = 'pending_captures'
const PHONE_CAPTURE_ROLE = 'session_photo'

type PendingCapture = {
  id: string
  source_token: string
  source_id: string
  session_id: string
  item_sku: string
  file: File
  original_filename: string
  captured_at: string
  photo_role: string
  idempotency_key: string
  attempts: number
  last_error?: string
  created_at: string
}

function itemTitle(item: any) {
  return item?.final_title || item?.ai_title || item?.basic_title || item?.website_title || item?.brand || 'Active item'
}

function loadStoredPairing(): PairedPhone | null {
  try {
    const raw = window.localStorage.getItem(PHONE_PAIRING_STORAGE)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.source_token && parsed?.source?.station_id ? parsed : null
  } catch {
    return null
  }
}

function openQueueDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PHONE_QUEUE_DB, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(PHONE_QUEUE_STORE)) {
        db.createObjectStore(PHONE_QUEUE_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Could not open phone queue.'))
  })
}

async function queuePut(capture: PendingCapture) {
  const db = await openQueueDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PHONE_QUEUE_STORE, 'readwrite')
    tx.objectStore(PHONE_QUEUE_STORE).put(capture)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('Could not save queued photo.'))
  })
  db.close()
}

async function queueDelete(id: string) {
  const db = await openQueueDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PHONE_QUEUE_STORE, 'readwrite')
    tx.objectStore(PHONE_QUEUE_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('Could not remove queued photo.'))
  })
  db.close()
}

async function queueAll(): Promise<PendingCapture[]> {
  const db = await openQueueDb()
  const rows = await new Promise<PendingCapture[]>((resolve, reject) => {
    const tx = db.transaction(PHONE_QUEUE_STORE, 'readonly')
    const request = tx.objectStore(PHONE_QUEUE_STORE).getAll()
    request.onsuccess = () => resolve((request.result || []) as PendingCapture[])
    request.onerror = () => reject(request.error || new Error('Could not load queued photos.'))
  })
  db.close()
  return rows
}

async function postQueuedCapture(capture: PendingCapture) {
  const form = new FormData()
  form.append('file', capture.file)
  form.append('session_id', capture.session_id)
  form.append('original_filename', capture.original_filename)
  form.append('captured_at', capture.captured_at)
  form.append('photo_role', capture.photo_role)
  form.append('idempotency_key', capture.idempotency_key)
  form.append('worker_version', 'loopbase-phone-capture/0.1')

  const response = await fetch('/api/v1/photo-ingest', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${capture.source_token}`,
    },
    body: form,
  })
  const data = await response.json().catch(() => null)

  if (!response.ok || !data?.ok) {
    throw new Error(data?.message || 'Photo upload failed.')
  }

  return data
}

export default function PhotoPhonePage() {
  const [pairing, setPairing] = useState<PairedPhone | null>(null)
  const [station, setStation] = useState<StationRow | null>(null)
  const [deviceLabel, setDeviceLabel] = useState('Phone camera')
  const [message, setMessage] = useState('')
  const [pendingCount, setPendingCount] = useState(0)
  const [syncingQueue, setSyncingQueue] = useState(false)
  const [busy, setBusy] = useState(false)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const libraryInputRef = useRef<HTMLInputElement | null>(null)
  const previousSessionIdRef = useRef<string | null>(null)

  const session = station?.active_session || null
  const item = Array.isArray(session?.item) ? session.item[0] : session?.item || null
  const ready = Boolean(pairing?.source_token && station?.id)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const pairToken = params.get('pair') || ''
    const stored = loadStoredPairing()

    if (stored && !pairToken) {
      setPairing(stored)
      return
    }

    if (pairToken) {
      exchangePairToken(pairToken)
      return
    }

    if (!stored) setMessage('Open this page by scanning a phone pairing QR from Photo Monitor.')
  }, [])

  useEffect(() => {
    if (!pairing?.source?.station_id) return
    fetchStation()
  }, [pairing?.source?.station_id])

  useEffect(() => {
    if (!pairing?.source_token) return

    const timer = window.setInterval(() => fetchStation(false), 2500)
    return () => window.clearInterval(timer)
  }, [pairing?.source_token])

  useEffect(() => {
    if (!pairing) return

    const previousSessionId = previousSessionIdRef.current
    const nextSessionId = session?.status === 'active' ? session.id : null

    if (!previousSessionId && nextSessionId) {
      previousSessionIdRef.current = nextSessionId
      setMessage(item?.sku ? `Ready for ${item.sku}.` : 'Ready for active photo session.')
      return
    }

    if (previousSessionId && !nextSessionId) {
      previousSessionIdRef.current = null
      setMessage('Session complete. Waiting for the next SKU from the station.')
      return
    }

    if (previousSessionId && nextSessionId && previousSessionId !== nextSessionId) {
      previousSessionIdRef.current = nextSessionId
      setMessage(item?.sku ? `Now capturing ${item.sku}.` : 'New photo session active.')
    }
  }, [pairing, session?.id, session?.status, item?.sku])

  useEffect(() => {
    refreshPendingCount()
    const onlineHandler = () => flushQueue()
    window.addEventListener('online', onlineHandler)
    const timer = window.setInterval(() => flushQueue(false), 8000)
    return () => {
      window.removeEventListener('online', onlineHandler)
      window.clearInterval(timer)
    }
  }, [])

  async function exchangePairToken(pairToken: string) {
    setBusy(true)
    setMessage('Pairing phone...')

    try {
      const response = await fetch('/api/photography/phone-pairing', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pair_token: pairToken,
          device_label: deviceLabel || 'Phone camera',
        }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not pair this phone.')
      }

      const nextPairing = {
        source_token: data.source_token,
        source: data.source,
        station: data.station,
      }
      window.localStorage.setItem(PHONE_PAIRING_STORAGE, JSON.stringify(nextPairing))
      window.history.replaceState(null, '', window.location.pathname)
      setPairing(nextPairing)
      setMessage('Phone paired.')
    } catch (error: any) {
      setMessage(error.message || 'Could not pair this phone.')
    } finally {
      setBusy(false)
    }
  }

  async function fetchStation(showErrors = true) {
    if (!pairing?.source_token) return

    const response = await fetch('/api/v1/photo-station-state', {
      headers: {
        authorization: `Bearer ${pairing.source_token}`,
      },
    })
    const data = await response.json().catch(() => null)

    if (!response.ok || !data?.ok) {
      if (showErrors) setMessage(data?.message || 'Could not load station state.')
      return
    }

    setStation(data.station as StationRow)
  }

  async function refreshPendingCount() {
    try {
      const rows = await queueAll()
      setPendingCount(rows.length)
    } catch {
      setPendingCount(0)
    }
  }

  async function flushQueue(showMessage = true) {
    if (syncingQueue || !navigator.onLine) return

    setSyncingQueue(true)
    try {
      const rows = await queueAll()
      let uploaded = 0

      for (const row of rows) {
        try {
          await postQueuedCapture(row)
          await queueDelete(row.id)
          uploaded += 1
        } catch (error: any) {
          await queuePut({
            ...row,
            attempts: row.attempts + 1,
            last_error: error.message || 'Upload failed.',
          })
        }
      }

      await refreshPendingCount()
      if (uploaded > 0 && showMessage) {
        setMessage(`${uploaded} queued photo${uploaded === 1 ? '' : 's'} uploaded.`)
      }
    } finally {
      setSyncingQueue(false)
    }
  }

  async function queuePhoto(file: File, reason: string) {
    if (!pairing?.source_token || !session?.id) {
      setMessage('No active photo session. Start a session on the station first.')
      return
    }

    const capturedAt = new Date().toISOString()
    const filename = file.name || `phone-${Date.now()}.jpg`
    const pending: PendingCapture = {
      id: `${pairing.source.id}:${session.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      source_token: pairing.source_token,
      source_id: pairing.source.id,
      session_id: session.id,
      item_sku: item?.sku || '',
      file,
      original_filename: filename,
      captured_at: capturedAt,
      photo_role: PHONE_CAPTURE_ROLE,
      idempotency_key: `phone:${pairing.source.id}:${session.id}:${filename}:${file.size}:${file.lastModified}`,
      attempts: 0,
      last_error: reason,
      created_at: capturedAt,
    }

    await queuePut(pending)
    await refreshPendingCount()
    setMessage(`Photo queued. ${reason}`)
  }

  async function uploadPhoto(file: File) {
    if (!pairing?.source_token || !session?.id) {
      setMessage('No active photo session. Start a session on the station first.')
      return
    }

    const boundSessionId = session.id
    const capturedAt = new Date().toISOString()
    const filename = file.name || `phone-${Date.now()}.jpg`
    setBusy(true)
    setMessage('Uploading photo...')

    try {
      if (!navigator.onLine) {
        await queuePhoto(file, 'Phone is offline; it will retry automatically.')
        return
      }

      const data = await postQueuedCapture({
        id: '',
        source_token: pairing.source_token,
        source_id: pairing.source.id,
        session_id: boundSessionId,
        item_sku: item?.sku || '',
        file,
        original_filename: filename,
        captured_at: capturedAt,
        photo_role: PHONE_CAPTURE_ROLE,
        idempotency_key: `phone:${pairing.source.id}:${boundSessionId}:${filename}:${file.size}:${file.lastModified}`,
        attempts: 0,
        created_at: capturedAt,
      })

      setMessage(data.assigned ? 'Photo uploaded to active session.' : 'Photo uploaded for review.')
      await fetchStation(false)
    } catch (error: any) {
      await queuePhoto(file, error.message || 'Upload failed; it will retry automatically.')
    } finally {
      setBusy(false)
      if (cameraInputRef.current) cameraInputRef.current.value = ''
      if (libraryInputRef.current) libraryInputRef.current.value = ''
    }
  }

  async function unpair() {
    const token = pairing?.source_token || ''
    setBusy(true)

    if (token && navigator.onLine) {
      try {
        const response = await fetch('/api/photography/phone-pairing', {
          method: 'DELETE',
          keepalive: true,
          headers: {
            authorization: `Bearer ${token}`,
          },
        })
        const data = await response.json().catch(() => null)
        if (!response.ok || !data?.ok) {
          throw new Error(data?.message || 'Could not unpair this phone.')
        }
      } catch (error: any) {
        setMessage(error.message || 'Could not unpair this phone.')
        setBusy(false)
        return
      }
    }

    window.localStorage.removeItem(PHONE_PAIRING_STORAGE)
    setPairing(null)
    setStation(null)
    setMessage(navigator.onLine ? 'Phone unpaired.' : 'Phone unpaired locally. Server pairing will expire if unused.')
    setBusy(false)
  }

  const statusText = useMemo(() => {
    if (!ready) return 'Not paired'
    if (session?.status === 'active' && item) return `${item.sku} - ${itemTitle(item)}`
    return 'Paired. Waiting for the next SKU.'
  }, [ready, session?.status, item])

  return (
    <main className="min-h-screen bg-zinc-950 p-4 text-white">
      <header className="rounded-2xl bg-black p-4">
        <p className="text-xs font-black uppercase tracking-wide text-green-300">Loopbase Phone Capture</p>
        <h1 className="mt-1 text-2xl font-black">{station?.name || pairing?.station?.name || 'Pair Phone'}</h1>
        <p className="mt-1 text-sm font-bold text-zinc-300">{statusText}</p>
      </header>

      {message && (
        <div className="mt-4 rounded-xl border border-yellow-700 bg-yellow-950 p-3 text-sm font-bold text-yellow-100">
          {message}
        </div>
      )}

      {pairing && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-sm font-bold text-zinc-200">
          <span>
            Pending uploads: <span className="font-black text-white">{pendingCount}</span>
            {syncingQueue ? ' - syncing...' : ''}
          </span>
          <button
            type="button"
            onClick={() => flushQueue()}
            disabled={syncingQueue || pendingCount === 0}
            className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      {!pairing ? (
        <section className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <label className="text-xs font-black uppercase tracking-wide text-zinc-400">
            Device label
            <input
              value={deviceLabel}
              onChange={(event) => setDeviceLabel(event.target.value)}
              className="mt-2 h-11 w-full rounded-lg border border-zinc-700 bg-black px-3 text-sm font-bold normal-case text-white outline-none focus:border-white"
            />
          </label>
          <p className="mt-3 text-sm font-bold text-zinc-400">
            Scan a pairing QR from Photo Monitor to connect this phone to a station.
          </p>
        </section>
      ) : (
        <section className="mt-4 space-y-4">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="rounded-xl border border-zinc-800 bg-black p-4">
              <p className="text-xs font-black uppercase tracking-wide text-zinc-500">Current item</p>
              <p className="mt-1 text-3xl font-black">{item?.sku || 'No active SKU'}</p>
              <p className="mt-1 text-sm font-bold text-zinc-400">{item ? itemTitle(item) : 'Start a session from the station.'}</p>
              <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs font-bold text-zinc-300">
                Keep this page open. When the station starts the next SKU, this phone updates automatically.
              </p>
            </div>

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/jpeg,image/png,image/heic,image/heif,image/webp"
              capture="environment"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) uploadPhoto(file)
              }}
            />
            <input
              ref={libraryInputRef}
              type="file"
              accept="image/jpeg,image/png,image/heic,image/heif,image/webp"
              multiple
              className="hidden"
              onChange={async (event) => {
                const files = Array.from(event.target.files || [])
                for (const file of files) {
                  await uploadPhoto(file)
                }
              }}
            />

            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              disabled={busy || !session?.id}
              className="mt-4 h-16 w-full rounded-2xl bg-emerald-600 text-lg font-black text-white disabled:opacity-50"
            >
              Take Photo
            </button>

            <button
              type="button"
              onClick={() => libraryInputRef.current?.click()}
              disabled={busy || !session?.id}
              className="mt-3 h-12 w-full rounded-xl bg-zinc-800 text-sm font-black text-white disabled:opacity-50"
            >
              Choose Original Files
            </button>

            <p className="mt-3 rounded-lg border border-zinc-800 bg-black p-3 text-xs font-bold text-zinc-400">
              Phone capture uploads the original selected file. For maximum control and speed, use the native camera app or camera tethering, then choose the original files here.
            </p>
          </div>

          <button
            type="button"
            onClick={unpair}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-black text-white"
          >
            Unpair Phone
          </button>
        </section>
      )}
    </main>
  )
}

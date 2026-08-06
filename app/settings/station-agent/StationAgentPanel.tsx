'use client'

import { useEffect, useMemo, useState } from 'react'

type StationAgentRelease = {
  ok?: boolean
  name?: string
  version?: string
  download_url?: string
  manifest_url?: string
  release_notes?: string[]
}

type StationDevice = {
  id: string
  device_key: string
  name: string
  device_type: string
  is_active: boolean
  last_seen_at?: string | null
  station_token?: string | null
  station_capabilities?: Record<string, unknown> | null
  station_last_payload?: Record<string, unknown> | null
  created_at?: string | null
  updated_at?: string | null
}

export default function StationAgentPanel() {
  const [release, setRelease] = useState<StationAgentRelease | null>(null)
  const [devices, setDevices] = useState<StationDevice[]>([])
  const [deviceName, setDeviceName] = useState('Main Station PC')
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [editingName, setEditingName] = useState('')
  const [editingActive, setEditingActive] = useState(true)
  const [showToken, setShowToken] = useState(false)
  const [newToken, setNewToken] = useState('')
  const [status, setStatus] = useState('Loading station agent release...')

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === selectedDeviceId) || devices[0] || null,
    [devices, selectedDeviceId],
  )

  useEffect(() => {
    let cancelled = false
    fetch('/api/station-agent/releases/latest', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload) => {
        if (cancelled) return
        setRelease(payload)
        setStatus(payload?.ok ? '' : 'Release information is not available.')
      })
      .catch((error) => {
        if (cancelled) return
        setStatus(error instanceof Error ? error.message : 'Release information failed to load.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function loadDevices() {
    const response = await fetch('/api/station-agent/devices', { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok || !data?.ok) throw new Error(data?.message || 'Could not load station devices.')
    setDevices(data.devices || [])
    setSelectedDeviceId((current) => {
      if (current && (data.devices || []).some((device: StationDevice) => device.id === current)) return current
      return data.devices?.[0]?.id || ''
    })
  }

  useEffect(() => {
    loadDevices().catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Could not load station devices.')
    })
  }, [])

  async function createDevice() {
    setStatus('Creating station device...')
    setNewToken('')
    try {
      const response = await fetch('/api/station-agent/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: deviceName }),
      })
      const data = await response.json()
      if (!response.ok || !data?.ok) throw new Error(data?.message || 'Could not create station device.')
      setNewToken(data.station_token || '')
      await loadDevices()
      setStatus('Station device created. Paste the token into the Station Agent remote printer section.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not create station device.')
    }
  }

  const downloadUrl = useMemo(() => {
    return release?.download_url || '/api/station-agent/download'
  }, [release?.download_url])

  useEffect(() => {
    if (!selectedDevice) {
      setEditingName('')
      setEditingActive(true)
      setShowToken(false)
      return
    }

    setEditingName(selectedDevice.name || '')
    setEditingActive(selectedDevice.is_active !== false)
    setShowToken(false)
  }, [selectedDevice?.id])

  async function saveSelectedDevice() {
    if (!selectedDevice) return

    setStatus('Saving station device...')
    try {
      const response = await fetch('/api/station-agent/devices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedDevice.id,
          name: editingName,
          is_active: editingActive,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data?.ok) throw new Error(data?.message || 'Could not save station device.')
      setDevices((current) => current.map((device) => (device.id === data.device.id ? data.device : device)))
      setStatus('Station device saved.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save station device.')
    }
  }

  async function copyText(value: string, label: string) {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setStatus(`${label} copied.`)
    } catch {
      setStatus(`Could not copy ${label.toLowerCase()}.`)
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-emerald-400">
              Windows Companion
            </p>
            <h2 className="mt-1 text-lg font-black text-white">Loopbase Station Agent</h2>
            <p className="mt-2 max-w-3xl text-sm font-bold text-zinc-400">
              Install this on any Windows PC that controls a photography station, RFID table,
              RFID threshold reader, local ZPL label printer, or A4 printer. It runs locally
              and connects that hardware back to Loopbase.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {release?.version && (
              <span className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-black text-zinc-200">
                v{release.version}
              </span>
            )}
            <a
              href={downloadUrl}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-500"
            >
              Download Current Agent
            </a>
          </div>
        </div>

        {status && (
          <p className="mt-4 rounded-lg border border-amber-700 bg-amber-950/40 px-3 py-2 text-sm font-bold text-amber-100">
            {status}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wide text-zinc-300">
              Station Devices
            </h3>
            <p className="mt-2 max-w-3xl text-sm font-bold text-zinc-400">
              Create a station token for each PC running the desktop agent. The token lets the
              agent poll Loopbase for remote print jobs and report service/printer status.
            </p>
          </div>
          <div className="flex min-w-[280px] flex-wrap gap-2">
            <input
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
              className="min-w-[220px] flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-bold text-white"
              placeholder="Station name"
            />
            <button
              type="button"
              onClick={createDevice}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-500"
            >
              Create Token
            </button>
          </div>
        </div>

        {newToken && (
          <div className="mt-4 rounded-lg border border-emerald-700 bg-emerald-950/40 p-3">
            <p className="text-xs font-black uppercase tracking-wide text-emerald-300">
              New Station Token
            </p>
            <p className="mt-2 break-all rounded bg-zinc-950 p-3 text-sm font-bold text-white">
              {newToken}
            </p>
            <p className="mt-2 text-sm font-bold text-emerald-100">
              This is shown once here. Paste it into the Station Agent `Station print token` field.
            </p>
          </div>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(260px,0.75fr)_minmax(0,1.25fr)]">
          {devices.length ? (
            <>
              <div className="grid content-start gap-2">
                {devices.map((device) => {
                  const selected = selectedDevice?.id === device.id
                  return (
                    <button
                      key={device.id}
                      type="button"
                      onClick={() => setSelectedDeviceId(device.id)}
                      className={`rounded-lg border p-3 text-left ${
                        selected
                          ? 'border-emerald-500 bg-emerald-950/40'
                          : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
                      }`}
                    >
                      <span className="block text-sm font-black text-white">{device.name}</span>
                      <span className="mt-1 block text-xs font-bold text-zinc-500">{device.device_key}</span>
                      <span className={`mt-2 inline-flex rounded px-2 py-1 text-[11px] font-black ${
                        device.is_active ? 'bg-emerald-900 text-emerald-100' : 'bg-zinc-800 text-zinc-300'
                      }`}>
                        {device.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </button>
                  )
                })}
              </div>

              {selectedDevice && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-wide text-zinc-400">
                        Selected Station
                      </p>
                      <h4 className="mt-1 text-lg font-black text-white">{selectedDevice.name}</h4>
                    </div>
                    <span className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-black text-zinc-300">
                      {selectedDevice.device_type}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="text-xs font-black uppercase tracking-wide text-zinc-400">
                      Station name
                      <input
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-bold text-white"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-black text-zinc-200">
                      Active station
                      <input
                        type="checkbox"
                        checked={editingActive}
                        onChange={(event) => setEditingActive(event.target.checked)}
                        className="h-5 w-5 accent-emerald-500"
                      />
                    </label>
                  </div>

                  <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-black uppercase tracking-wide text-zinc-400">
                        Station token
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setShowToken((current) => !current)}
                          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-black text-zinc-200 hover:border-zinc-500"
                        >
                          {showToken ? 'Hide Token' : 'Show Token'}
                        </button>
                        <button
                          type="button"
                          onClick={() => copyText(selectedDevice.station_token || '', 'Station token')}
                          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-black text-zinc-200 hover:border-zinc-500"
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                    <p className="mt-2 break-all rounded bg-black p-3 text-sm font-bold text-white">
                      {showToken ? selectedDevice.station_token || 'No token saved for this station.' : '••••••••••••••••••••••••••••••••'}
                    </p>
                    <p className="mt-2 text-xs font-bold text-zinc-500">
                      Enter station token for this device in the Windows Station Agent.
                    </p>
                  </div>

                  <div className="mt-4 grid gap-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-xs font-bold text-zinc-400">
                    <p>Device key: <span className="text-zinc-200">{selectedDevice.device_key}</span></p>
                    <p>{selectedDevice.last_seen_at ? `Last seen ${new Date(selectedDevice.last_seen_at).toLocaleString()}` : 'Not seen yet'}</p>
                    <p>{selectedDevice.updated_at ? `Updated ${new Date(selectedDevice.updated_at).toLocaleString()}` : 'No update timestamp'}</p>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={saveSelectedDevice}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-500"
                    >
                      Save Station
                    </button>
                    <button
                      type="button"
                      onClick={() => copyText(selectedDevice.device_key, 'Device key')}
                      className="rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-black text-zinc-200 hover:border-zinc-500"
                    >
                      Copy Device Key
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm font-bold text-zinc-400">
              No station devices yet.
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h3 className="text-sm font-black uppercase tracking-wide text-zinc-300">
            Included Services
          </h3>
          <div className="mt-4 grid gap-2 text-sm font-bold text-zinc-300">
            <p>Photo ingest worker for watched folders and NAS/camera drop folders.</p>
            <p>Photo processing worker for previews used by photography sessions.</p>
            <p>RFID table bridge for receiving and live TID lists.</p>
            <p>RFID zone monitor for entrance, exit, changing room and stock room readers.</p>
            <p>Remote printer bridge for ZPL labels and A4 printers connected to the station PC.</p>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h3 className="text-sm font-black uppercase tracking-wide text-zinc-300">
            Updates
          </h3>
          <p className="mt-4 text-sm font-bold text-zinc-400">
            While the station agent is running, it checks this Loopbase release manifest and
            shows a banner at the top of its local window when a newer version is available.
          </p>
          <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs font-bold text-zinc-400">
            {release?.manifest_url || '/api/station-agent/releases/latest'}
          </div>
        </div>
      </div>

      {release?.release_notes?.length ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h3 className="text-sm font-black uppercase tracking-wide text-zinc-300">
            Current Release
          </h3>
          <ul className="mt-4 space-y-2 text-sm font-bold text-zinc-300">
            {release.release_notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

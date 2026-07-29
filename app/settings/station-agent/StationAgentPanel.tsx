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

export default function StationAgentPanel() {
  const [release, setRelease] = useState<StationAgentRelease | null>(null)
  const [status, setStatus] = useState('Loading station agent release...')

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

  const downloadUrl = useMemo(() => {
    return release?.download_url || '/api/station-agent/download'
  }, [release?.download_url])

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
              RFID threshold reader, or local ZPL label printer. It runs locally and connects
              that hardware back to Loopbase.
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
              Download Windows Agent
            </a>
          </div>
        </div>

        {status && (
          <p className="mt-4 rounded-lg border border-amber-700 bg-amber-950/40 px-3 py-2 text-sm font-bold text-amber-100">
            {status}
          </p>
        )}
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
            <p>Local ZPL/Windows printer bridge for bin and product labels.</p>
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

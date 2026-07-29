'use client'

import { useEffect, useMemo, useState } from 'react'

type RfidZone = {
  id: string
  name: string
  code: string
  zone_type: string
  status: string
  description?: string | null
  token_last_four?: string | null
  token_created_at?: string | null
  token_revoked_at?: string | null
  antenna_map?: any[]
  rules?: Record<string, any>
  last_seen_at?: string | null
}

type RfidZoneEvent = {
  id: string
  tag_key: string
  event_type: string
  direction?: string | null
  max_rssi?: number | null
  read_count?: number | null
  known_item?: boolean
  paid_or_sold?: boolean
  alarm_triggered?: boolean
  alarm_status?: string
  metadata?: Record<string, any>
  event_at?: string | null
  rfid_zones?: {
    name?: string | null
    code?: string | null
    zone_type?: string | null
  } | null
}

type ZoneDraft = {
  name: string
  code: string
  zone_type: string
  description: string
  status: string
  rules: Record<string, any>
  antenna_map: any[]
}

const zoneTypes = [
  { value: 'exit_security', label: 'Entrance / Exit Security' },
  { value: 'changing_room', label: 'Changing Room' },
  { value: 'stock_room', label: 'Stock Room Door' },
  { value: 'restricted_area', label: 'Restricted Area' },
  { value: 'movement_log', label: 'Movement Log' },
  { value: 'custom', label: 'Custom' },
]

const defaultRules: Record<string, any> = {
  exit_security: {
    ignore_unknown_tags: true,
    create_events_for_unknown_tags: false,
    alarm_on_unpaid_exit: true,
    alarm_on_unpaid_threshold: true,
    min_alarm_rssi: -50,
    min_alarm_read_count: 4,
    min_alarm_dwell_seconds: 1.2,
    alarm_cooldown_seconds: 12,
  },
  changing_room: {
    ignore_unknown_tags: true,
    create_events_for_unknown_tags: false,
    alarm_on_stale_inside: true,
    min_alarm_rssi: -58,
    min_alarm_read_count: 3,
    min_alarm_dwell_seconds: 1.5,
    stale_inside_seconds: 240,
    alarm_cooldown_seconds: 20,
  },
  stock_room: {
    ignore_unknown_tags: true,
    create_events_for_unknown_tags: false,
    min_alarm_rssi: -56,
    min_alarm_read_count: 3,
    min_alarm_dwell_seconds: 1.5,
    alarm_cooldown_seconds: 20,
  },
  movement_log: {
    ignore_unknown_tags: true,
    create_events_for_unknown_tags: false,
    min_alarm_rssi: -52,
    min_alarm_read_count: 3,
    min_alarm_dwell_seconds: 1.5,
    alarm_cooldown_seconds: 12,
  },
}

const defaultAntennaMap = [
  { antenna: 1, side: 'outside', label: 'Outside approach' },
  { antenna: 2, side: 'inside', label: 'Inside / store side' },
]

function emptyDraft(): ZoneDraft {
  return {
    name: 'Shop Entrance / Exit',
    code: 'SHOP-ENTRANCE-EXIT',
    zone_type: 'exit_security',
    description: '',
    status: 'active',
    rules: { ...defaultRules.exit_security },
    antenna_map: defaultAntennaMap,
  }
}

function formatDate(value?: string | null) {
  if (!value) return 'Never'
  return new Date(value).toLocaleString('en-GB')
}

function ruleNumber(value: any, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export default function RfidZonesPanel() {
  const [zones, setZones] = useState<RfidZone[]>([])
  const [draft, setDraft] = useState<ZoneDraft>(emptyDraft)
  const [selectedId, setSelectedId] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [freshToken, setFreshToken] = useState('')
  const [events, setEvents] = useState<RfidZoneEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)

  const selectedZone = useMemo(
    () => zones.find((zone) => zone.id === selectedId) || null,
    [selectedId, zones]
  )

  useEffect(() => {
    loadZones()
    loadEvents()
  }, [])

  async function loadZones() {
    setLoading(true)
    const response = await fetch('/api/rfid/zones')
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.ok) {
      setMessage(data.message || 'Could not load RFID zones.')
      setLoading(false)
      return
    }
    setZones(data.zones || [])
    setLoading(false)
  }

  async function loadEvents(zoneId = selectedId) {
    setEventsLoading(true)
    const params = new URLSearchParams({ limit: '40' })
    if (zoneId) params.set('zone_id', zoneId)
    const response = await fetch(`/api/rfid/zone-events?${params.toString()}`)
    const data = await response.json().catch(() => ({}))
    setEventsLoading(false)
    if (!response.ok || !data.ok) {
      if (data.message) setMessage(data.message)
      setEvents([])
      return
    }
    setEvents(data.events || [])
  }

  function loadZoneIntoDraft(zone: RfidZone) {
    setFreshToken('')
    setSelectedId(zone.id)
    setDraft({
      name: zone.name || '',
      code: zone.code || '',
      zone_type: zone.zone_type || 'movement_log',
      description: zone.description || '',
      status: zone.status || 'active',
      rules: { ...(defaultRules[zone.zone_type] || defaultRules.movement_log), ...(zone.rules || {}) },
      antenna_map: Array.isArray(zone.antenna_map) && zone.antenna_map.length ? zone.antenna_map : defaultAntennaMap,
    })
    loadEvents(zone.id)
  }

  function startNewZone(type = 'exit_security') {
    setFreshToken('')
    setSelectedId('')
    setDraft({
      ...emptyDraft(),
      zone_type: type,
      rules: { ...(defaultRules[type] || defaultRules.movement_log) },
    })
    loadEvents('')
  }

  function updateRule(key: string, value: any) {
    setDraft((current) => ({
      ...current,
      rules: {
        ...current.rules,
        [key]: value,
      },
    }))
  }

  function updateZoneType(type: string) {
    setDraft((current) => ({
      ...current,
      zone_type: type,
      rules: { ...(defaultRules[type] || defaultRules.movement_log), ...current.rules },
    }))
  }

  async function saveZone() {
    setSaving(true)
    setMessage('')
    const payload = {
      id: selectedId || undefined,
      name: draft.name,
      code: draft.code,
      zone_type: draft.zone_type,
      status: draft.status,
      description: draft.description,
      rules: draft.rules,
      antenna_map: draft.antenna_map,
      create_token: !selectedId,
    }
    const response = await fetch('/api/rfid/zones', {
      method: selectedId ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await response.json().catch(() => ({}))
    setSaving(false)
    if (!response.ok || !data.ok) {
      setMessage(data.message || 'RFID zone save failed.')
      return
    }
    setFreshToken(data.token || '')
    setMessage(data.token ? 'Zone saved. Copy the token now; it is shown once.' : 'Zone saved.')
    await loadZones()
    await loadEvents(data.zone?.id || selectedId)
    if (data.zone?.id) setSelectedId(data.zone.id)
  }

  async function createToken(zoneId = selectedId) {
    if (!zoneId) return
    setFreshToken('')
    setSaving(true)
    const response = await fetch('/api/rfid/zones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create_token', zone_id: zoneId }),
    })
    const data = await response.json().catch(() => ({}))
    setSaving(false)
    if (!response.ok || !data.ok) {
      setMessage(data.message || 'Token generation failed.')
      return
    }
    setFreshToken(data.token || '')
    setMessage('Token generated. Copy it into the Loopbase Station Agent RFID Zone token field.')
    await loadZones()
    await loadEvents()
  }

  async function revokeToken(zoneId = selectedId) {
    if (!zoneId) return
    if (!window.confirm('Revoke this RFID zone token? The local station will stop posting events until a new token is added.')) return
    setSaving(true)
    const response = await fetch('/api/rfid/zones', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'revoke_token', zone_id: zoneId }),
    })
    const data = await response.json().catch(() => ({}))
    setSaving(false)
    if (!response.ok || !data.ok) {
      setMessage(data.message || 'Token revoke failed.')
      return
    }
    setFreshToken('')
    setMessage('Token revoked.')
    await loadZones()
    await loadEvents()
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-300">
            RFID Zones
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Configure threshold readers for entrances, exits, changing rooms, stock rooms and custom movement tracking.
          </p>
        </div>

        <button
          type="button"
          onClick={() => startNewZone()}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-black text-white hover:bg-green-500"
        >
          Add Zone
        </button>
      </div>

      {message && (
        <div className="mb-4 rounded-lg border border-yellow-700 bg-yellow-950 px-4 py-2 text-sm font-bold text-yellow-200">
          {message}
        </div>
      )}

      {freshToken && (
        <div className="mb-4 rounded-xl border border-emerald-700 bg-emerald-950 p-4">
          <p className="text-xs font-black uppercase tracking-wide text-emerald-200">
            Station token
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <code className="min-w-0 flex-1 overflow-auto rounded-lg bg-black px-3 py-2 text-sm font-bold text-emerald-100">
              {freshToken}
            </code>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(freshToken)}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-500"
            >
              Copy
            </button>
          </div>
          <p className="mt-2 text-xs font-bold text-emerald-200">
            Paste this into Loopbase Station Agent - RFID Zone token. It will not be shown again.
          </p>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(240px,360px)_1fr]">
        <div className="space-y-2">
          {loading && <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm font-bold text-zinc-400">Loading zones...</div>}
          {!loading && zones.length === 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm font-bold text-zinc-400">
              No RFID zones yet.
            </div>
          )}
          {zones.map((zone) => (
            <button
              key={zone.id}
              type="button"
              onClick={() => loadZoneIntoDraft(zone)}
              className={`w-full rounded-xl border p-3 text-left ${
                selectedId === zone.id
                  ? 'border-emerald-500 bg-emerald-950 text-white'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600'
              }`}
            >
              <span className="block text-sm font-black">{zone.name}</span>
              <span className="mt-1 block text-xs font-bold text-zinc-500">
                {zoneTypes.find((type) => type.value === zone.zone_type)?.label || zone.zone_type} · {zone.status}
              </span>
              <span className="mt-1 block text-xs font-bold text-zinc-500">
                Last seen: {formatDate(zone.last_seen_at)}
              </span>
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <div className="grid gap-3 lg:grid-cols-2">
            <label className="text-xs font-black uppercase tracking-wide text-zinc-500">
              Zone name
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-bold text-white"
              />
            </label>
            <label className="text-xs font-black uppercase tracking-wide text-zinc-500">
              Code
              <input
                value={draft.code}
                onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase() })}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-bold text-white"
              />
            </label>
            <label className="text-xs font-black uppercase tracking-wide text-zinc-500">
              Zone type
              <select
                value={draft.zone_type}
                onChange={(event) => updateZoneType(event.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-bold text-white"
              >
                {zoneTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-black uppercase tracking-wide text-zinc-500">
              Status
              <select
                value={draft.status}
                onChange={(event) => setDraft({ ...draft, status: event.target.value })}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-bold text-white"
              >
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
                <option value="archived">Archived</option>
              </select>
            </label>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <Toggle label="Ignore unknown/random RFIDs" checked={draft.rules.ignore_unknown_tags !== false} onChange={(checked) => updateRule('ignore_unknown_tags', checked)} />
            <Toggle label="Log unknown RFIDs anyway" checked={draft.rules.create_events_for_unknown_tags === true} onChange={(checked) => updateRule('create_events_for_unknown_tags', checked)} />
            <Toggle label="Alarm if unpaid item exits" checked={draft.rules.alarm_on_unpaid_exit === true} onChange={(checked) => updateRule('alarm_on_unpaid_exit', checked)} />
            <Toggle label="Warn when unpaid item is at threshold" checked={draft.rules.alarm_on_unpaid_threshold === true} onChange={(checked) => updateRule('alarm_on_unpaid_threshold', checked)} />
            <Toggle label="Warn if item remains inside too long" checked={draft.rules.alarm_on_stale_inside === true} onChange={(checked) => updateRule('alarm_on_stale_inside', checked)} />
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-4">
            <NumberField label="RSSI alarm threshold" value={ruleNumber(draft.rules.min_alarm_rssi, -52)} onChange={(value) => updateRule('min_alarm_rssi', value)} />
            <NumberField label="Minimum reads" value={ruleNumber(draft.rules.min_alarm_read_count, 3)} onChange={(value) => updateRule('min_alarm_read_count', value)} />
            <NumberField label="Dwell seconds" value={ruleNumber(draft.rules.min_alarm_dwell_seconds, 1.5)} onChange={(value) => updateRule('min_alarm_dwell_seconds', value)} />
            <NumberField label="Alarm cooldown seconds" value={ruleNumber(draft.rules.alarm_cooldown_seconds, 12)} onChange={(value) => updateRule('alarm_cooldown_seconds', value)} />
          </div>

          <label className="mt-4 block text-xs font-black uppercase tracking-wide text-zinc-500">
            Antenna map JSON
            <textarea
              value={JSON.stringify(draft.antenna_map, null, 2)}
              onChange={(event) => {
                try {
                  const parsed = JSON.parse(event.target.value)
                  if (Array.isArray(parsed)) setDraft({ ...draft, antenna_map: parsed })
                } catch {
                  // Keep typing smooth while JSON is temporarily invalid.
                }
              }}
              className="mt-1 min-h-32 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs font-bold text-white"
            />
          </label>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={saveZone}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-black text-white hover:bg-green-500 disabled:opacity-50"
            >
              {selectedZone ? 'Save Zone' : 'Create Zone'}
            </button>
            {selectedZone && (
              <>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => createToken()}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-black text-white hover:border-white disabled:opacity-50"
                >
                  Generate Token
                </button>
                <button
                  type="button"
                  disabled={saving || !selectedZone.token_last_four}
                  onClick={() => revokeToken()}
                  className="rounded-lg border border-red-800 bg-red-950 px-4 py-2 text-sm font-black text-white hover:border-red-400 disabled:opacity-50"
                >
                  Revoke Token
                </button>
              </>
            )}
          </div>

          {selectedZone && (
            <p className="mt-3 text-xs font-bold text-zinc-500">
              Token: {selectedZone.token_last_four ? `configured, ending ${selectedZone.token_last_four}` : 'not configured'}.
              Last seen: {formatDate(selectedZone.last_seen_at)}.
            </p>
          )}
        </div>
      </div>

      <section className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wide text-zinc-300">
              Recent Zone Events
            </h3>
            <p className="mt-1 text-xs font-bold text-zinc-500">
              Shows reads and alarms for {selectedZone ? selectedZone.name : 'all RFID zones'} in this company.
            </p>
          </div>
          <button
            type="button"
            onClick={() => loadEvents()}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-black text-white hover:border-white"
          >
            Refresh
          </button>
        </div>

        <div className="overflow-auto rounded-lg border border-zinc-800">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-zinc-900 text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-black uppercase">Time</th>
                <th className="px-3 py-2 font-black uppercase">Zone</th>
                <th className="px-3 py-2 font-black uppercase">Event</th>
                <th className="px-3 py-2 font-black uppercase">Tag / SKU</th>
                <th className="px-3 py-2 font-black uppercase">Signal</th>
                <th className="px-3 py-2 font-black uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 bg-black">
              {eventsLoading && (
                <tr><td className="px-3 py-4 font-bold text-zinc-400" colSpan={6}>Loading events...</td></tr>
              )}
              {!eventsLoading && events.length === 0 && (
                <tr><td className="px-3 py-4 font-bold text-zinc-400" colSpan={6}>No zone events yet.</td></tr>
              )}
              {!eventsLoading && events.map((event) => {
                const sku = event.metadata?.item_sku || event.metadata?.item_title || event.tag_key
                return (
                  <tr key={event.id} className={event.alarm_triggered ? 'bg-red-950/50 text-red-100' : 'text-zinc-300'}>
                    <td className="whitespace-nowrap px-3 py-2 font-bold">{formatDate(event.event_at)}</td>
                    <td className="px-3 py-2 font-bold">{event.rfid_zones?.name || 'Unknown zone'}</td>
                    <td className="px-3 py-2 font-black uppercase">{event.event_type}</td>
                    <td className="px-3 py-2">
                      <span className="block font-black">{sku}</span>
                      <code className="text-[11px] text-zinc-500">{event.tag_key}</code>
                    </td>
                    <td className="px-3 py-2 font-bold">
                      RSSI {event.max_rssi ?? '-'} / reads {event.read_count ?? 0}
                    </td>
                    <td className="px-3 py-2 font-black">
                      {event.alarm_triggered ? 'Alarm' : event.known_item ? (event.paid_or_sold ? 'Paid / sold' : 'Known unpaid') : 'Unknown ignored/logged'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`rounded-xl border p-3 text-left text-sm font-black ${
        checked
          ? 'border-emerald-600 bg-emerald-950 text-white'
          : 'border-zinc-800 bg-zinc-900 text-zinc-300'
      }`}
    >
      {label}: {checked ? 'Yes' : 'No'}
    </button>
  )
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="text-xs font-black uppercase tracking-wide text-zinc-500">
      {label}
      <input
        type="number"
        step="0.1"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-bold text-white"
      />
    </label>
  )
}

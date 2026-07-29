'use client'

import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { useCompany } from '@/app/context/CompanyContext'

type TruthPayload = {
  ok: boolean
  message?: string
  company?: { id: string; name: string }
  item?: any
  summary?: any
  stock_rows?: any[]
  reservations?: any[]
  order_lines?: any[]
  alerts?: any[]
  warnings?: string[]
}

function text(value: unknown) {
  return String(value || '').trim()
}

function numberText(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '0'
  return numeric.toLocaleString('en-GB', { maximumFractionDigits: 2 })
}

function dateText(value: unknown) {
  const raw = text(value)
  if (!raw) return '-'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusClass(status: unknown) {
  const value = text(status).toLowerCase()
  if (['active', 'reserved', 'open'].includes(value)) return 'border-emerald-500/40 bg-emerald-950 text-emerald-100'
  if (['cancelled', 'released', 'failed'].includes(value)) return 'border-red-500/40 bg-red-950 text-red-100'
  if (['deducted', 'dispatched', 'processed', 'resolved'].includes(value)) return 'border-sky-500/40 bg-sky-950 text-sky-100'
  return 'border-neutral-700 bg-neutral-900 text-neutral-200'
}

function Card({
  title,
  children,
  action,
}: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-black text-white">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Metric({ label, value, tone = 'neutral' }: { label: string; value: unknown; tone?: 'neutral' | 'green' | 'red' | 'amber' }) {
  const toneClass =
    tone === 'green'
      ? 'text-emerald-300'
      : tone === 'red'
        ? 'text-red-300'
        : tone === 'amber'
          ? 'text-amber-300'
          : 'text-white'

  return (
    <div className="rounded-xl border border-neutral-800 bg-black p-4">
      <p className="text-xs font-black uppercase text-neutral-500">{label}</p>
      <p className={`mt-2 text-2xl font-black ${toneClass}`}>{numberText(value)}</p>
    </div>
  )
}

function StockTruthView() {
  const params = useSearchParams()
  const { activeCompany, activeCompanyId } = useCompany()
  const initialSku = params.get('sku') || ''
  const [sku, setSku] = useState(initialSku)
  const [searchedSku, setSearchedSku] = useState(initialSku)
  const [payload, setPayload] = useState<TruthPayload | null>(null)
  const [loading, setLoading] = useState(false)

  const activeReservations = useMemo(
    () => (payload?.reservations || []).filter((row) => text(row.reservation_status).toLowerCase() === 'active'),
    [payload]
  )

  useEffect(() => {
    if (!initialSku) return
    fetchTruth(initialSku)
  }, [initialSku, activeCompanyId])

  async function fetchTruth(nextSku = sku) {
    const cleanSku = text(nextSku).toUpperCase()
    if (!cleanSku) return

    setLoading(true)
    setPayload(null)
    setSearchedSku(cleanSku)

    try {
      const response = await fetch(`/api/stock/truth?sku=${encodeURIComponent(cleanSku)}`, {
        cache: 'no-store',
      })
      const data = await response.json().catch(() => null)
      setPayload(data || { ok: false, message: `Unexpected response ${response.status}` })
    } catch (error: any) {
      setPayload({ ok: false, message: error.message || 'Stock truth lookup failed.' })
    } finally {
      setLoading(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    fetchTruth()
  }

  const item = payload?.item
  const summary = payload?.summary

  return (
    <StaffPermissionGate permission="inventory">
      <main className="min-h-screen bg-neutral-950 p-5 text-white">
        <div className="app-header mb-5 rounded-3xl bg-black p-4 text-white shadow-2xl sm:p-5">
          <AppNav current="inventory" />
          <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black tracking-normal">Stock / Order Truth</h1>
              <p className="mt-1 text-sm font-bold text-neutral-400">
                Inspect one SKU across stock rows, reservations, orders, and alerts for {activeCompany?.name || 'the active company'}.
              </p>
            </div>
            {item?.id && (
              <Link
                href={`/items/${item.id}`}
                className="rounded-xl bg-white px-4 py-2 text-sm font-black text-black hover:bg-neutral-200"
              >
                Open SKU
              </Link>
            )}
          </div>
        </div>

        <form onSubmit={submit} className="mb-5 flex gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <input
            value={sku}
            onChange={(event) => setSku(event.target.value)}
            placeholder="Enter SKU"
            className="min-w-0 flex-1 rounded-xl border border-neutral-700 bg-black px-4 py-3 text-sm font-black uppercase text-white outline-none focus:border-white"
          />
          <button
            type="submit"
            disabled={loading || !text(sku)}
            className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-black text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Checking...' : 'Check'}
          </button>
        </form>

        {payload && !payload.ok && (
          <div className="rounded-2xl border border-red-800 bg-red-950 p-5 text-sm font-bold text-red-100">
            {payload.message || `No stock truth found for ${searchedSku}.`}
          </div>
        )}

        {payload?.ok && item && summary && (
          <div className="space-y-5">
            {(payload.warnings || []).length > 0 && (
              <div className="rounded-2xl border border-amber-700 bg-amber-950 p-4 text-sm font-bold text-amber-100">
                {payload.warnings?.join(' ')}
              </div>
            )}

            <Card title="SKU Summary">
              <div className="grid gap-4 lg:grid-cols-[1.3fr_2fr]">
                <div className="rounded-xl border border-neutral-800 bg-black p-4">
                  <p className="text-xs font-black uppercase text-neutral-500">SKU</p>
                  <h2 className="mt-2 break-all text-2xl font-black text-white">{item.sku}</h2>
                  <p className="mt-2 text-sm font-bold text-neutral-300">{item.title || 'Untitled item'}</p>
                  <p className="mt-2 text-xs font-bold text-neutral-500">
                    {item.brand || 'No brand'} / {item.reporting_category || 'No category'} / {item.sub_category || 'No sub category'}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric label="Physical Level" value={summary.physical_stock} />
                  <Metric label="Available" value={summary.available_stock} tone={Number(summary.available_stock) < 0 ? 'red' : 'green'} />
                  <Metric label="Open Orders" value={summary.open_order_stock} tone="amber" />
                  <Metric label="Channel Exposed" value={summary.channel_exposed_stock} />
                  <Metric label="Inbound" value={summary.inbound_stock} />
                  <Metric label="Quarantine" value={summary.quarantine_stock} />
                  <Metric label="Buffer" value={summary.stock_buffer} />
                  <Metric
                    label="Stock Level Difference"
                    value={summary.stock_level_difference}
                    tone={Number(summary.stock_level_difference) === 0 ? 'green' : 'amber'}
                  />
                </div>
              </div>
            </Card>

            <div className="grid gap-5 xl:grid-cols-2">
              <Card title="Location / Bin Rows">
                {(payload.stock_rows || []).length === 0 ? (
                  <p className="text-sm font-bold text-neutral-500">No stock rows found.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs uppercase text-neutral-500">
                        <tr>
                          <th className="py-2 pr-3">Location</th>
                          <th className="py-2 pr-3">Bin</th>
                          <th className="py-2 pr-3 text-right">Level</th>
                          <th className="py-2 pr-3">Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payload.stock_rows?.map((row) => (
                          <tr key={row.id} className="border-t border-neutral-800">
                            <td className="py-2 pr-3 font-black">{row.location_name || '-'}</td>
                            <td className="py-2 pr-3">{row.bin_code || '-'}</td>
                            <td className={`py-2 pr-3 text-right font-black ${Number(row.stock_level) < 0 ? 'text-red-300' : 'text-white'}`}>
                              {numberText(row.stock_level)}
                            </td>
                            <td className="py-2 pr-3 text-xs text-neutral-500">{row.source || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card
                title="Reservations"
                action={<span className="text-xs font-black text-neutral-500">{activeReservations.length} active</span>}
              >
                {(payload.reservations || []).length === 0 ? (
                  <p className="text-sm font-bold text-neutral-500">No reservations found.</p>
                ) : (
                  <div className="space-y-3">
                    {payload.reservations?.map((reservation) => (
                      <div key={reservation.id} className="rounded-xl border border-neutral-800 bg-black p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className={`rounded-lg border px-2 py-1 text-xs font-black ${statusClass(reservation.reservation_status)}`}>
                            {reservation.reservation_status}
                          </span>
                          <span className="text-xs font-bold text-neutral-500">
                            {reservation.stock_already_deducted ? 'physical deducted' : 'reservation only'}
                          </span>
                        </div>
                        <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                          <p><span className="text-neutral-500">Order:</span> {reservation.external_order_id}</p>
                          <p><span className="text-neutral-500">Qty:</span> {numberText(reservation.quantity)}</p>
                          <p><span className="text-neutral-500">Channel:</span> {reservation.channel}</p>
                          <p><span className="text-neutral-500">Updated:</span> {dateText(reservation.updated_at)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            <Card title="Loopbase Order Lines">
              {(payload.order_lines || []).length === 0 ? (
                <p className="text-sm font-bold text-neutral-500">No Loopbase order lines found yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase text-neutral-500">
                      <tr>
                        <th className="py-2 pr-3">Source</th>
                        <th className="py-2 pr-3">Order</th>
                        <th className="py-2 pr-3">Line</th>
                        <th className="py-2 pr-3 text-right">Qty</th>
                        <th className="py-2 pr-3">Stock Mode</th>
                        <th className="py-2 pr-3">Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payload.order_lines?.map((line) => {
                        const order = Array.isArray(line.order) ? line.order[0] : line.order
                        return (
                          <tr key={line.id} className="border-t border-neutral-800">
                            <td className="py-2 pr-3">{order?.order_source || '-'}</td>
                            <td className="py-2 pr-3 font-mono text-xs">{order?.external_order_number || order?.external_order_id || '-'}</td>
                            <td className="py-2 pr-3">
                              <span className={`rounded-lg border px-2 py-1 text-xs font-black ${statusClass(line.line_status)}`}>
                                {line.line_status}
                              </span>
                            </td>
                            <td className="py-2 pr-3 text-right font-black">{numberText(line.quantity)}</td>
                            <td className="py-2 pr-3">{order?.stock_mode || '-'}</td>
                            <td className="py-2 pr-3 text-xs text-neutral-500">{dateText(line.updated_at)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Stock Alerts">
              {(payload.alerts || []).length === 0 ? (
                <p className="text-sm font-bold text-neutral-500">No alerts found.</p>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {payload.alerts?.map((alert) => (
                    <div key={alert.id} className="rounded-xl border border-neutral-800 bg-black p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-black">{alert.title}</p>
                        <span className={`rounded-lg border px-2 py-1 text-xs font-black ${statusClass(alert.status)}`}>
                          {alert.status}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-bold text-neutral-300">{alert.message}</p>
                      <p className="mt-2 text-xs font-bold text-neutral-500">
                        {alert.location_name || '-'} / {alert.bin_code || '-'} / {dateText(alert.created_at)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </main>
    </StaffPermissionGate>
  )
}

export default function StockTruthPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-neutral-950 p-5 text-white">
          Loading stock truth...
        </main>
      }
    >
      <StockTruthView />
    </Suspense>
  )
}

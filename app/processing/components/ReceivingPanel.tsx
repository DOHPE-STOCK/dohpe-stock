'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStaff } from '@/app/context/StaffContext'
import { supabase } from '@/lib/supabase'

type InboundBatch = {
  id: string
  batch_code: string
  supplier_name: string | null
  order_reference: string | null
  expected_quantity: number
  actual_quantity: number | null
  default_brand: string | null
  default_reporting_category: string | null
  default_sub_category: string | null
  default_item_type: string | null
  cost_price: number | null
  status: string
  created_at: string
}

type ReceivingPanelProps = {
  activeCompanyId?: string
  schemaReady?: boolean
  selectedBatchId?: string
  onChanged?: () => void
}

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function parseTidList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\s,;]+/)
        .map((tid) => tid.trim().replace(/\s+/g, '').toUpperCase())
        .filter(Boolean)
    )
  )
}

export default function ReceivingPanel({
  activeCompanyId = '',
  schemaReady = false,
  selectedBatchId = '',
  onChanged,
}: ReceivingPanelProps) {
  const { staff } = useStaff()
  const [batches, setBatches] = useState<InboundBatch[]>([])
  const [activeBatchId, setActiveBatchId] = useState(selectedBatchId)
  const [actualQuantity, setActualQuantity] = useState('')
  const [tids, setTids] = useState<string[]>([])
  const [manualTidText, setManualTidText] = useState('')
  const [manualFallbackOpen, setManualFallbackOpen] = useState(false)
  const [bridgeUrl, setBridgeUrl] = useState('http://127.0.0.1:8765')
  const [bridgeStatus, setBridgeStatus] = useState<any>(null)
  const [bridgeScanning, setBridgeScanning] = useState(false)
  const [rfidReceivingEnabled, setRfidReceivingEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [createdItems, setCreatedItems] = useState<Array<{ id: string; sku: string; rfid_tid?: string | null }>>([])
  const pollingRef = useRef<number | null>(null)

  useEffect(() => {
    fetchBatches()
    fetchWorkflowSettings()
  }, [activeCompanyId, schemaReady])

  useEffect(() => {
    if (selectedBatchId) setActiveBatchId(selectedBatchId)
  }, [selectedBatchId])

  const activeBatch = useMemo(
    () => batches.find((batch) => batch.id === activeBatchId) || null,
    [activeBatchId, batches]
  )

  const targetQuantity = Number(actualQuantity || activeBatch?.actual_quantity || activeBatch?.expected_quantity || 0)
  const countMatches = targetQuantity > 0 && tids.length === targetQuantity
  const countDelta = tids.length - targetQuantity
  const countGuidance =
    targetQuantity <= 0
      ? 'Enter an actual quantity before scanning.'
      : countDelta === 0
        ? 'Count matches. Ready to generate the working batch.'
        : countDelta > 0
          ? `Too many tags. Remove ${countDelta} tag(s) from the table.`
          : `Short by ${Math.abs(countDelta)} tag(s). Add more tags to the table.`
  const countStatusClass =
    targetQuantity <= 0
      ? 'border-zinc-800 bg-zinc-900'
      : countDelta === 0
        ? 'border-green-800 bg-green-950/40'
        : countDelta > 0
          ? 'border-red-800 bg-red-950/40'
          : 'border-yellow-800 bg-yellow-950/40'

  useEffect(() => {
    return () => {
      if (pollingRef.current) window.clearInterval(pollingRef.current)
    }
  }, [])

  useEffect(() => {
    if (!activeBatch) return
    setActualQuantity(String(activeBatch.actual_quantity || activeBatch.expected_quantity || ''))
    setCreatedItems([])
    setMessage('')
  }, [activeBatch?.id])

  async function fetchBatches() {
    let query = supabase
      .from('inbound_batches')
      .select('*')
      .in('status', ['receiving'])
      .order('created_at', { ascending: false })

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data, error } = await query

    if (error) {
      setMessage(error.message)
      return
    }

    const nextBatches = (data || []) as InboundBatch[]
    setBatches(nextBatches)

    if (!activeBatchId && nextBatches[0]) {
      setActiveBatchId(nextBatches[0].id)
    }
  }

  async function fetchWorkflowSettings() {
    let query = supabase
      .from('app_settings')
      .select('enable_rfid_receiving')
      .limit(1)

    query = schemaReady
      ? query.eq('company_id', activeCompanyId)
      : query.eq('id', 'default')

    const { data, error } = await query.maybeSingle()

    if (error) {
      setMessage(error.message)
      return
    }

    setRfidReceivingEnabled(Boolean(data?.enable_rfid_receiving))
  }

  function bridgeEndpoint(path: string) {
    return `${bridgeUrl.replace(/\/+$/, '')}${path}`
  }

  function normalizeBridgeTids(rows: any) {
    const sourceRows = Array.isArray(rows?.tids)
      ? rows.tids
      : Array.isArray(rows?.tags)
        ? rows.tags
        : Array.isArray(rows)
          ? rows
          : []

    return Array.from(
      new Set<string>(
        sourceRows
          .map((row: any) => {
            if (typeof row === 'string') return row
            return row?.tid || row?.TID || row?.Tid || row?.epc || row?.EPC || ''
          })
          .map((tid: string) => tid.trim().replace(/\s+/g, '').toUpperCase())
          .filter(Boolean)
      )
    )
  }

  async function callBridge(path: string, options: RequestInit = {}) {
    const response = await fetch(bridgeEndpoint(path), {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
    })

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      throw new Error(data?.message || data?.error || `RFID bridge ${path} failed.`)
    }

    return data
  }

  async function refreshBridgeStatus(showMessage = true) {
    try {
      const data = await callBridge('/status')
      const nextTids = normalizeBridgeTids(data)

      setBridgeStatus(data)
      setBridgeScanning(Boolean(data?.scanning))
      setTids(nextTids)
      if (showMessage) setMessage(`RFID table connected. ${nextTids.length} tag(s) on table.`)
    } catch (error: any) {
      setBridgeStatus(null)
      setBridgeScanning(false)
      if (showMessage) {
        setMessage(
          `${error.message || 'RFID table bridge unavailable.'} Start the local RFID bridge on this device first.`
        )
      }
    }
  }

  function startPolling() {
    if (pollingRef.current) window.clearInterval(pollingRef.current)
    pollingRef.current = window.setInterval(() => refreshBridgeStatus(false), 700)
  }

  function stopPolling() {
    if (pollingRef.current) {
      window.clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }

  async function startTableScan() {
    try {
      await callBridge('/scan/start', {
        method: 'POST',
        body: JSON.stringify({
          expected_quantity: targetQuantity,
          read_tid: true,
        }),
      })
      setBridgeScanning(true)
      setMessage('RFID table scan started.')
      startPolling()
      refreshBridgeStatus(false)
    } catch (error: any) {
      setMessage(`${error.message || 'Could not start RFID table scan.'} Check the local bridge is running.`)
    }
  }

  async function stopTableScan() {
    try {
      await callBridge('/scan/stop', { method: 'POST' })
      setBridgeScanning(false)
      stopPolling()
      await refreshBridgeStatus(false)
      setMessage('RFID table scan stopped.')
    } catch (error: any) {
      setMessage(error.message || 'Could not stop RFID table scan.')
    }
  }

  async function clearTableRead() {
    try {
      await callBridge('/clear', { method: 'POST' })
      setTids([])
      setBridgeStatus(null)
      setMessage('RFID table read cleared.')
    } catch (error: any) {
      setTids([])
      setMessage(error.message || 'Could not clear RFID table bridge.')
    }
  }

  function applyManualTids() {
    setTids(parseTidList(manualTidText))
    setMessage('Manual RFID list loaded for testing.')
  }

  function fillDemoTids() {
    const quantity = targetQuantity || 1
    const rows = Array.from({ length: quantity }, (_, index) => {
      return `TID${Date.now().toString(16).toUpperCase()}${String(index + 1).padStart(4, '0')}`
    })
    setTids(rows)
    setManualTidText(rows.join('\n'))
  }

  async function generateWorkingBatch() {
    if (!activeBatch) {
      setMessage('Choose a receiving batch first.')
      return
    }

    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    if (rfidReceivingEnabled && !countMatches) {
      setMessage(`TID count must match actual quantity. Current: ${tids.length} / ${targetQuantity || 0}.`)
      return
    }

    if (!rfidReceivingEnabled && targetQuantity <= 0) {
      setMessage('Enter an actual quantity before generating the working batch.')
      return
    }

    setLoading(true)
    setMessage(`Creating ${targetQuantity} working items from ${activeBatch.batch_code}...`)
    setCreatedItems([])

    const response = await fetch('/api/processing/receiving/generate-working-items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        batch_id: activeBatch.id,
        actual_quantity: targetQuantity,
        tids: rfidReceivingEnabled ? tids : [],
        use_rfid: rfidReceivingEnabled,
        staff_id: staff.id,
        company_id: schemaReady ? activeCompanyId : null,
      }),
    })

    const data = await response.json().catch(() => null)
    setLoading(false)

    if (!response.ok || !data?.ok) {
      setMessage(data?.message || 'Could not generate working batch.')
      return
    }

    setMessage(`Created ${data.created_count} working item(s) for ${data.batch_code}.`)
    setCreatedItems(data.items || [])
    setTids([])
    setManualTidText('')
    stopPolling()
    fetchBatches()
    onChanged?.()
  }

  return (
    <div className="space-y-5">
      {message && (
        <div className="rounded-lg border border-yellow-700 bg-yellow-950 p-3 text-sm font-bold text-yellow-300">
          {message}
        </div>
      )}

      <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
        <div className="mb-4">
          <h3 className="text-lg font-black">
            {rfidReceivingEnabled ? 'Receive RFID Batch' : 'Receive Batch'}
          </h3>
          <p className="text-sm font-bold text-zinc-400">
            {rfidReceivingEnabled
              ? 'Control the RFID table from Loopbase, count tags live, then create linked working items.'
              : 'Confirm the actual quantity, then create the working items for this batch.'}
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="space-y-3">
            <label>
              <span className="mb-1 block text-xs font-black uppercase text-zinc-500">Batch</span>
              <select
                value={activeBatchId}
                onChange={(event) => setActiveBatchId(event.target.value)}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-3 text-white"
              >
                <option value="">Choose batch...</option>
                {batches.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.batch_code} · {batch.supplier_name || 'No supplier'} · {batch.expected_quantity}
                  </option>
                ))}
              </select>
            </label>

            {activeBatch && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                <p className="text-sm font-black text-white">{activeBatch.batch_code}</p>
                <p className="mt-1 text-xs font-bold text-zinc-400">
                  {activeBatch.supplier_name || 'No supplier'} · {activeBatch.order_reference || 'No ref'}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-zinc-300">
                  <span>Expected: {activeBatch.expected_quantity}</span>
                  <span>Cost: {activeBatch.cost_price ?? '-'}</span>
                  <span>Brand: {activeBatch.default_brand || '-'}</span>
                  <span>Category: {activeBatch.default_reporting_category || '-'}</span>
                </div>
              </div>
            )}

            <label>
              <span className="mb-1 block text-xs font-black uppercase text-zinc-500">Actual quantity</span>
              <input
                value={actualQuantity}
                onChange={(event) => setActualQuantity(event.target.value)}
                inputMode="numeric"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-3 text-white"
              />
            </label>

            {rfidReceivingEnabled ? (
              <div className={`rounded-xl border p-4 ${countStatusClass}`}>
                <p className="text-sm font-black">
                  RFID count: {tids.length} / {targetQuantity || 0}
                </p>
                <p className="mt-2 text-sm font-black text-white">{countGuidance}</p>
                <p className="mt-1 text-xs font-bold text-zinc-400">
                  Unique TIDs only. Duplicates are ignored before saving.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                <p className="text-sm font-black">Barcode batch mode</p>
                <p className="mt-2 text-sm font-bold text-zinc-400">
                  Creates {targetQuantity || 0} working item(s) without the RFID table bridge. SKUs and barcodes can still be scanned through the normal workflow.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {rfidReceivingEnabled && (
              <>
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-black uppercase text-zinc-300">RFID Table Control</h4>
                  <p className="mt-1 text-xs font-bold text-zinc-500">
                    Local bridge endpoint. Windows/Android/Python/C# can implement this API.
                  </p>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-black ${bridgeScanning ? 'bg-green-900 text-green-200' : 'bg-zinc-800 text-zinc-300'}`}>
                  {bridgeScanning ? 'Scanning' : 'Idle'}
                </span>
              </div>

              <label>
                <span className="mb-1 block text-xs font-black uppercase text-zinc-500">Bridge URL</span>
                <input
                  value={bridgeUrl}
                  onChange={(event) => setBridgeUrl(event.target.value)}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-white"
                />
              </label>

              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={startTableScan}
                  disabled={!activeBatch || bridgeScanning}
                  className="rounded-xl bg-green-600 px-5 py-3 text-sm font-black text-white hover:bg-green-500 disabled:opacity-40"
                >
                  Start Scan
                </button>

                <button
                  type="button"
                  onClick={stopTableScan}
                  disabled={!bridgeScanning}
                  className="rounded-xl bg-zinc-800 px-5 py-3 text-sm font-black text-white hover:bg-zinc-700 disabled:opacity-40"
                >
                  Stop
                </button>

                <button
                  type="button"
                  onClick={() => refreshBridgeStatus(true)}
                  className="rounded-xl px-5 py-3 text-sm font-black"
                  style={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', color: '#ffffff' }}
                >
                  Refresh
                </button>

                <button
                  type="button"
                  onClick={clearTableRead}
                  className="rounded-xl px-5 py-3 text-sm font-black"
                  style={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', color: '#ffffff' }}
                >
                  Clear Table
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h4 className="text-sm font-black uppercase text-zinc-300">Live TID List</h4>
                <span className="text-sm font-black text-white">{tids.length} tag(s)</span>
              </div>

              <div className="max-h-72 overflow-auto rounded-xl border border-zinc-800 bg-zinc-950">
                {tids.length === 0 ? (
                  <div className="p-6 text-center text-sm font-bold text-zinc-500">
                    Start the table scan to populate TIDs here.
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-900">
                    {tids.map((tid, index) => (
                      <div key={tid} className="grid grid-cols-[56px_1fr] gap-3 px-3 py-2 font-mono text-sm">
                        <span className="text-zinc-500">{index + 1}</span>
                        <span className="truncate text-white">{tid}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <details
              className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
              open={manualFallbackOpen}
              onToggle={(event) => setManualFallbackOpen(event.currentTarget.open)}
            >
              <summary className="cursor-pointer text-sm font-black text-zinc-300">
                Manual fallback for testing
              </summary>
              <textarea
                value={manualTidText}
                onChange={(event) => setManualTidText(event.target.value)}
                rows={6}
                placeholder="Testing only: one TID per line"
                className="mt-3 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 font-mono text-sm text-white"
              />
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={applyManualTids}
                  className="rounded-xl bg-zinc-800 px-4 py-2 text-xs font-black text-white hover:bg-zinc-700"
                >
                  Load Manual TIDs
                </button>
                <button
                  type="button"
                  onClick={fillDemoTids}
                  className="rounded-xl bg-zinc-800 px-4 py-2 text-xs font-black text-white hover:bg-zinc-700"
                >
                  Demo TIDs
                </button>
              </div>
            </details>
              </>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={generateWorkingBatch}
                disabled={loading || !activeBatch || (rfidReceivingEnabled ? !countMatches : targetQuantity <= 0)}
                className="rounded-xl bg-green-600 px-5 py-3 text-sm font-black text-white hover:bg-green-500 disabled:opacity-40"
              >
                {loading ? 'Generating...' : 'Generate Working Batch'}
              </button>

              {rfidReceivingEnabled && (
                <button
                  type="button"
                  onClick={() => setTids([])}
                  className="rounded-xl px-5 py-3 text-sm font-black"
                  style={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', color: '#ffffff' }}
                >
                  Clear List
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {createdItems.length > 0 && (
        <section className="rounded-2xl border border-green-800 bg-green-950/30 p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-black text-green-200">Created Working Items</h3>
            <Link href="/processing" className="rounded-lg bg-white px-4 py-2 text-sm font-black text-black">
              Open Working
            </Link>
          </div>

          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {createdItems.slice(0, 24).map((item) => (
              <Link
                key={item.id}
                href={`/items/${item.id}`}
                className="rounded-lg border border-green-900 bg-zinc-950 p-3 text-sm font-bold text-white hover:border-green-500"
              >
                <span className="block">{item.sku}</span>
                {item.rfid_tid && (
                  <span className="mt-1 block truncate font-mono text-xs text-green-300">{item.rfid_tid}</span>
                )}
              </Link>
            ))}
          </div>

          {createdItems.length > 24 && (
            <p className="mt-3 text-xs font-bold text-green-200">
              Showing first 24 of {createdItems.length}. The full batch is in Working.
            </p>
          )}
        </section>
      )}
    </div>
  )
}

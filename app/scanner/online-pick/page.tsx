'use client'

import { useEffect, useRef, useState } from 'react'
import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { useStaff } from '@/app/context/StaffContext'

const shopLocations = ['SHOP-1', 'SHOP-2', 'SHOP-3']
const sourceBins = ['STOCK', 'FLOOR']

function clean(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

export default function OnlinePickScannerPage() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { staff } = useStaff()

  const [fromLocation, setFromLocation] = useState('SHOP-1')
  const [sourceBin, setSourceBin] = useState('STOCK')
  const [sku, setSku] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastPicked, setLastPicked] = useState<any | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function markPicked(rawSku?: string) {
    const cleanSku = clean(rawSku || sku).toUpperCase()

    if (!cleanSku) return

    if (!staff) {
      setMessage('Select active staff first.')
      return
    }

    setBusy(true)
    setMessage(`Marking ${cleanSku} as picked...`)

    try {
      const response = await fetch('/api/transfers/mark-picked', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sku: cleanSku,
          from_location: fromLocation,
          source_bin: sourceBin,
          picked_by: staff.name,
          picked_by_id: staff.id,
        }),
      })

      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not mark item as picked.')
      }

      setLastPicked(data)
      setMessage(data.message || `${cleanSku} picked.`)
      setSku('')
    } catch (error: any) {
      setMessage(error.message || 'Could not mark item as picked.')
    } finally {
      setBusy(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  return (
    <StaffPermissionGate permission="scanner">
      <main className="min-h-screen bg-neutral-950 p-5 text-white">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <div>
            <h1 className="text-2xl font-black">Online Order Pick Scanner</h1>
            <p className="text-sm text-neutral-400">
              Scan source shelf/bin, then scan item SKU to mark online-transfer item picked.
            </p>
            <p className="mt-1 text-sm font-bold text-green-300">
              {staff ? `Active staff: ${staff.name}` : 'No active staff selected'}
            </p>
          </div>

          <AppNav current="transfers" />
        </div>

        <section className="mb-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label>
              <span className="mb-1 block text-xs font-black uppercase text-neutral-500">
                Shop Location
              </span>
              <select
                value={fromLocation}
                onChange={(event) => setFromLocation(event.target.value)}
                className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-4 text-xl font-black outline-none"
              >
                {shopLocations.map((location) => (
                  <option key={location} value={location}>
                    {location}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="mb-1 block text-xs font-black uppercase text-neutral-500">
                Source Bin
              </span>
              <select
                value={sourceBin}
                onChange={(event) => setSourceBin(event.target.value)}
                className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-4 text-xl font-black outline-none"
              >
                {sourceBins.map((bin) => (
                  <option key={bin} value={bin}>
                    {bin}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="mb-1 block text-xs font-black uppercase text-neutral-500">
                Scan SKU
              </span>
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  markPicked()
                }}
              >
                <input
                  ref={inputRef}
                  value={sku}
                  onChange={(event) => setSku(event.target.value)}
                  placeholder="Scan / enter SKU"
                  autoComplete="off"
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-4 text-xl font-black uppercase outline-none"
                />
              </form>
            </label>
          </div>

          <button
            type="button"
            disabled={busy || !sku.trim()}
            onClick={() => markPicked()}
            className="mt-4 w-full rounded-xl bg-green-600 px-5 py-4 text-lg font-black text-white hover:bg-green-500 disabled:bg-neutral-700 disabled:text-neutral-400"
          >
            {busy ? 'Marking picked...' : 'Mark Picked'}
          </button>
        </section>

        {message && (
          <section className="mb-5 rounded-2xl border border-yellow-800 bg-yellow-950 p-4 text-sm font-bold text-yellow-200">
            {message}
          </section>
        )}

        {lastPicked && (
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            <h2 className="mb-2 text-lg font-black">Last Picked</h2>
            <pre className="overflow-auto rounded-xl bg-neutral-950 p-4 text-xs text-neutral-300">
              {JSON.stringify(lastPicked, null, 2)}
            </pre>
          </section>
        )}
      </main>
    </StaffPermissionGate>
  )
}

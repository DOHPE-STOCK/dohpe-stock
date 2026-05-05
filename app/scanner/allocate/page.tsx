'use client'

import { useEffect, useRef, useState } from 'react'
import AppNav from '@/app/components/AppNav'
import StaffPinGate from '@/app/components/StaffPinGate'
import { supabase } from '@/lib/supabase'

type ScanMode = 'bin' | 'items'

type StaffUser = {
  id: string
  name: string
}

type WarehouseBin = {
  id: string
  bin_code: string
  label: string | null
  is_active: boolean
}

type PendingItem = {
  id: string
  sku: string
  current_location: string | null
  current_bin: string | null
  location_status: string | null
}

export default function AllocatePage() {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [scanValue, setScanValue] = useState('')
  const [mode, setMode] = useState<ScanMode>('bin')
  const [activeBin, setActiveBin] = useState<WarehouseBin | null>(null)
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([])
  const [activeStaff, setActiveStaff] = useState<StaffUser | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    focusInput()
  }, [])

  function focusInput() {
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function cleanScan(value: string) {
    return value.trim().replace(/\s+/g, '').toUpperCase()
  }

  function isValidSku(value: string) {
    return /^\d{10}$/.test(value)
  }

  async function handleScan() {
    const value = cleanScan(scanValue)

    if (!value || busy) return

    if (!activeStaff) {
      setMessage('Select staff member first.')
      return
    }

    setScanValue('')
    setMessage('')

    if (mode === 'bin') {
      await scanBin(value)
      focusInput()
      return
    }

    await scanItem(value)
    focusInput()
  }

  async function scanBin(binCode: string) {
    setBusy(true)

    const { data, error } = await supabase
      .from('warehouse_bins')
      .select('id, bin_code, label, is_active')
      .eq('bin_code', binCode)
      .maybeSingle()

    setBusy(false)

    if (error) {
      setMessage(error.message)
      return
    }

    if (!data) {
      setMessage(`Bin not found: ${binCode}`)
      return
    }

    if (!data.is_active) {
      setMessage(`Bin inactive: ${binCode}`)
      return
    }

    setActiveBin(data as WarehouseBin)
    setMode('items')
    setPendingItems([])
    setMessage(`Bin selected: ${data.bin_code}`)
  }

  async function scanItem(sku: string) {
    if (!activeBin) {
      setMode('bin')
      setMessage('Scan a bin first.')
      return
    }

    if (!isValidSku(sku)) {
      setMessage(`Invalid SKU: ${sku}`)
      return
    }

    if (pendingItems.some((item) => item.sku === sku)) {
      setMessage(`Already scanned: ${sku}`)
      return
    }

    setBusy(true)

    const { data, error } = await supabase
      .from('items')
      .select('id, sku, current_location, current_bin, location_status')
      .eq('sku', sku)
      .maybeSingle()

    setBusy(false)

    if (error) {
      setMessage(error.message)
      return
    }

    if (!data) {
      setMessage(`Item not found: ${sku}`)
      return
    }

    setPendingItems((prev) => [data as PendingItem, ...prev])
    setMessage(`Added ${sku}`)
  }

  function removeItem(sku: string) {
    setPendingItems((prev) => prev.filter((item) => item.sku !== sku))
    focusInput()
  }

  function resetBin() {
    setActiveBin(null)
    setMode('bin')
    setPendingItems([])
    setMessage('Scan bin.')
    focusInput()
  }

  async function allocateItems() {
    if (!activeStaff) {
      setMessage('Select staff member first.')
      return
    }

    if (!activeBin) {
      setMessage('Scan a bin first.')
      return
    }

    if (pendingItems.length === 0) {
      setMessage('Scan at least one item.')
      return
    }

    const confirmed = window.confirm(
      `Allocate ${pendingItems.length} item(s) to ${activeBin.bin_code} by ${activeStaff.name}?\n\nThis will move already allocated items to this new bin.`
    )

    if (!confirmed) return

    setBusy(true)
    setMessage('Allocating...')

    const now = new Date().toISOString()
    const itemIds = pendingItems.map((item) => item.id)

    const { error: updateError } = await supabase
      .from('items')
      .update({
        current_location: 'WAREHOUSE',
        current_bin: activeBin.bin_code,
        location_status: 'stored',
        allocated_at: now,
        allocated_by: activeStaff.id,
        linnworks_location_sync_status: 'pending',
        updated_at: now,
      })
      .in('id', itemIds)

    if (updateError) {
      setBusy(false)
      setMessage(updateError.message)
      return
    }

    const { error: movementError } = await supabase
      .from('item_location_movements')
      .insert(
        pendingItems.map((item) => ({
          item_id: item.id,
          sku: item.sku,
          from_location: item.current_location,
          from_bin: item.current_bin,
          to_location: 'WAREHOUSE',
          to_bin: activeBin.bin_code,
          movement_type: 'allocate',
          moved_by: activeStaff.id,
        }))
      )

    if (movementError) {
      setBusy(false)
      setMessage(movementError.message)
      return
    }

    const { error: queueError } = await supabase
      .from('linnworks_sync_queue')
      .insert(
        pendingItems.map((item) => ({
          item_id: item.id,
          sku: item.sku,
          action: 'update_location',
          payload: {
            sku: item.sku,
            location: 'WAREHOUSE',
            bin: activeBin.bin_code,
            movement_type: 'allocate',
            allocated_at: now,
            allocated_by: activeStaff.name,
          },
          status: 'pending',
        }))
      )

    if (queueError) {
      setBusy(false)
      setMessage(queueError.message)
      return
    }

    setBusy(false)
    setMessage(
      `Allocated ${pendingItems.length} item(s) to ${activeBin.bin_code} by ${activeStaff.name}`
    )
    setPendingItems([])
    focusInput()
  }

  return (
    <main
      className="min-h-screen bg-neutral-950 p-3 text-white select-none sm:p-5"
      onClick={focusInput}
    >
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold sm:text-3xl">Allocate</h1>
              <p className="text-sm text-neutral-400">
                Scan bin first, then scan item SKUs.
              </p>

              {activeStaff && (
                <p className="mt-2 text-sm font-bold text-green-300">
                  Active staff: {activeStaff.name}
                </p>
              )}
            </div>

            <AppNav current="allocate" />
          </div>
        </header>

        <StaffPinGate onStaffSelected={setActiveStaff} />

        <section
          className={`rounded-2xl border p-4 ${
            mode === 'bin'
              ? 'border-yellow-700 bg-yellow-950/30'
              : 'border-green-700 bg-green-950/30'
          }`}
        >
          <p className="text-xs font-bold uppercase tracking-wide text-neutral-400">
            Current step
          </p>

          <h2 className="mt-1 text-3xl font-black">
            {mode === 'bin' ? 'SCAN BIN' : 'SCAN ITEMS'}
          </h2>

          <div className="mt-4 rounded-xl bg-neutral-950 p-4">
            <p className="text-sm text-neutral-400">Active bin</p>

            <p className="mt-1 break-all font-mono text-4xl font-black">
              {activeBin?.bin_code || 'NONE'}
            </p>

            {activeBin?.label && (
              <p className="mt-1 text-sm text-neutral-400">{activeBin.label}</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <input
            ref={inputRef}
            value={scanValue}
            onChange={(e) => setScanValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleScan()
            }}
            placeholder={
              !activeStaff
                ? 'Select staff member first'
                : mode === 'bin'
                  ? 'Scan bin barcode'
                  : 'Scan item SKU'
            }
            disabled={busy || !activeStaff}
            inputMode="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-5 font-mono text-2xl font-bold outline-none focus:border-white disabled:opacity-50"
            autoFocus
          />

          <button
            onClick={handleScan}
            disabled={busy || !scanValue.trim() || !activeStaff}
            className="mt-3 w-full rounded-xl bg-white px-5 py-5 text-xl font-black text-black disabled:opacity-50"
          >
            {busy ? 'PROCESSING...' : mode === 'bin' ? 'SET BIN' : 'ADD ITEM'}
          </button>
        </section>

        {message && (
          <section className="rounded-2xl border border-neutral-700 bg-neutral-900 p-4">
            <p className="text-xl font-bold">{message}</p>
          </section>
        )}

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-black">Items to Allocate</h2>
              <p className="text-sm text-neutral-400">
                {pendingItems.length} item(s) scanned
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex">
              <button
                onClick={resetBin}
                className="rounded-xl border border-neutral-700 px-4 py-4 text-sm font-black"
              >
                CHANGE BIN
              </button>

              <button
                onClick={allocateItems}
                disabled={
                  busy || !activeStaff || !activeBin || pendingItems.length === 0
                }
                className="rounded-xl bg-green-600 px-4 py-4 text-sm font-black text-white hover:bg-green-500 disabled:opacity-40"
              >
                ALLOCATE
              </button>
            </div>
          </div>

          {pendingItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-800 p-8 text-center text-neutral-500">
              No items scanned yet.
            </div>
          ) : (
            <div className="space-y-2">
              {pendingItems.map((item) => {
                const alreadyInBin =
                  item.current_location === 'WAREHOUSE' &&
                  item.current_bin === activeBin?.bin_code

                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-950 p-4"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-xl font-black">{item.sku}</p>

                      <p className="truncate text-sm text-neutral-400">
                        Current: {item.current_location || 'None'}
                        {item.current_bin ? ` / ${item.current_bin}` : ''}
                      </p>

                      {alreadyInBin && (
                        <p className="mt-1 text-sm font-bold text-yellow-300">
                          Already in this bin
                        </p>
                      )}
                    </div>

                    <button
                      onClick={() => removeItem(item.sku)}
                      className="rounded-lg border border-red-800 px-3 py-3 text-sm font-black text-red-300"
                    >
                      REMOVE
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
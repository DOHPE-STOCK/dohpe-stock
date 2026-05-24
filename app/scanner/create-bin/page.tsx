'use client'

import { useEffect, useMemo, useState } from 'react'
import AppNav from '@/app/components/AppNav'
import { supabase } from '@/lib/supabase'

type GeneratorMode = 'word' | 'range'

type LocationOption = {
  name: string
  label: string
}

type ZoneConfig = {
  from: string
  to: string
}

const MAX_LABELS = 500

const FALLBACK_LOCATIONS: LocationOption[] = [
  { name: 'WAREHOUSE', label: 'WAREHOUSE' },
  { name: 'SHOP-1', label: 'SHOP-1' },
  { name: 'SHOP-2', label: 'SHOP-2' },
  { name: 'SHOP-3', label: 'SHOP-3' },
]

function cleanLocation(value: string) {
  return value.trim().toUpperCase()
}

function cleanBinInput(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
}

function cleanZoneInput(value: string, width: number) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, width)
}

function getAllocateUrl(location: string, bin: string) {
  const params = new URLSearchParams()
  params.set('location', cleanLocation(location))
  params.set('bin', cleanBinInput(bin))

  return `${window.location.origin}/scanner/allocate?${params.toString()}`
}

function isNumberPart(value: string) {
  return /^\d+$/.test(value)
}

function isLettersPart(value: string) {
  return /^[A-Z]+$/.test(value)
}

function lettersToNumber(value: string) {
  let total = 0

  for (const char of value) {
    total = total * 26 + (char.charCodeAt(0) - 64)
  }

  return total
}

function numberToLetters(value: number, width: number) {
  let n = value
  let result = ''

  while (n > 0) {
    const remainder = (n - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    n = Math.floor((n - 1) / 26)
  }

  return result.padStart(width, 'A')
}

function expandZoneRange(fromRaw: string, toRaw: string, width: number) {
  const from = cleanZoneInput(fromRaw, width)
  const to = cleanZoneInput(toRaw || fromRaw, width)

  if (!from && !to) {
    throw new Error('Every active zone needs a From value.')
  }

  if (from && !to) return [from]
  if (!from && to) return [to]
  if (from === to) return [from]

  if (isNumberPart(from) && isNumberPart(to)) {
    const start = Number(from)
    const end = Number(to)

    if (start > end) {
      throw new Error(`Invalid number range: ${from} to ${to}`)
    }

    return Array.from({ length: end - start + 1 }, (_, index) =>
      String(start + index).padStart(Math.max(from.length, to.length), '0')
    )
  }

  if (isLettersPart(from) && isLettersPart(to) && from.length === to.length) {
    const start = lettersToNumber(from)
    const end = lettersToNumber(to)

    if (start > end) {
      throw new Error(`Invalid letter range: ${from} to ${to}`)
    }

    return Array.from({ length: end - start + 1 }, (_, index) =>
      numberToLetters(start + index, from.length)
    )
  }

  throw new Error(
    `Unsupported range: ${from} to ${to}. Use matching text, number ranges like 001 to 010, or letter ranges like AA to AC.`
  )
}

function buildCombinations(groups: string[][]) {
  const results: string[] = []

  function walk(index: number, parts: string[]) {
    if (results.length > MAX_LABELS) return

    if (index >= groups.length) {
      results.push(parts.join('-'))
      return
    }

    for (const value of groups[index]) {
      walk(index + 1, [...parts, value])
    }
  }

  walk(0, [])

  return Array.from(new Set(results))
}

function generateRangeBins(zones: ZoneConfig[], zoneCount: number, zoneWidth: number) {
  const activeZones = zones.slice(0, zoneCount)

  const groups = activeZones.map((zone, index) => {
    if (!zone.from.trim()) {
      throw new Error(`Zone ${index + 1} needs a From value.`)
    }

    return expandZoneRange(zone.from, zone.to || zone.from, zoneWidth)
  })

  const total = groups.reduce((sum, group) => sum * Math.max(1, group.length), 1)

  if (total > MAX_LABELS) {
    throw new Error(`This would generate ${total} labels. Maximum is ${MAX_LABELS} at a time.`)
  }

  return buildCombinations(groups)
}

function openBinLabelPreview(location: string, bins: string[]) {
  const clean = cleanLocation(location)

  const labels = bins.map((bin) => ({
    labelType: 'bin-qr',
    type: 'bin-qr',
    location: clean,
    code: bin,
    binCode: bin,
    qrValue: getAllocateUrl(clean, bin),
  }))

  window.localStorage.setItem('label_preview_items', JSON.stringify(labels))
  window.open('/labels/preview', '_blank')
}

async function loadLocationOptions() {
  try {
    const { data, error } = await supabase
      .from('locations')
      .select('name, label, is_active')
      .eq('is_active', true)
      .order('name', { ascending: true })

    if (error || !data || data.length === 0) return FALLBACK_LOCATIONS

    const rows = data
      .map((row: any) => ({
        name: cleanLocation(row.name || row.label),
        label: row.label || row.name,
      }))
      .filter((row) => row.name)

    return rows.length > 0 ? rows : FALLBACK_LOCATIONS
  } catch {
    return FALLBACK_LOCATIONS
  }
}

export default function CreateBinPage() {
  const [locations, setLocations] = useState<LocationOption[]>(FALLBACK_LOCATIONS)
  const [location, setLocation] = useState('WAREHOUSE')
  const [customLocation, setCustomLocation] = useState('')

  const [mode, setMode] = useState<GeneratorMode>('word')
  const [wordBin, setWordBin] = useState('STOCK')

  const [zoneCount, setZoneCount] = useState(3)
  const [zoneWidth, setZoneWidth] = useState(2)
  const [zones, setZones] = useState<ZoneConfig[]>([
    { from: 'AA', to: 'AA' },
    { from: '00', to: '00' },
    { from: '00', to: '10' },
    { from: '', to: '' },
  ])

  const [lastGenerated, setLastGenerated] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const activeLocation = location === '__CUSTOM__' ? cleanLocation(customLocation) : location

  useEffect(() => {
    loadLocationOptions().then((rows) => {
      setLocations(rows)

      if (rows.length > 0 && !rows.some((row) => row.name === location)) {
        setLocation(rows[0].name)
      }
    })
  }, [])

  useEffect(() => {
    setZones((prev) =>
      prev.map((zone) => ({
        from: cleanZoneInput(zone.from, zoneWidth),
        to: cleanZoneInput(zone.to, zoneWidth),
      }))
    )
  }, [zoneWidth])

  const previewBins = useMemo(() => {
    try {
      if (mode === 'word') {
        const clean = cleanBinInput(wordBin)
        return clean ? [clean] : []
      }

      return generateRangeBins(zones, zoneCount, zoneWidth)
    } catch {
      return []
    }
  }, [mode, wordBin, zones, zoneCount, zoneWidth])

  const previewText = useMemo(() => {
    if (lastGenerated.length === 0) return ''
    return lastGenerated.slice(0, 20).join(', ')
  }, [lastGenerated])

  function updateZone(index: number, field: 'from' | 'to', value: string) {
    setZones((prev) =>
      prev.map((zone, zoneIndex) =>
        zoneIndex === index
          ? {
              ...zone,
              [field]: cleanZoneInput(value, zoneWidth),
            }
          : zone
      )
    )
  }

  function setPreset(preset: 'warehouse' | 'shop' | 'four-zone') {
    if (preset === 'warehouse') {
      setMode('range')
      setZoneCount(3)
      setZoneWidth(2)
      setZones([
        { from: 'AA', to: 'AA' },
        { from: '00', to: '00' },
        { from: '00', to: '10' },
        { from: '', to: '' },
      ])
      setMessage('Preset loaded: AA-00-00 to AA-00-10')
      return
    }

    if (preset === 'shop') {
      setMode('word')
      setWordBin('STOCK')
      setMessage('Preset loaded: STOCK')
      return
    }

    setMode('range')
    setZoneCount(4)
    setZoneWidth(3)
    setZones([
      { from: 'AAA', to: 'AAA' },
      { from: '000', to: '000' },
      { from: '000', to: '000' },
      { from: '000', to: '010' },
    ])
    setMessage('Preset loaded: AAA-000-000-000 to AAA-000-000-010')
  }

  function generateBins() {
    setMessage('')

    try {
      const bins =
        mode === 'word'
          ? [cleanBinInput(wordBin)].filter(Boolean)
          : generateRangeBins(zones, zoneCount, zoneWidth)

      if (bins.length === 0) {
        setMessage('No labels generated.')
        return []
      }

      setLastGenerated(bins)
      return bins
    } catch (error: any) {
      setMessage(error.message || 'Could not generate labels.')
      return []
    }
  }

  async function saveMissingBins(bins: string[]) {
    const locationName = activeLocation

    if (!locationName) {
      throw new Error('Choose or enter a location first.')
    }

    const { data, error } = await supabase
      .from('warehouse_bins')
      .select('bin_code, location_name')
      .eq('location_name', locationName)
      .in('bin_code', bins)

    if (error) {
      throw new Error(error.message)
    }

    const existing = (data || []).map((row) => row.bin_code)
    const existingSet = new Set(existing)
    const missingBins = bins.filter((bin) => !existingSet.has(bin))

    if (missingBins.length > 0) {
      const rows = missingBins.map((bin) => ({
        bin_code: bin,
        label: bin,
        location_name: locationName,
        is_active: true,
      }))

      const { error: upsertError } = await supabase
        .from('warehouse_bins')
        .upsert(rows, {
          onConflict: 'bin_code,location_name',
          ignoreDuplicates: true,
        })

      if (upsertError) {
        throw new Error(upsertError.message)
      }
    }

    return {
      existingCount: existing.length,
      missingCount: missingBins.length,
    }
  }

  async function previewAndPrint() {
    const bins = generateBins()

    if (bins.length === 0) return

    if (!activeLocation) {
      setMessage('Choose or enter a location first.')
      return
    }

    const confirmed = window.confirm(
      `Preview/print ${bins.length} QR bin label(s)?\n\nLocation: ${activeLocation}\nMaximum is ${MAX_LABELS} labels at a time.\n\nMissing bins will be saved first. Existing bins will be reprinted.`
    )

    if (!confirmed) return

    setBusy(true)
    setMessage('Checking bins...')

    try {
      const result = await saveMissingBins(bins)

      setMessage(
        `Opened preview for ${bins.length} QR label(s). ${result.missingCount} new, ${result.existingCount} existing.`
      )

      openBinLabelPreview(activeLocation, bins)
    } catch (error: any) {
      setMessage(error.message || 'Could not save bins.')
    } finally {
      setBusy(false)
    }
  }

  async function createAndPrintTestBin() {
    const bins = ['TEST-0-0']

    if (!activeLocation) {
      setMessage('Choose or enter a location first.')
      return
    }

    setBusy(true)
    setMessage('Creating test bin...')

    try {
      await saveMissingBins(bins)
      setLastGenerated(bins)
      setMessage(`Opened preview for test bin: ${activeLocation} / TEST-0-0`)
      openBinLabelPreview(activeLocation, bins)
    } catch (error: any) {
      setMessage(error.message || 'Could not create test bin.')
    } finally {
      setBusy(false)
    }
  }

  function openTestAllocatePage() {
    window.open(getAllocateUrl(activeLocation || 'WAREHOUSE', 'TEST-0-0'), '_blank')
  }

  return (
    <main className="min-h-screen bg-neutral-950 p-3 text-white select-none sm:p-5">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold sm:text-3xl">
                Create Bin QR Labels
              </h1>

              <p className="text-sm text-neutral-400">
                Select a location, then create one exact word/bin label or a structured range with up to 4 zones.
              </p>
            </div>

            <AppNav />
          </div>
        </header>

        <section className="rounded-2xl border border-orange-800 bg-orange-950/30 p-4">
          <h2 className="mb-3 text-xl font-black">Test Bin</h2>

          <p className="mb-4 text-sm text-orange-200">
            Creates/reprints TEST-0-0 for the selected location so you can test QR printing and Allocate auto-selection.
          </p>

          <div className="grid gap-2 sm:flex">
            <button
              onClick={createAndPrintTestBin}
              disabled={busy || !activeLocation}
              className="rounded-xl bg-orange-500 px-5 py-4 text-sm font-black text-black disabled:opacity-50"
            >
              CREATE / PRINT TEST BIN
            </button>

            <button
              onClick={openTestAllocatePage}
              disabled={!activeLocation}
              className="rounded-xl border border-orange-700 px-5 py-4 text-sm font-black text-orange-200 disabled:opacity-50"
            >
              OPEN TEST ALLOCATE PAGE
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-4 text-2xl font-black">Location</h2>

          <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
            <label>
              <span className="mb-1 block text-xs font-bold uppercase text-neutral-500">
                Select location
              </span>

              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-4 text-lg font-black outline-none focus:border-white"
              >
                {locations.map((row) => (
                  <option key={row.name} value={row.name}>
                    {row.label || row.name}
                  </option>
                ))}
                <option value="__CUSTOM__">CUSTOM LOCATION</option>
              </select>
            </label>

            {location === '__CUSTOM__' && (
              <label>
                <span className="mb-1 block text-xs font-bold uppercase text-neutral-500">
                  Custom location
                </span>

                <input
                  value={customLocation}
                  onChange={(e) => setCustomLocation(cleanLocation(e.target.value))}
                  placeholder="WAREHOUSE / SHOP-1 / etc"
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-4 text-lg font-black uppercase outline-none focus:border-white"
                />
              </label>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-2xl font-black">Generator</h2>

              <p className="text-sm text-neutral-400">
                Word mode prints exactly what you type. Range mode creates zones like XX-XX-XX or XXX-XXX-XXX-XXX. Values are never shortened.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:flex">
              <button
                type="button"
                onClick={() => setPreset('warehouse')}
                className="rounded-xl border border-neutral-700 px-4 py-3 text-xs font-black"
              >
                WAREHOUSE RANGE
              </button>

              <button
                type="button"
                onClick={() => setPreset('shop')}
                className="rounded-xl border border-neutral-700 px-4 py-3 text-xs font-black"
              >
                STOCK WORD
              </button>

              <button
                type="button"
                onClick={() => setPreset('four-zone')}
                className="rounded-xl border border-neutral-700 px-4 py-3 text-xs font-black"
              >
                4 ZONE RANGE
              </button>
            </div>
          </div>

          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <label>
              <span className="mb-1 block text-xs font-bold uppercase text-neutral-500">
                Mode
              </span>

              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as GeneratorMode)}
                className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-4 text-lg font-black outline-none focus:border-white"
              >
                <option value="word">WORD / SINGLE LABEL</option>
                <option value="range">RANGE</option>
              </select>
            </label>

            {mode === 'range' && (
              <>
                <label>
                  <span className="mb-1 block text-xs font-bold uppercase text-neutral-500">
                    Zones
                  </span>

                  <select
                    value={zoneCount}
                    onChange={(e) => setZoneCount(Number(e.target.value))}
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-4 text-lg font-black outline-none focus:border-white"
                  >
                    {[1, 2, 3, 4].map((num) => (
                      <option key={num} value={num}>
                        {num} zone{num === 1 ? '' : 's'}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="mb-1 block text-xs font-bold uppercase text-neutral-500">
                    Zone field length
                  </span>

                  <select
                    value={zoneWidth}
                    onChange={(e) => setZoneWidth(Number(e.target.value))}
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-4 text-lg font-black outline-none focus:border-white"
                  >
                    {[1, 2, 3, 4].map((num) => (
                      <option key={num} value={num}>
                        {num} character{num === 1 ? '' : 's'}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>

          {mode === 'word' ? (
            <label>
              <span className="mb-1 block text-xs font-bold uppercase text-neutral-500">
                Exact bin / word
              </span>

              <input
                value={wordBin}
                onChange={(e) => setWordBin(cleanBinInput(e.target.value))}
                placeholder="STOCK / FLOOR / HOLD / AA-00-00"
                className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-5 font-mono text-2xl font-black uppercase outline-none focus:border-white"
              />
            </label>
          ) : (
            <div className="grid gap-4">
              {zones.slice(0, zoneCount).map((zone, index) => (
                <div
                  key={index}
                  className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4"
                >
                  <p className="mb-3 text-sm font-black uppercase tracking-wide text-neutral-400">
                    Zone {index + 1}
                  </p>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label>
                      <span className="mb-1 block text-xs font-bold uppercase text-neutral-500">
                        From
                      </span>

                      <input
                        value={zone.from}
                        maxLength={zoneWidth}
                        onChange={(e) => updateZone(index, 'from', e.target.value)}
                        className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-4 text-center font-mono text-2xl font-black uppercase outline-none focus:border-white"
                      />
                    </label>

                    <label>
                      <span className="mb-1 block text-xs font-bold uppercase text-neutral-500">
                        To
                      </span>

                      <input
                        value={zone.to}
                        maxLength={zoneWidth}
                        onChange={(e) => updateZone(index, 'to', e.target.value)}
                        className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-4 text-center font-mono text-2xl font-black uppercase outline-none focus:border-white"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <p className="text-sm text-neutral-400">Preview</p>

            <p className="mt-1 break-words font-mono text-2xl font-black">
              Printed label: {previewBins[0] || 'NO BIN'}
            </p>

            <p className="mt-2 text-sm text-neutral-500">
              QR location: {activeLocation || 'NO LOCATION'} · Estimated labels: {previewBins.length || '—'} · Maximum allowed: {MAX_LABELS}
            </p>
          </div>

          <button
            onClick={previewAndPrint}
            disabled={busy || !activeLocation}
            className="mt-4 w-full rounded-xl bg-white px-5 py-5 text-xl font-black text-black disabled:opacity-50"
          >
            {busy ? 'PROCESSING...' : 'PREVIEW / PRINT QR LABELS'}
          </button>
        </section>

        {message && (
          <section className="rounded-2xl border border-yellow-800 bg-yellow-950 p-4">
            <p className="text-lg font-bold text-yellow-300">{message}</p>
          </section>
        )}

        {lastGenerated.length > 0 && (
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            <h2 className="mb-4 text-2xl font-black">Last Range</h2>

            <div className="rounded-2xl bg-neutral-950 p-4">
              <p className="text-sm text-neutral-400">Total labels</p>
              <p className="text-4xl font-black">{lastGenerated.length}</p>
            </div>

            <p className="mt-4 break-words text-sm text-neutral-400">
              Preview: {previewText}
              {lastGenerated.length > 20 ? '...' : ''}
            </p>
          </section>
        )}
      </div>
    </main>
  )
}

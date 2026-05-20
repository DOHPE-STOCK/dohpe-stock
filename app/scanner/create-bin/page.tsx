'use client'

import { useMemo, useState } from 'react'
import AppNav from '@/app/components/AppNav'
import { supabase } from '@/lib/supabase'

type SectionKey = 'section1' | 'section2' | 'section3' | 'section4'

type SectionConfig = {
  key: SectionKey
  label: string
  maxLength: number
  from: string
  to: string
}

function getAllocateUrl(bin: string) {
  return `${window.location.origin}/scanner/allocate?bin=${encodeURIComponent(
    bin
  )}`
}

function cleanSection(value: string, maxLength: number) {
  const cleaned = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, maxLength)

  return cleaned || '-'
}

function displaySection(value: string) {
  const cleaned = value.trim().toUpperCase()

  if (!cleaned || /^-+$/.test(cleaned)) return ''

  return cleaned.replace(/-+$/g, '')
}

function buildBinCode(parts: string[]) {
  const displayParts = parts.map(displaySection)
  const lastUsedIndex = displayParts.reduce((last, part, index) => {
    return part ? index : last
  }, -1)

  if (lastUsedIndex === -1) return ''

  return displayParts.slice(0, lastUsedIndex + 1).map((part) => part || '-').join('-')
}

function isWholeNumber(value: string) {
  return /^\d+$/.test(displaySection(value))
}

function isSingleLetter(value: string) {
  return /^[A-Z]$/.test(displaySection(value))
}

function padLike(value: number, example: string) {
  const visible = displaySection(example)
  const width = visible.length

  if (width <= 1) return String(value)

  return String(value).padStart(width, '0')
}

function expandSection(fromRaw: string, toRaw: string, maxLength: number) {
  const from = cleanSection(fromRaw, maxLength)
  const to = cleanSection(toRaw, maxLength)

  const fromDisplay = displaySection(from)
  const toDisplay = displaySection(to)

  if (!fromDisplay && !toDisplay) return ['']
  if (fromDisplay && !toDisplay) return [from]
  if (!fromDisplay && toDisplay) return [to]

  if (isWholeNumber(from) && isWholeNumber(to)) {
    const start = Number(fromDisplay)
    const end = Number(toDisplay)

    if (!Number.isFinite(start) || !Number.isFinite(end)) return [from]
    if (start > end) throw new Error(`Number range ${fromDisplay} to ${toDisplay} is invalid.`)
    if (end - start > 500) throw new Error('One section range is too large. Keep each section to 500 values or less.')

    return Array.from({ length: end - start + 1 }, (_, index) =>
      padLike(start + index, from)
    )
  }

  if (isSingleLetter(from) && isSingleLetter(to)) {
    const start = fromDisplay.charCodeAt(0)
    const end = toDisplay.charCodeAt(0)

    if (start > end) throw new Error(`Letter range ${fromDisplay} to ${toDisplay} is invalid.`)

    return Array.from({ length: end - start + 1 }, (_, index) =>
      String.fromCharCode(start + index)
    )
  }

  if (fromDisplay !== toDisplay) {
    throw new Error(
      `Mixed text ranges are not supported yet. Use matching values, number ranges, or single-letter ranges.`
    )
  }

  return [from]
}

function countCombinations(groups: string[][]) {
  return groups.reduce((total, group) => total * Math.max(1, group.length), 1)
}

function openBinLabelPreview(bins: string[]) {
  const labels = bins.map((bin) => ({
    type: 'bin-qr',
    code: bin,
    qrValue: getAllocateUrl(bin),
  }))

  window.localStorage.setItem('label_preview_items', JSON.stringify(labels))
  window.open('/labels/preview', '_blank')
}

export default function CreateBinPage() {
  const [section1From, setSection1From] = useState('---')
  const [section1To, setSection1To] = useState('---')
  const [section2From, setSection2From] = useState('---')
  const [section2To, setSection2To] = useState('---')
  const [section3From, setSection3From] = useState('---')
  const [section3To, setSection3To] = useState('---')
  const [section4From, setSection4From] = useState('----')
  const [section4To, setSection4To] = useState('----')

  const [lastGenerated, setLastGenerated] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const sections: SectionConfig[] = [
    {
      key: 'section1',
      label: 'Section 1',
      maxLength: 3,
      from: section1From,
      to: section1To,
    },
    {
      key: 'section2',
      label: 'Section 2',
      maxLength: 3,
      from: section2From,
      to: section2To,
    },
    {
      key: 'section3',
      label: 'Section 3',
      maxLength: 3,
      from: section3From,
      to: section3To,
    },
    {
      key: 'section4',
      label: 'Section 4',
      maxLength: 4,
      from: section4From,
      to: section4To,
    },
  ]

  const previewText = useMemo(() => {
    if (lastGenerated.length === 0) return ''
    return lastGenerated.slice(0, 20).join(', ')
  }, [lastGenerated])

  const exampleBin = useMemo(() => {
    return buildBinCode([
      section1From,
      section2From,
      section3From,
      section4From,
    ])
  }, [section1From, section2From, section3From, section4From])

  function updateSection(key: SectionKey, field: 'from' | 'to', value: string) {
    const maxLength = key === 'section4' ? 4 : 3
    const cleaned = cleanSection(value, maxLength)

    if (key === 'section1' && field === 'from') setSection1From(cleaned)
    if (key === 'section1' && field === 'to') setSection1To(cleaned)
    if (key === 'section2' && field === 'from') setSection2From(cleaned)
    if (key === 'section2' && field === 'to') setSection2To(cleaned)
    if (key === 'section3' && field === 'from') setSection3From(cleaned)
    if (key === 'section3' && field === 'to') setSection3To(cleaned)
    if (key === 'section4' && field === 'from') setSection4From(cleaned)
    if (key === 'section4' && field === 'to') setSection4To(cleaned)
  }

  function setPreset(preset: 'simple' | 'rack' | 'shop' | 'blank') {
    if (preset === 'simple') {
      setSection1From('A')
      setSection1To('A')
      setSection2From('0')
      setSection2To('0')
      setSection3From('0')
      setSection3To('0')
      setSection4From('----')
      setSection4To('----')
      setMessage('Preset loaded: A-0-0')
      return
    }

    if (preset === 'rack') {
      setSection1From('A01')
      setSection1To('A01')
      setSection2From('R01')
      setSection2To('R01')
      setSection3From('S01')
      setSection3To('S01')
      setSection4From('0001')
      setSection4To('0001')
      setMessage('Preset loaded: A01-R01-S01-0001')
      return
    }

    if (preset === 'shop') {
      setSection1From('SH1')
      setSection1To('SH1')
      setSection2From('STK')
      setSection2To('STK')
      setSection3From('---')
      setSection3To('---')
      setSection4From('0001')
      setSection4To('0001')
      setMessage('Preset loaded: SH1-STK-0001')
      return
    }

    setSection1From('---')
    setSection1To('---')
    setSection2From('---')
    setSection2To('---')
    setSection3From('---')
    setSection3To('---')
    setSection4From('----')
    setSection4To('----')
    setMessage('Cleared.')
  }

  function generateBins() {
    setMessage('')

    try {
      const groups = sections.map((section) =>
        expandSection(section.from, section.to, section.maxLength)
      )

      const total = countCombinations(groups)

      if (total === 0) {
        setMessage('No bin labels to generate.')
        return []
      }

      if (total > 1000) {
        setMessage('Range is too large. Keep total labels to 1000 or less.')
        return []
      }

      const bins: string[] = []

      for (const part1 of groups[0]) {
        for (const part2 of groups[1]) {
          for (const part3 of groups[2]) {
            for (const part4 of groups[3]) {
              const bin = buildBinCode([part1, part2, part3, part4])
              if (bin) bins.push(bin)
            }
          }
        }
      }

      const uniqueBins = Array.from(new Set(bins))

      if (uniqueBins.length === 0) {
        setMessage('No usable bin code generated. Enter at least one section.')
        return []
      }

      setLastGenerated(uniqueBins)
      return uniqueBins
    } catch (error: any) {
      setMessage(error.message || 'Could not generate bins.')
      return []
    }
  }

  async function saveMissingBins(bins: string[]) {
    const { data, error } = await supabase
      .from('warehouse_bins')
      .select('bin_code')
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
        is_active: true,
      }))

      const { error: upsertError } = await supabase
        .from('warehouse_bins')
        .upsert(rows, {
          onConflict: 'bin_code',
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

  async function printSelectedRange() {
    const bins = generateBins()

    if (bins.length === 0) return

    const confirmed = window.confirm(
      `Print ${bins.length} QR bin label(s)?\n\nEach QR will open Allocate with that bin already selected. Missing bins will be saved first. Existing bins will be reprinted.`
    )

    if (!confirmed) return

    setBusy(true)
    setMessage('Checking bins...')

    try {
      const result = await saveMissingBins(bins)

      setMessage(
        `Opened preview for ${bins.length} QR label(s). ${result.missingCount} new, ${result.existingCount} existing.`
      )

      openBinLabelPreview(bins)
    } catch (error: any) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function createAndPrintTestBin() {
    const testBin = 'TEST-0-0'

    const confirmed = window.confirm(
      `Create/print test bin ${testBin}?\n\nThis QR should open Allocate with ${testBin} already selected.`
    )

    if (!confirmed) return

    setBusy(true)
    setMessage('Creating test bin...')

    try {
      await saveMissingBins([testBin])
      setLastGenerated([testBin])
      setMessage(`Opened preview for test bin: ${testBin}`)
      openBinLabelPreview([testBin])
    } catch (error: any) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  function openTestAllocatePage() {
    window.open(getAllocateUrl('TEST-0-0'), '_blank')
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
                Build flexible bin codes in up to four sections. Dashes can be used as unused placeholders; labels display the useful part only.
              </p>
            </div>

            <AppNav />
          </div>
        </header>

        <section className="rounded-2xl border border-orange-800 bg-orange-950/30 p-4">
          <h2 className="mb-3 text-xl font-black">Test Bin</h2>

          <p className="mb-4 text-sm text-orange-200">
            Creates/reprints TEST-0-0 so you can test QR printing and Allocate auto-selection.
          </p>

          <div className="grid gap-2 sm:flex">
            <button
              onClick={createAndPrintTestBin}
              disabled={busy}
              className="rounded-xl bg-orange-500 px-5 py-4 text-sm font-black text-black disabled:opacity-50"
            >
              CREATE / PRINT TEST BIN
            </button>

            <button
              onClick={openTestAllocatePage}
              className="rounded-xl border border-orange-700 px-5 py-4 text-sm font-black text-orange-200"
            >
              OPEN TEST ALLOCATE PAGE
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-2xl font-black">Bin Format</h2>

              <p className="text-sm text-neutral-400">
                Format is flexible: XXX-XXX-XXX-XXXX. Examples: A-0-0, A01-R01-S01-0001, SH1-STK-0001.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex">
              <button
                type="button"
                onClick={() => setPreset('simple')}
                className="rounded-xl border border-neutral-700 px-4 py-3 text-xs font-black"
              >
                SIMPLE
              </button>

              <button
                type="button"
                onClick={() => setPreset('rack')}
                className="rounded-xl border border-neutral-700 px-4 py-3 text-xs font-black"
              >
                RACK
              </button>

              <button
                type="button"
                onClick={() => setPreset('shop')}
                className="rounded-xl border border-neutral-700 px-4 py-3 text-xs font-black"
              >
                SHOP
              </button>

              <button
                type="button"
                onClick={() => setPreset('blank')}
                className="rounded-xl border border-neutral-700 px-4 py-3 text-xs font-black"
              >
                CLEAR
              </button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-4">
            {sections.map((section) => (
              <div
                key={section.key}
                className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4"
              >
                <p className="mb-3 text-sm font-black uppercase tracking-wide text-neutral-400">
                  {section.label}
                </p>

                <p className="mb-3 text-xs text-neutral-500">
                  Max {section.maxLength} characters. Use - for unused positions.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <label>
                    <span className="mb-1 block text-xs font-bold text-neutral-500">
                      From
                    </span>

                    <input
                      value={section.from}
                      maxLength={section.maxLength}
                      onChange={(e) =>
                        updateSection(section.key, 'from', e.target.value)
                      }
                      className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-4 text-center text-2xl font-black uppercase outline-none focus:border-white"
                    />
                  </label>

                  <label>
                    <span className="mb-1 block text-xs font-bold text-neutral-500">
                      To
                    </span>

                    <input
                      value={section.to}
                      maxLength={section.maxLength}
                      onChange={(e) =>
                        updateSection(section.key, 'to', e.target.value)
                      }
                      className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-4 text-center text-2xl font-black uppercase outline-none focus:border-white"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
            <p className="text-sm text-neutral-400">Example from current From fields</p>
            <p className="mt-1 break-words font-mono text-3xl font-black">
              {exampleBin || 'No bin code yet'}
            </p>
          </div>

          <button
            onClick={printSelectedRange}
            disabled={busy}
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

'use client'

import { useMemo, useState } from 'react'
import AppNav from '@/app/components/AppNav'
import { supabase } from '@/lib/supabase'

function numberRange(start: number, end: number) {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
}

function letterRange(start: string, end: string) {
  const startCode = start.charCodeAt(0)
  const endCode = end.charCodeAt(0)

  return Array.from(
    { length: endCode - startCode + 1 },
    (_, i) => String.fromCharCode(startCode + i)
  )
}

function getAllocateUrl(bin: string) {
  return `${window.location.origin}/scanner/allocate?bin=${encodeURIComponent(
    bin
  )}`
}

function getQrUrl(bin: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
    getAllocateUrl(bin)
  )}`
}

export default function CreateBinPage() {
  const [letterStart, setLetterStart] = useState('A')
  const [letterEnd, setLetterEnd] = useState('A')
  const [num1Start, setNum1Start] = useState(0)
  const [num1End, setNum1End] = useState(0)
  const [num2Start, setNum2Start] = useState(0)
  const [num2End, setNum2End] = useState(0)

  const [lastGenerated, setLastGenerated] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const previewText = useMemo(() => {
    if (lastGenerated.length === 0) return ''
    return lastGenerated.slice(0, 20).join(', ')
  }, [lastGenerated])

  function cleanLetter(value: string) {
    return value.trim().toUpperCase().slice(0, 1).replace(/[^A-Z]/g, '')
  }

  function setSafeNumber(value: string, setter: (value: number) => void) {
    const number = Number(value)

    if (Number.isNaN(number)) {
      setter(0)
      return
    }

    setter(Math.max(0, Math.min(15, number)))
  }

  function validateRange() {
    const ls = cleanLetter(letterStart)
    const le = cleanLetter(letterEnd)

    if (!ls || !le) {
      setMessage('Letter range must be A-Z.')
      return null
    }

    if (ls.charCodeAt(0) > le.charCodeAt(0)) {
      setMessage('Letter start must be before or equal to letter end.')
      return null
    }

    if (num1Start > num1End || num2Start > num2End) {
      setMessage('Number start must be before or equal to number end.')
      return null
    }

    return { ls, le }
  }

  function generateBins() {
    const valid = validateRange()
    if (!valid) return []

    const letters = letterRange(valid.ls, valid.le)
    const nums1 = numberRange(num1Start, num1End)
    const nums2 = numberRange(num2Start, num2End)

    const bins: string[] = []

    for (const letter of letters) {
      for (const n1 of nums1) {
        for (const n2 of nums2) {
          bins.push(`${letter}-${n1}-${n2}`)
        }
      }
    }

    setLastGenerated(bins)
    return bins
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
        `Ready to print ${bins.length} QR label(s). ${result.missingCount} new, ${result.existingCount} existing.`
      )

      printBins(bins)
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
      setMessage(`Test bin ready: ${testBin}`)
      printBins([testBin])
    } catch (error: any) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  function openTestAllocatePage() {
    window.open(getAllocateUrl('TEST-0-0'), '_blank')
  }

  function printBins(binsToPrint: string[]) {
    const payload = binsToPrint.map((bin) => ({
      labelType: 'bin-qr',
      code: bin,
      qrValue: getAllocateUrl(bin),
    }))

    window.localStorage.setItem('label_preview_items', JSON.stringify(payload))
    window.open('/labels/preview', '_blank')
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
                Select a range, save missing bins automatically, and print QR labels that open Allocate with the bin preselected.
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
          <h2 className="mb-4 text-2xl font-black">Range</h2>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <p className="mb-3 text-sm font-black uppercase tracking-wide text-neutral-400">
                Letter
              </p>

              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className="mb-1 block text-xs font-bold text-neutral-500">
                    From
                  </span>

                  <input
                    value={letterStart}
                    onChange={(e) => setLetterStart(cleanLetter(e.target.value))}
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-4 text-center text-3xl font-black uppercase outline-none focus:border-white"
                  />
                </label>

                <label>
                  <span className="mb-1 block text-xs font-bold text-neutral-500">
                    To
                  </span>

                  <input
                    value={letterEnd}
                    onChange={(e) => setLetterEnd(cleanLetter(e.target.value))}
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-4 text-center text-3xl font-black uppercase outline-none focus:border-white"
                  />
                </label>
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <p className="mb-3 text-sm font-black uppercase tracking-wide text-neutral-400">
                Number 1
              </p>

              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className="mb-1 block text-xs font-bold text-neutral-500">
                    From
                  </span>

                  <input
                    type="number"
                    min={0}
                    max={15}
                    value={num1Start}
                    onChange={(e) =>
                      setSafeNumber(e.target.value, setNum1Start)
                    }
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-4 text-center text-3xl font-black outline-none focus:border-white"
                  />
                </label>

                <label>
                  <span className="mb-1 block text-xs font-bold text-neutral-500">
                    To
                  </span>

                  <input
                    type="number"
                    min={0}
                    max={15}
                    value={num1End}
                    onChange={(e) =>
                      setSafeNumber(e.target.value, setNum1End)
                    }
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-4 text-center text-3xl font-black outline-none focus:border-white"
                  />
                </label>
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <p className="mb-3 text-sm font-black uppercase tracking-wide text-neutral-400">
                Number 2
              </p>

              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className="mb-1 block text-xs font-bold text-neutral-500">
                    From
                  </span>

                  <input
                    type="number"
                    min={0}
                    max={15}
                    value={num2Start}
                    onChange={(e) =>
                      setSafeNumber(e.target.value, setNum2Start)
                    }
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-4 text-center text-3xl font-black outline-none focus:border-white"
                  />
                </label>

                <label>
                  <span className="mb-1 block text-xs font-bold text-neutral-500">
                    To
                  </span>

                  <input
                    type="number"
                    min={0}
                    max={15}
                    value={num2End}
                    onChange={(e) =>
                      setSafeNumber(e.target.value, setNum2End)
                    }
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-4 text-center text-3xl font-black outline-none focus:border-white"
                  />
                </label>
              </div>
            </div>
          </div>

          <button
            onClick={printSelectedRange}
            disabled={busy}
            className="mt-4 w-full rounded-xl bg-white px-5 py-5 text-xl font-black text-black disabled:opacity-50"
          >
            {busy ? 'PROCESSING...' : 'PRINT QR LABELS'}
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
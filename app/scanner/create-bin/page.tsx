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

  async function printSelectedRange() {
    const bins = generateBins()

    if (bins.length === 0) return

    const confirmed = window.confirm(
      `Print ${bins.length} bin label(s)?\n\nExisting bins will be reprinted. Missing bins will be saved first. No duplicates will be created.`
    )

    if (!confirmed) return

    setBusy(true)
    setMessage('Checking bins...')

    const { data, error } = await supabase
      .from('warehouse_bins')
      .select('bin_code')
      .in('bin_code', bins)

    if (error) {
      setBusy(false)
      setMessage(error.message)
      return
    }

    const existing = (data || []).map((row) => row.bin_code)
    const existingSet = new Set(existing)
    const missingBins = bins.filter((bin) => !existingSet.has(bin))

    if (missingBins.length > 0) {
      setMessage(`Saving ${missingBins.length} missing bin(s)...`)

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
        setBusy(false)
        setMessage(upsertError.message)
        return
      }
    }

    setBusy(false)
    setMessage(
      `Ready to print ${bins.length} label(s). ${missingBins.length} new, ${existing.length} existing.`
    )

    printBins(bins)
  }

  function printBins(binsToPrint: string[]) {
    const html = `
      <html>
        <head>
          <title>Print Bin Labels</title>
          <link href="https://fonts.googleapis.com/css2?family=Libre+Barcode+128&display=swap" rel="stylesheet">
          <style>
            * {
              box-sizing: border-box;
            }

            body {
              margin: 0;
              padding: 8px;
              font-family: Arial, sans-serif;
              color: #000;
              background: #fff;
              display: flex;
              flex-wrap: wrap;
              gap: 6px;
            }

            .label {
              width: 48mm;
              height: 28mm;
              border: 1px solid #000;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              page-break-inside: avoid;
              overflow: hidden;
              padding: 2mm;
            }

            .code {
              font-size: 14px;
              font-weight: 700;
              margin-bottom: 1mm;
            }

            .barcode {
              font-family: "Libre Barcode 128", cursive;
              font-size: 42px;
              line-height: 1;
              white-space: nowrap;
            }

            @media print {
              body {
                padding: 0;
                gap: 0;
              }

              .label {
                margin: 0;
              }
            }
          </style>
        </head>

        <body>
          ${binsToPrint
            .map(
              (bin) => `
                <div class="label">
                  <div class="code">${bin}</div>
                  <div class="barcode">${bin}</div>
                </div>
              `
            )
            .join('')}
        </body>
      </html>
    `

    const win = window.open('', '_blank')
    if (!win) {
      setMessage('Print window blocked by browser.')
      return
    }

    win.document.write(html)
    win.document.close()

    setTimeout(() => {
      win.focus()
      win.print()
    }, 500)
  }

  return (
    <main className="min-h-screen bg-neutral-950 p-3 text-white select-none sm:p-5">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold sm:text-3xl">
                Create Bin Labels
              </h1>

              <p className="text-sm text-neutral-400">
                Select a range, save missing bins automatically, and print labels.
              </p>
            </div>

            <AppNav current="scanner-create-bin" />
          </div>
        </header>

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
            {busy ? 'PROCESSING...' : 'PRINT'}
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
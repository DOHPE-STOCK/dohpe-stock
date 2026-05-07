'use client'

import { useEffect, useMemo, useState } from 'react'
import Barcode from 'react-barcode'

type PrintMode = 'zebra' | 'brother'

type LabelItem = {
  sku: string
  sizeText?: string | null
  price?: number | null
}

declare global {
  interface Window {
    BrowserPrint?: any
    Zebra?: any
  }
}

function cleanZplText(value: string) {
  return value.replace(/[\^~\\]/g, '').trim()
}

function makeZplLabel(item: LabelItem) {
  const sku = cleanZplText(item.sku)
  const size = cleanZplText(item.sizeText || '')
  const price =
    typeof item.price === 'number'
      ? cleanZplText(`£${item.price.toFixed(2)}`)
      : ''

  return `
^XA
^CI28
^PW400
^LL240
^LH0,0

^FO0,34^FB400,1,0,C,0^A0N,26,26^FDDOHPE^FS

^FO56,72^BY2.3,2,76^BCN,76,N,N,N^FD${sku}^FS

^FO0,158^FB400,1,0,C,0^A0N,24,24^FD${sku}^FS

^FO54,198^A0N,26,26^FD${size}^FS

^FO0,178^FB400,1,0,C,0^A0N,66,66^FD${price}^FS

^XZ
`.trim()
}

function makeZplBatch(items: LabelItem[]) {
  return items.map(makeZplLabel).join('\n')
}

export default function LabelPreviewPage() {
  const [items, setItems] = useState<LabelItem[]>([])
  const [autoPrint, setAutoPrint] = useState(false)
  const [printMode, setPrintMode] = useState<PrintMode>('zebra')
  const [message, setMessage] = useState('')
  const [zebraBusy, setZebraBusy] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setAutoPrint(params.get('print') === '1')

    const storedMode = window.localStorage.getItem('label_print_mode')

    if (storedMode === 'zebra' || storedMode === 'brother') {
      setPrintMode(storedMode)
    }

    const stored = window.localStorage.getItem('label_preview_items')

    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        setItems(Array.isArray(parsed) ? parsed : [])
      } catch {
        setItems([])
      }
    }
  }, [])

  useEffect(() => {
    if (!autoPrint || items.length === 0) return

    const timer = window.setTimeout(() => {
      if (printMode === 'zebra') {
        sendToZebra()
      } else {
        window.print()
      }
    }, 500)

    return () => window.clearTimeout(timer)
  }, [autoPrint, items, printMode])

  function changePrintMode(mode: PrintMode) {
    setPrintMode(mode)
    window.localStorage.setItem('label_print_mode', mode)
    setMessage('')
  }

  function loadScript(src: string) {
    return new Promise<void>((resolve, reject) => {
      const existingScript = document.querySelector(`script[src="${src}"]`)

      if (existingScript) {
        resolve()
        return
      }

      const script = document.createElement('script')
      script.src = src
      script.async = true

      script.onload = () => resolve()
      script.onerror = () => reject(new Error(`Could not load ${src}`))

      document.body.appendChild(script)
    })
  }

  async function loadZebraScripts() {
    if (window.BrowserPrint) return

    await loadScript('/zebra/BrowserPrint-3.1.250.min.js')
    await loadScript('/zebra/BrowserPrint-Zebra-1.1.250.min.js')
  }

  async function sendToZebra() {
    if (items.length === 0) {
      setMessage('No labels to print.')
      return
    }

    setZebraBusy(true)
    setMessage('Connecting to Zebra Browser Print...')

    try {
      await loadZebraScripts()

      if (!window.BrowserPrint) {
        throw new Error('BrowserPrint is not available.')
      }

      window.BrowserPrint.getDefaultDevice(
        'printer',
        (device: any) => {
          if (!device) {
            setZebraBusy(false)
            setMessage(
              'No default Zebra printer found. Check Browser Print is running.'
            )
            return
          }

          const zpl = makeZplBatch(items)

          device.send(
            zpl,
            () => {
              setZebraBusy(false)
              setMessage(`Sent ${items.length} label(s) to Zebra.`)
            },
            (error: any) => {
              setZebraBusy(false)
              setMessage(
                typeof error === 'string'
                  ? error
                  : 'Zebra print failed. Check Browser Print is running.'
              )
            }
          )
        },
        (error: any) => {
          setZebraBusy(false)
          setMessage(
            typeof error === 'string'
              ? error
              : 'Could not find Zebra printer. Check Browser Print is running.'
          )
        }
      )
    } catch (error: any) {
      setZebraBusy(false)
      setMessage(error.message || 'Zebra print failed.')
    }
  }

  const labelCount = useMemo(() => items.length, [items])
  const isZebra = printMode === 'zebra'

  return (
    <main className="min-h-screen bg-zinc-100 text-black print:bg-white">
      <div className="no-print sticky top-0 z-10 border-b bg-white p-4 shadow-sm">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">Label Preview</h1>

            <p className="text-sm text-zinc-600">
              {labelCount} label(s) · 50x30mm ·{' '}
              {isZebra ? 'Zebra Browser Print' : 'Brother browser print'}
            </p>

            {message && (
              <p className="mt-1 text-sm font-bold text-orange-700">
                {message}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => changePrintMode('zebra')}
              className={`rounded-lg px-4 py-2 text-sm font-bold ${
                isZebra ? 'bg-black text-white' : 'border bg-white text-black'
              }`}
            >
              Zebra
            </button>

            <button
              onClick={() => changePrintMode('brother')}
              className={`rounded-lg px-4 py-2 text-sm font-bold ${
                !isZebra ? 'bg-black text-white' : 'border bg-white text-black'
              }`}
            >
              Brother
            </button>

            {isZebra ? (
              <button
                onClick={sendToZebra}
                disabled={zebraBusy || items.length === 0}
                className="rounded-lg bg-black px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {zebraBusy ? 'Sending...' : 'Send to Zebra'}
              </button>
            ) : (
              <button
                onClick={() => window.print()}
                className="rounded-lg bg-black px-4 py-2 text-sm font-bold text-white"
              >
                Print Brother
              </button>
            )}

            <button
              onClick={() => window.close()}
              className="rounded-lg border px-4 py-2 text-sm font-bold"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="p-8 text-center text-zinc-500">
          No labels found. Go back to SKU Search and preview labels again.
        </div>
      ) : (
        <div className="label-sheet mx-auto p-4">
          {items.map((item, index) => (
            <section key={`${item.sku}-${index}`} className="label">
              <div className="brand">DOHPE</div>

              <div className="barcode-wrap">
                <Barcode
                  value={item.sku}
                  format="CODE128"
                  width={isZebra ? 1.28 : 1.12}
                  height={44}
                  displayValue={false}
                  margin={0}
                />
              </div>

              <div className="sku">{item.sku}</div>

              <div className="sku-underline" />

              <div className="bottom-row">
                <div className="size">{item.sizeText || ''}</div>

                <div className="price">
                  {typeof item.price === 'number'
                    ? `£${item.price.toFixed(2)}`
                    : ''}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}

      <style jsx global>{`
        @page {
          size: 50mm 30mm;
          margin: 0;
        }

        .label-sheet {
          width: 50mm;
        }

        .label {
          width: 50mm;
          height: 30mm;
          box-sizing: border-box;
          padding: 1.5mm 2mm;
          background: white;
          overflow: hidden;
          page-break-after: always;
          break-after: page;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
        }

        .brand {
          font-size: 7px;
          font-weight: 900;
          letter-spacing: 1.5px;
          line-height: 1;
          margin-bottom: 0.7mm;
        }

        .barcode-wrap {
          width: 100%;
          height: 12mm;
          display: flex;
          justify-content: center;
          align-items: center;
          line-height: 0;
          overflow: hidden;
        }

        .barcode-wrap svg {
          max-width: 46mm;
          height: 12mm;
        }

        .sku {
          font-size: 11px;
          font-weight: 400;
          letter-spacing: 0.8px;
          line-height: 1;
          margin-top: 0.3mm;
        }

        .sku-underline {
          width: 44mm;
          height: 0.2mm;
          background: black;
          margin-top: 0.1mm;
        }

        .bottom-row {
          position: relative;
          width: 100%;
          height: 8mm;
          margin-top: 0.8mm;
        }

        .size {
          position: absolute;
          left: 3mm;
          bottom: -0.4mm;
          font-size: 11px;
          font-weight: 400;
        }

        .price {
          position: absolute;
          left: 50%;
          bottom: -0.2mm;
          transform: translateX(-50%);
          font-size: 19px;
          font-weight: 800;
        }

        @media screen {
          .label {
            margin: 12px auto;
            border: 1px solid #ddd;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
          }
        }

        @media print {
          .no-print {
            display: none !important;
          }

          html,
          body {
            width: 50mm;
            margin: 0;
            padding: 0;
            background: white;
          }

          .label-sheet {
            width: 50mm;
            padding: 0 !important;
            margin: 0 !important;
          }

          .label {
            margin: 0;
            border: 0;
            box-shadow: none;
          }
        }
      `}</style>
    </main>
  )
}
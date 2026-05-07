'use client'

import { useEffect, useMemo, useState } from 'react'
import Barcode from 'react-barcode'

type PrintMode = 'zebra' | 'normal'

type LabelItem = {
  sku: string
  sizeText?: string | null
  price?: number | null
}

type ZebraTemplate = {
  brandY: number
  brandSize: number
  barcodeX: number
  barcodeY: number
  barcodeWidth: number
  barcodeHeight: number
  skuY: number
  skuSize: number
  underlineY: number
  underlineX: number
  underlineWidth: number
  sizeX: number
  sizeY: number
  sizeSize: number
  priceY: number
  priceSize: number
}

declare global {
  interface Window {
    BrowserPrint?: any
    Zebra?: any
  }
}

const DEFAULT_ZEBRA_TEMPLATE: ZebraTemplate = {
  brandY: 34,
  brandSize: 26,
  barcodeX: 56,
  barcodeY: 72,
  barcodeWidth: 2.3,
  barcodeHeight: 76,
  skuY: 158,
  skuSize: 20,
  underlineY: 184,
  underlineX: 26,
  underlineWidth: 348,
  sizeX: 54,
  sizeY: 198,
  sizeSize: 20,
  priceY: 182,
  priceSize: 54,
}

function cleanZplText(value: string) {
  return value.replace(/[\^~\\]/g, '').trim()
}

function makeZplLabel(item: LabelItem, template: ZebraTemplate) {
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

^FO0,${template.brandY}^FB400,1,0,C,0^A0N,${template.brandSize},${template.brandSize}^FDDOHPE^FS

^FO${template.barcodeX},${template.barcodeY}^BY${template.barcodeWidth},2,${template.barcodeHeight}^BCN,${template.barcodeHeight},N,N,N^FD${sku}^FS

^FO0,${template.skuY}^FB400,1,0,C,0^A0N,${template.skuSize},${template.skuSize}^FD${sku}^FS

^FO${template.underlineX},${template.underlineY}^GB${template.underlineWidth},2,2^FS

^FO${template.sizeX},${template.sizeY}^A0N,${template.sizeSize},${template.sizeSize}^FD${size}^FS

^FO0,${template.priceY}^FB400,1,0,C,0^A0N,${template.priceSize},${template.priceSize}^FD${price}^FS

^XZ
`.trim()
}

function makeZplBatch(items: LabelItem[], template: ZebraTemplate) {
  return items.map((item) => makeZplLabel(item, template)).join('\n')
}

export default function LabelPreviewPage() {
  const [items, setItems] = useState<LabelItem[]>([])
  const [autoPrint, setAutoPrint] = useState(false)
  const [printMode, setPrintMode] = useState<PrintMode>('zebra')
  const [message, setMessage] = useState('')
  const [zebraBusy, setZebraBusy] = useState(false)
  const [template, setTemplate] = useState<ZebraTemplate>(
    DEFAULT_ZEBRA_TEMPLATE
  )

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setAutoPrint(params.get('print') === '1')

    const storedMode = window.localStorage.getItem('label_print_mode')
    if (storedMode === 'zebra' || storedMode === 'normal') {
      setPrintMode(storedMode)
    }

    const storedTemplate = window.localStorage.getItem('zebra_label_template')
    if (storedTemplate) {
      try {
        setTemplate({
          ...DEFAULT_ZEBRA_TEMPLATE,
          ...JSON.parse(storedTemplate),
        })
      } catch {
        setTemplate(DEFAULT_ZEBRA_TEMPLATE)
      }
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
      if (printMode === 'zebra') sendToZebra()
      else window.print()
    }, 500)

    return () => window.clearTimeout(timer)
  }, [autoPrint, items, printMode, template])

  function changePrintMode(mode: PrintMode) {
    setPrintMode(mode)
    window.localStorage.setItem('label_print_mode', mode)
    setMessage('')
  }

  function updateTemplate(key: keyof ZebraTemplate, value: number) {
    const updated = {
      ...template,
      [key]: value,
    }

    setTemplate(updated)
    window.localStorage.setItem('zebra_label_template', JSON.stringify(updated))
  }

  function resetTemplate() {
    setTemplate(DEFAULT_ZEBRA_TEMPLATE)
    window.localStorage.setItem(
      'zebra_label_template',
      JSON.stringify(DEFAULT_ZEBRA_TEMPLATE)
    )
    setMessage('Zebra template reset.')
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

          device.send(
            makeZplBatch(items, template),
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
  const previewItem = items[0]

  return (
    <main className="min-h-screen bg-zinc-100 text-black print:bg-white">
      <div className="no-print sticky top-0 z-10 border-b bg-white p-4 shadow-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">Label Preview</h1>

            <p className="text-sm text-zinc-600">
              {labelCount} label(s) · 50x30mm ·{' '}
              {isZebra ? 'Zebra Browser Print' : 'Normal Print'}
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
              onClick={() => changePrintMode('normal')}
              className={`rounded-lg px-4 py-2 text-sm font-bold ${
                !isZebra ? 'bg-black text-white' : 'border bg-white text-black'
              }`}
            >
              Normal
            </button>

            {isZebra ? (
              <button
                onClick={sendToZebra}
                disabled={zebraBusy || items.length === 0}
                className="rounded-lg bg-black px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {zebraBusy ? 'Sending...' : 'Zebra Browser Print'}
              </button>
            ) : (
              <button
                onClick={() => window.print()}
                className="rounded-lg bg-black px-4 py-2 text-sm font-bold text-white"
              >
                Normal Print
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
      ) : isZebra ? (
        <div className="no-print mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-[1fr_360px]">
          <div className="rounded-xl bg-white p-5 shadow">
            <h2 className="mb-4 text-lg font-bold">Zebra Preview</h2>

            {previewItem && (
              <div className="zebra-preview">
                <div
                  className="z-brand"
                  style={{
                    top: template.brandY / 2,
                    fontSize: template.brandSize / 2,
                  }}
                >
                  DOHPE
                </div>

                <div
                  className="z-barcode"
                  style={{
                    left: template.barcodeX / 2,
                    top: template.barcodeY / 2,
                    height: template.barcodeHeight / 2,
                  }}
                >
                  <Barcode
                    value={previewItem.sku}
                    format="CODE128"
                    width={1.2}
                    height={template.barcodeHeight / 2}
                    displayValue={false}
                    margin={0}
                  />
                </div>

                <div
                  className="z-sku"
                  style={{
                    top: template.skuY / 2,
                    fontSize: template.skuSize / 2,
                  }}
                >
                  {previewItem.sku}
                </div>

                <div
                  className="z-underline"
                  style={{
                    left: template.underlineX / 2,
                    top: template.underlineY / 2,
                    width: template.underlineWidth / 2,
                  }}
                />

                <div
                  className="z-size"
                  style={{
                    left: template.sizeX / 2,
                    top: template.sizeY / 2,
                    fontSize: template.sizeSize / 2,
                  }}
                >
                  {previewItem.sizeText || ''}
                </div>

                <div
                  className="z-price"
                  style={{
                    top: template.priceY / 2,
                    fontSize: template.priceSize / 2,
                  }}
                >
                  {typeof previewItem.price === 'number'
                    ? `£${previewItem.price.toFixed(2)}`
                    : ''}
                </div>
              </div>
            )}

            <p className="mt-3 text-sm text-zinc-500">
              Preview is approximate. Zebra print uses exact ZPL dot positions.
            </p>
          </div>

          <div className="rounded-xl bg-white p-5 shadow">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Zebra Element Editor</h2>

              <button
                onClick={resetTemplate}
                className="rounded border px-3 py-1 text-xs font-bold"
              >
                Reset
              </button>
            </div>

            <div className="grid gap-3">
              {Object.entries(template).map(([key, value]) => (
                <label key={key} className="grid gap-1">
                  <span className="text-xs font-bold uppercase text-zinc-500">
                    {key}
                  </span>

                  <input
                    type="number"
                    step={key === 'barcodeWidth' ? 0.1 : 1}
                    value={value}
                    onChange={(e) =>
                      updateTemplate(
                        key as keyof ZebraTemplate,
                        Number(e.target.value)
                      )
                    }
                    className="rounded-lg border px-3 py-2 text-sm"
                  />
                </label>
              ))}
            </div>
          </div>
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
                  width={1.12}
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

        .zebra-preview {
          position: relative;
          width: 200px;
          height: 120px;
          background: white;
          border: 1px solid #ddd;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        }

        .z-brand,
        .z-sku,
        .z-price {
          position: absolute;
          left: 0;
          width: 200px;
          text-align: center;
          line-height: 1;
        }

        .z-brand {
          font-weight: 700;
          letter-spacing: 1.2px;
        }

        .z-sku,
        .z-size {
          font-weight: 300;
        }

        .z-barcode {
          position: absolute;
          overflow: hidden;
          line-height: 0;
        }

        .z-barcode svg {
          height: 100%;
          max-width: 170px;
        }

        .z-underline {
          position: absolute;
          height: 1px;
          background: black;
        }

        .z-size {
          position: absolute;
          line-height: 1;
        }

        .z-price {
          font-weight: 700;
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
          font-size: 10px;
          font-weight: 300;
          letter-spacing: 0.7px;
          line-height: 1;
          margin-top: 0.3mm;
        }

        .sku-underline {
          width: 44mm;
          height: 0.25mm;
          background: black;
          margin-top: 0.4mm;
          opacity: 0.9;
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
          bottom: -0.3mm;
          font-size: 9px;
          font-weight: 300;
        }

        .price {
          position: absolute;
          left: 50%;
          bottom: 0mm;
          transform: translateX(-50%);
          font-size: 16px;
          font-weight: 700;
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
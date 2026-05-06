'use client'

import { useEffect, useMemo, useState } from 'react'
import Barcode from 'react-barcode'

type PrintMode = 'zebra' | 'brother'

type LabelItem = {
  sku: string
  sizeText?: string | null
  price?: number | null
}

export default function LabelPreviewPage() {
  const [items, setItems] = useState<LabelItem[]>([])
  const [autoPrint, setAutoPrint] = useState(false)
  const [printMode, setPrintMode] = useState<PrintMode>('zebra')

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
      window.print()
    }, 500)

    return () => window.clearTimeout(timer)
  }, [autoPrint, items])

  function changePrintMode(mode: PrintMode) {
    setPrintMode(mode)
    window.localStorage.setItem('label_print_mode', mode)
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
              {isZebra ? 'Zebra mode' : 'Brother mode'}
            </p>
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

            <button
              onClick={() => window.print()}
              className="rounded-lg bg-black px-4 py-2 text-sm font-bold text-white"
            >
              Print
            </button>

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
                    ? `£${item.price.toFixed(0)}`
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
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 1px;
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
          left: 1mm;
          bottom: -0.6mm;
          font-size: 12px;
          font-weight: 700;
        }

        .price {
          position: absolute;
          left: 50%;
          bottom: -1.4mm;
          transform: translateX(-50%);
          font-size: 20px;
          font-weight: 900;
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
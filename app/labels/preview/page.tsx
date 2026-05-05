'use client'

import { useEffect, useMemo, useState } from 'react'
import Barcode from 'react-barcode'

type LabelItem = {
  sku: string
  sizeText?: string | null
  price?: number | null
}

export default function LabelPreviewPage() {
  const [items, setItems] = useState<LabelItem[]>([])
  const [autoPrint, setAutoPrint] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setAutoPrint(params.get('print') === '1')

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

  const labelCount = useMemo(() => items.length, [items])

  return (
    <main className="min-h-screen bg-zinc-100 text-black print:bg-white">
      <div className="no-print sticky top-0 z-10 border-b bg-white p-4 shadow-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">Label Preview</h1>

            <p className="text-sm text-zinc-600">
              {labelCount} label(s)
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="rounded-lg bg-black px-4 py-2 text-sm font-bold text-white"
            >
              Print / Save PDF
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
            <section
              key={`${item.sku}-${index}`}
              className="label"
            >
              <div className="brand">
                DOHPE
              </div>

              <div className="barcode-wrap">
                <Barcode
                  value={item.sku}
                  format="CODE128"
                  width={1.45}
                  height={54}
                  displayValue={false}
                  margin={0}
                />
              </div>

              <div className="sku">
                {item.sku}
              </div>

              <div className="sku-underline" />

              <div className="bottom-row">
                <div className="size">
                  {item.sizeText || ''}
                </div>

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
          size: 62mm 30mm;
          margin: 0;
        }

        .label-sheet {
          width: 62mm;
        }

        .label {
          width: 62mm;
          height: 30mm;
          box-sizing: border-box;
          padding: 2mm 3mm;
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
          font-size: 8px;
          font-weight: 800;
          letter-spacing: 1.8px;
          line-height: 1;
          margin-bottom: 1mm;
        }

        .barcode-wrap {
          width: 100%;
          display: flex;
          justify-content: center;
          line-height: 0;
        }

        .barcode-wrap svg {
          max-width: 56mm;
        }

        .sku {
          font-size: 13px;
          font-weight: 500;
          letter-spacing: 1.2px;
          line-height: 1;
          margin-top: 0.4mm;
        }

        .sku-underline {
          width: 52mm;
          height: 0.2mm;
          background: black;
          margin-top: -0.15mm;
        }

        .bottom-row {
          position: relative;
          width: 100%;
          height: 8mm;
          margin-top: 1.5mm;
        }

        .size {
          position: absolute;
          left: 3mm;
          bottom: -1.5mm;

          font-size: 12px;
          font-weight: 500;
        }

        .price {
          position: absolute;
          left: 50%;
          bottom: -2.2mm;

          transform: translateX(-50%);

          font-size: 20px;
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
            width: 62mm;
            margin: 0;
            padding: 0;
            background: white;
          }

          .label-sheet {
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
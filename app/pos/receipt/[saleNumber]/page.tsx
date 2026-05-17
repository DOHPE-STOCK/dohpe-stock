'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import QRCode from 'react-qr-code'

export const dynamic = 'force-dynamic'

type SaleLine = {
  id: string
  sku: string
  title: string | null
  brand: string | null
  reporting_category: string | null
  sub_type: string | null
  colour: string | null
  quantity: number
  unit_price: number
  line_total: number
  discount_percent: number | null
  discount_amount: number | null
  original_line_id: string | null
  refunded_quantity: number | null
  max_refundable_quantity: number | null
}

type Sale = {
  id: string
  sale_number: string
  mode: string | null
  payment_method: string | null
  subtotal: number | null
  discount_amount: number | null
  total: number | null
  vat_amount: number | null
  net_amount: number | null
  cash_tendered: number | null
  change_due: number | null
  square_status: string | null
  square_payment_id: string | null
  square_refund_id: string | null
  square_refund_status: string | null
  square_receipt_url: string | null
  status: string | null
  original_sale_id: string | null
  exchange_credit: number | null
  refund_method: string | null
  checkout_location: string | null
  created_at: string
}

const DOHPE_LOGO_URL =
  'https://qirvkgjkmfaohmccqouq.supabase.co/storage/v1/object/public/app-assets/dohpe-round-logo.png'

function money(value: any) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(Number(value || 0))
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function receiptTitle(mode: string | null) {
  if (mode === 'refund') return 'REFUND RECEIPT'
  if (mode === 'exchange') return 'EXCHANGE RECEIPT'
  return 'SALE RECEIPT'
}

export default function ReceiptPage() {
  const params = useParams()
  const saleNumber = String(params.saleNumber || '').toUpperCase()

  const [sale, setSale] = useState<Sale | null>(null)
  const [lines, setLines] = useState<SaleLine[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  const receiptUrl = useMemo(() => {
    if (typeof window === 'undefined') return saleNumber
    return `${window.location.origin}/pos/receipt/${saleNumber}`
  }, [saleNumber])

  useEffect(() => {
    fetchSale()
  }, [saleNumber])

  async function fetchSale() {
    setLoading(true)
    setMessage('')

    try {
      const response = await fetch(
        `/api/pos/lookup-sale?sale_number=${encodeURIComponent(saleNumber)}`
      )

      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Receipt not found.')
      }

      setSale(data.sale)
      setLines(Array.isArray(data.lines) ? data.lines : [])
    } catch (error: any) {
      setMessage(error.message || 'Could not load receipt.')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white text-black">
        Loading receipt...
      </main>
    )
  }

  if (!sale) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white p-6 text-center text-black">
        <div>
          <h1 className="text-xl font-black">Receipt not found</h1>
          <p className="mt-2 text-sm">{message}</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-neutral-200 py-6 text-black print:bg-white print:py-0">
      <style jsx global>{`
        @page {
          size: 80mm auto;
          margin: 0;
        }

        @media print {
          html,
          body {
            width: 80mm;
            margin: 0;
            padding: 0;
            background: white;
          }

          .no-print {
            display: none !important;
          }

          .receipt {
            width: 80mm !important;
            box-shadow: none !important;
            border: none !important;
            margin: 0 !important;
          }
        }
      `}</style>

      <div className="no-print mx-auto mb-4 flex max-w-[80mm] gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="flex-1 rounded-xl bg-black px-4 py-3 text-sm font-black text-white"
        >
          Print Receipt
        </button>

        <button
          type="button"
          onClick={() => window.history.back()}
          className="rounded-xl bg-white px-4 py-3 text-sm font-black"
        >
          Back
        </button>
      </div>

      <section className="receipt mx-auto w-[80mm] bg-white p-4 font-mono text-[11px] shadow-xl">
        <div className="text-center">
          <img
            src={DOHPE_LOGO_URL}
            alt="Dohpe"
            className="mx-auto h-16 w-16 rounded-full object-contain"
          />

          <h1 className="mt-2 text-base font-black tracking-tight">DOHPE VINTAGE</h1>
          <p className="text-[10px] font-bold">NORWICH</p>
          <p className="mt-2 text-[11px] font-black">{receiptTitle(sale.mode)}</p>
        </div>

        <div className="my-3 border-t border-dashed border-black" />

        <div className="space-y-1">
          <div className="flex justify-between gap-2">
            <span>Receipt</span>
            <span className="text-right font-bold">{sale.sale_number}</span>
          </div>

          <div className="flex justify-between gap-2">
            <span>Date</span>
            <span className="text-right">{formatDate(sale.created_at)}</span>
          </div>

          <div className="flex justify-between gap-2">
            <span>Payment</span>
            <span className="text-right uppercase">{sale.payment_method || '-'}</span>
          </div>

          <div className="flex justify-between gap-2">
            <span>Status</span>
            <span className="text-right uppercase">{sale.status || '-'}</span>
          </div>

          {sale.checkout_location && (
            <div className="flex justify-between gap-2">
              <span>Location</span>
              <span className="text-right">{sale.checkout_location}</span>
            </div>
          )}
        </div>

        <div className="my-3 border-t border-dashed border-black" />

        <div className="space-y-3">
          {lines.map((line) => (
            <div key={line.id}>
              <div className="flex justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-black">{line.brand || line.title || line.sku}</p>
                  <p className="break-words text-[10px]">
                    {[line.reporting_category, line.sub_type, line.colour]
                      .filter(Boolean)
                      .join(' / ')}
                  </p>
                  <p className="break-words text-[10px]">SKU: {line.sku}</p>
                </div>

                <div className="shrink-0 text-right">
                  <p>
                    {line.quantity} x {money(line.unit_price)}
                  </p>
                  <p className="font-black">{money(line.line_total)}</p>
                </div>
              </div>

              {Number(line.discount_amount || 0) > 0 && (
                <p className="text-right text-[10px]">
                  Discount: -{money(line.discount_amount)}
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="my-3 border-t border-dashed border-black" />

        <div className="space-y-1">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{money(sale.subtotal)}</span>
          </div>

          <div className="flex justify-between">
            <span>Discount</span>
            <span>-{money(sale.discount_amount)}</span>
          </div>

          {Number(sale.exchange_credit || 0) > 0 && (
            <div className="flex justify-between">
              <span>Exchange credit</span>
              <span>-{money(sale.exchange_credit)}</span>
            </div>
          )}

          <div className="flex justify-between">
            <span>Net</span>
            <span>{money(sale.net_amount)}</span>
          </div>

          <div className="flex justify-between">
            <span>VAT included</span>
            <span>{money(sale.vat_amount)}</span>
          </div>

          <div className="mt-2 flex justify-between text-sm font-black">
            <span>TOTAL</span>
            <span>{money(sale.total)}</span>
          </div>

          {sale.payment_method === 'cash' && (
            <>
              <div className="flex justify-between">
                <span>Cash tendered</span>
                <span>{money(sale.cash_tendered)}</span>
              </div>

              <div className="flex justify-between">
                <span>Change due</span>
                <span>{money(sale.change_due)}</span>
              </div>
            </>
          )}
        </div>

        {(sale.square_payment_id || sale.square_refund_id || sale.square_status) && (
          <>
            <div className="my-3 border-t border-dashed border-black" />

            <div className="space-y-1 text-[10px]">
              {sale.square_status && (
                <div>
                  <p className="font-black">Square status</p>
                  <p className="break-words">{sale.square_status}</p>
                </div>
              )}

              {sale.square_payment_id && (
                <div>
                  <p className="font-black">Square payment ID</p>
                  <p className="break-words">{sale.square_payment_id}</p>
                </div>
              )}

              {sale.square_refund_id && (
                <div>
                  <p className="font-black">Square refund ID</p>
                  <p className="break-words">{sale.square_refund_id}</p>
                </div>
              )}

              {sale.square_refund_status && (
                <div>
                  <p className="font-black">Refund status</p>
                  <p className="break-words">{sale.square_refund_status}</p>
                </div>
              )}
            </div>
          </>
        )}

        <div className="my-3 border-t border-dashed border-black" />

        <div className="flex justify-center">
          <div className="bg-white p-1">
            <QRCode value={receiptUrl} size={96} />
          </div>
        </div>

        <p className="mt-2 text-center text-[10px]">
          Scan QR to open receipt / refund lookup
        </p>

        <div className="my-3 border-t border-dashed border-black" />

        <div className="text-center text-[10px]">
          <p className="font-black">THANK YOU</p>
          <p>Vintage clothing may show natural signs of wear.</p>
          <p className="mt-2">Refunds/exchanges subject to store policy.</p>
        </div>
      </section>
    </main>
  )
}
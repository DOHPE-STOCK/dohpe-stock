'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import AppNav from '@/app/components/AppNav'
import { supabase } from '@/lib/supabase'

type ItemRow = {
  id: string
  sku: string
  brand: string | null
  reporting_category: string | null
  final_title: string | null
  basic_title: string | null
  selling_price: number | null
  stock_level: number | null
  current_location: string | null
  current_bin: string | null
}

type BasketLine = {
  sku: string
  title: string
  brand: string
  category: string
  price: number
  quantity: number
  location: string
  bin: string
  stockLevel: number
  lineDiscountPercent: number
  lineDiscountAmount: number
}

type PaymentMethod = 'cash' | 'card' | null
type Mode = 'sale' | 'refund'

const OFFLINE_QUEUE_KEY = 'dohpe_pos_offline_queue_v1'

function money(value: number) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(value || 0)
}

function normaliseSku(value: string) {
  return value.trim()
}

function getLineTitle(item: ItemRow) {
  return (
    item.final_title ||
    item.basic_title ||
    [item.brand, item.reporting_category].filter(Boolean).join(' ') ||
    item.sku
  )
}

export default function CheckoutPage() {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [darkMode, setDarkMode] = useState(true)
  const [mode, setMode] = useState<Mode>('sale')
  const [scanValue, setScanValue] = useState('')
  const [basket, setBasket] = useState<BasketLine[]>([])
  const [selectedSku, setSelectedSku] = useState('')
  const [loadingSku, setLoadingSku] = useState('')
  const [message, setMessage] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(null)
  const [basketDiscountPercent, setBasketDiscountPercent] = useState(0)
  const [basketDiscountAmount, setBasketDiscountAmount] = useState(0)
  const [manualPercent, setManualPercent] = useState('')
  const [manualAmount, setManualAmount] = useState('')
  const [cashTendered, setCashTendered] = useState('')
  const [saleBusy, setSaleBusy] = useState(false)
  const [offlineCount, setOfflineCount] = useState(0)

  useEffect(() => {
    inputRef.current?.focus()

    const saved = localStorage.getItem(OFFLINE_QUEUE_KEY)
    if (saved) {
      try {
        const rows = JSON.parse(saved)
        setOfflineCount(Array.isArray(rows) ? rows.length : 0)
      } catch {
        setOfflineCount(0)
      }
    }
  }, [])

  const subtotal = useMemo(() => {
    return basket.reduce((sum, line) => sum + line.price * line.quantity, 0)
  }, [basket])

  const lineDiscountTotal = useMemo(() => {
    return basket.reduce((sum, line) => {
      const lineSubtotal = line.price * line.quantity
      const percentDiscount = lineSubtotal * ((line.lineDiscountPercent || 0) / 100)
      const amountDiscount = line.lineDiscountAmount || 0
      return sum + Math.min(lineSubtotal, percentDiscount + amountDiscount)
    }, 0)
  }, [basket])

  const basketPercentDiscountAmount = subtotal * (basketDiscountPercent / 100)
  const totalDiscount = Math.min(
    subtotal,
    lineDiscountTotal + basketPercentDiscountAmount + basketDiscountAmount
  )

  const total = Math.max(0, subtotal - totalDiscount)
  const vatAmount = total / 6
  const netAmount = total - vatAmount

  const totalItems = basket.reduce((sum, line) => sum + line.quantity, 0)
  const changeDue = Math.max(0, (Number(cashTendered) || 0) - total)
  const selectedLine = basket.find((line) => line.sku === selectedSku)

  const pageClass = darkMode
    ? 'min-h-screen bg-neutral-950 text-white'
    : 'min-h-screen bg-neutral-100 text-neutral-950'

  const panelClass = darkMode
    ? 'rounded-3xl border border-neutral-800 bg-neutral-900 shadow-2xl'
    : 'rounded-3xl border border-neutral-200 bg-white shadow-xl'

  const mutedText = darkMode ? 'text-neutral-400' : 'text-neutral-500'
  const inputClass = darkMode
    ? 'w-full rounded-2xl border border-neutral-700 bg-neutral-950 px-4 py-4 text-xl font-semibold outline-none focus:border-white'
    : 'w-full rounded-2xl border border-neutral-300 bg-white px-4 py-4 text-xl font-semibold outline-none focus:border-black'

  function discountTargetText() {
    return selectedLine ? `selected item: ${selectedLine.sku}` : 'whole basket'
  }

  function warnDiscount(label: string) {
    setMessage(`${label} discount applied to ${discountTargetText()}.`)
  }

  function applyPercentDiscount(percent: number) {
    if (selectedLine) {
      setBasket((current) =>
        current.map((line) =>
          line.sku === selectedLine.sku ? { ...line, lineDiscountPercent: percent } : line
        )
      )
    } else {
      setBasketDiscountPercent(percent)
    }

    warnDiscount(`${percent}%`)
  }

  function applyManualPercent() {
    const percent = Number(manualPercent)

    if (!Number.isFinite(percent) || percent <= 0) {
      setMessage('Enter a valid manual percentage.')
      return
    }

    applyPercentDiscount(percent)
  }

  function applyManualAmount() {
    const amount = Number(manualAmount)

    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage('Enter a valid manual discount amount.')
      return
    }

    if (selectedLine) {
      setBasket((current) =>
        current.map((line) =>
          line.sku === selectedLine.sku ? { ...line, lineDiscountAmount: amount } : line
        )
      )
    } else {
      setBasketDiscountAmount(amount)
    }

    warnDiscount(`${money(amount)}`)
  }

  async function addScannedSku(rawSku?: string) {
    const sku = normaliseSku(rawSku || scanValue)

    if (!sku) return

    setLoadingSku(sku)
    setMessage('')

    try {
      const { data, error } = await supabase
        .from('items')
        .select(
          'id, sku, brand, reporting_category, final_title, basic_title, selling_price, stock_level, current_location, current_bin'
        )
        .eq('sku', sku)
        .maybeSingle()

      if (error) throw new Error(error.message)

      if (!data) {
        setMessage(`SKU not found: ${sku}`)
        return
      }

      if (mode === 'refund') {
        const soldCheck = await supabase
          .from('linnworks_processed_sales')
          .select('id')
          .eq('sku', sku)
          .eq('stock_deducted', true)
          .limit(1)

        if (soldCheck.error) throw new Error(soldCheck.error.message)

        if (!soldCheck.data || soldCheck.data.length === 0) {
          setMessage(`Refund blocked. No sold record found for ${sku}.`)
          return
        }
      }

      const item = data as ItemRow
      const price = Number(item.selling_price || 0)

      setBasket((current) => {
        const existing = current.find((line) => line.sku.toLowerCase() === sku.toLowerCase())

        if (existing) {
          return current.map((line) =>
            line.sku.toLowerCase() === sku.toLowerCase()
              ? { ...line, quantity: line.quantity + 1 }
              : line
          )
        }

        return [
          ...current,
          {
            sku: item.sku,
            title: getLineTitle(item),
            brand: item.brand || '',
            category: item.reporting_category || '',
            price,
            quantity: 1,
            location: item.current_location || 'SHOP-1',
            bin: item.current_bin || item.current_location || 'SHOP-1',
            stockLevel: Number(item.stock_level || 0),
            lineDiscountPercent: 0,
            lineDiscountAmount: 0,
          },
        ]
      })

      setScanValue('')
      setTimeout(() => inputRef.current?.focus(), 50)
    } catch (error: any) {
      setMessage(error.message || 'Could not add SKU.')
    } finally {
      setLoadingSku('')
    }
  }

  function updateQty(sku: string, quantity: number) {
    if (quantity <= 0) {
      setBasket((current) => current.filter((line) => line.sku !== sku))
      if (selectedSku === sku) setSelectedSku('')
      return
    }

    setBasket((current) =>
      current.map((line) => (line.sku === sku ? { ...line, quantity } : line))
    )
  }

  function clearSale() {
    setBasket([])
    setSelectedSku('')
    setPaymentMethod(null)
    setBasketDiscountPercent(0)
    setBasketDiscountAmount(0)
    setManualPercent('')
    setManualAmount('')
    setCashTendered('')
    setMessage('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function saveOfflineQueue(rows: any[]) {
    const saved = localStorage.getItem(OFFLINE_QUEUE_KEY)
    let current: any[] = []

    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        current = Array.isArray(parsed) ? parsed : []
      } catch {
        current = []
      }
    }

    const next = [...current, ...rows]
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(next))
    setOfflineCount(next.length)
  }

  async function createQueueRows(method: 'cash' | 'card') {
    const saleId = crypto.randomUUID()
    const soldAt = new Date().toISOString()
    const isRefund = mode === 'refund'

    const rows = basket.map((line) => ({
      sku: line.sku,
      action: 'adjust_stock',
      payload: {
        sku: line.sku,
        delta: isRefund ? line.quantity : -line.quantity,
        reason: isRefund
          ? method === 'card'
            ? 'pos_card_refund'
            : 'pos_cash_refund'
          : method === 'cash'
            ? 'pos_cash_sale'
            : 'pos_card_sale',
        payment_method: method,
        sale_id: saleId,
        sold_at: soldAt,
        quantity: line.quantity,
        unit_price: line.price,
        line_total: Number((line.price * line.quantity).toFixed(2)),
        subtotal: Number(subtotal.toFixed(2)),
        discount_percent: basketDiscountPercent,
        discount_amount: Number(totalDiscount.toFixed(2)),
        total: Number(total.toFixed(2)),
        vat_amount: Number(vatAmount.toFixed(2)),
        net_amount: Number(netAmount.toFixed(2)),
        location: line.location,
        bin: line.bin,
      },
      status: 'pending',
    }))

    const { error } = await supabase.from('linnworks_sync_queue').insert(rows)

    if (error) {
      saveOfflineQueue(rows)
      throw new Error(`Saved offline because queue insert failed: ${error.message}`)
    }

    return saleId
  }

  async function completeSale(method: 'cash' | 'card') {
    if (basket.length === 0) {
      setMessage('Basket is empty.')
      return
    }

    if (mode === 'refund') {
      const confirmed = window.confirm(
        method === 'card'
          ? 'Enter CARD REFUND mode? This will queue stock back in and prepare the sale for Square refund handling later.'
          : 'Enter CASH REFUND mode? This will queue stock back in.'
      )

      if (!confirmed) return
    }

    if (mode === 'sale' && method === 'cash' && Number(cashTendered || 0) < total) {
      setMessage('Cash tendered is less than total.')
      return
    }

    setSaleBusy(true)
    setMessage('')

    try {
      const saleId = await createQueueRows(method)

      if (mode === 'refund') {
        setMessage(
          method === 'card'
            ? `Card refund queued. Sale ID: ${saleId}. Square refund connection still needs wiring.`
            : `Cash refund queued. Sale ID: ${saleId}.`
        )
      } else if (method === 'card') {
        setMessage(`Card sale queued. Sale ID: ${saleId}. Square Terminal push not connected yet.`)
      } else {
        setMessage(`Cash sale queued. Change due: ${money(changeDue)}.`)
      }

      clearSale()
      setMode('sale')
    } catch (error: any) {
      setMessage(error.message || 'Could not complete.')
    } finally {
      setSaleBusy(false)
    }
  }

  return (
    <main className={pageClass}>
      <AppNav current="checkout" />

      <div className="mx-auto flex min-h-[calc(100vh-70px)] max-w-5xl flex-col gap-4 p-3 sm:p-5">
        <section className={`${panelClass} p-4 sm:p-5`}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
                {mode === 'refund' ? 'Refund' : 'Checkout'}
              </h1>
              <p className={`text-sm ${mutedText}`}>
                {selectedLine
                  ? `Discount target: selected item ${selectedLine.sku}`
                  : 'Discount target: whole basket'}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setDarkMode((value) => !value)}
              className="rounded-full border border-current px-4 py-2 text-sm font-bold"
            >
              {darkMode ? 'Light' : 'Dark'}
            </button>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              addScannedSku()
            }}
            className="flex gap-2"
          >
            <input
              ref={inputRef}
              value={scanValue}
              onChange={(event) => setScanValue(event.target.value)}
              placeholder="Scan or enter SKU"
              className={inputClass}
              autoFocus
              inputMode="text"
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={!scanValue.trim() || Boolean(loadingSku)}
              className="rounded-2xl bg-white px-5 py-3 font-black text-black disabled:opacity-40"
            >
              Add
            </button>
          </form>

          {message && (
            <div className={`mt-3 rounded-2xl p-3 text-sm font-semibold ${darkMode ? 'bg-neutral-800' : 'bg-neutral-100'}`}>
              {message}
            </div>
          )}
        </section>

        <section className={`${panelClass} flex flex-1 flex-col overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-current/10 p-4">
            <div>
              <p className={`text-xs font-bold uppercase tracking-widest ${mutedText}`}>Basket</p>
              <p className="text-lg font-black">{totalItems} items</p>
            </div>
            <button type="button" onClick={clearSale} className="rounded-full bg-red-500 px-4 py-2 text-sm font-black text-white">
              Clear
            </button>
          </div>

          <div className="flex-1 space-y-2 overflow-auto p-3">
            {basket.length === 0 ? (
              <div className={`rounded-3xl p-8 text-center ${mutedText}`}>
                <p className="text-lg font-bold">No items scanned yet</p>
                <p className="text-sm">Scan the first barcode to begin.</p>
              </div>
            ) : (
              basket.map((line) => {
                const isSelected = selectedSku === line.sku

                return (
                  <button
                    key={line.sku}
                    type="button"
                    onClick={() => setSelectedSku(isSelected ? '' : line.sku)}
                    className={`w-full rounded-3xl p-4 text-left ${
                      isSelected
                        ? 'bg-emerald-500/20 ring-2 ring-emerald-400'
                        : darkMode
                          ? 'bg-neutral-950'
                          : 'bg-neutral-100'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-lg font-black">{line.title}</p>
                        <p className={`text-sm ${mutedText}`}>
                          {line.sku}
                          {line.brand ? ` · ${line.brand}` : ''}
                          {line.category ? ` · ${line.category}` : ''}
                        </p>
                        <p className={`text-xs ${mutedText}`}>
                          {line.location} · {line.bin} · Stock {line.stockLevel}
                        </p>
                        {(line.lineDiscountPercent > 0 || line.lineDiscountAmount > 0) && (
                          <p className="mt-1 text-xs font-black text-emerald-400">
                            Line discount: {line.lineDiscountPercent || 0}% {line.lineDiscountAmount ? `+ ${money(line.lineDiscountAmount)}` : ''}
                          </p>
                        )}
                      </div>

                      <div className="text-right">
                        <p className="text-lg font-black">{money(line.price * line.quantity)}</p>
                        <p className={`text-sm ${mutedText}`}>{money(line.price)} each</p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <div className="flex items-center rounded-full border border-current/20">
                        <span onClick={(e) => { e.stopPropagation(); updateQty(line.sku, line.quantity - 1) }} className="px-4 py-2 text-xl font-black">−</span>
                        <span className="min-w-10 text-center font-black">{line.quantity}</span>
                        <span onClick={(e) => { e.stopPropagation(); updateQty(line.sku, line.quantity + 1) }} className="px-4 py-2 text-xl font-black">+</span>
                      </div>

                      <span onClick={(e) => { e.stopPropagation(); updateQty(line.sku, 0) }} className="rounded-full px-4 py-2 text-sm font-bold text-red-500">
                        Remove
                      </span>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </section>

        <section className={`${panelClass} p-4 sm:p-5`}>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <button type="button" onClick={() => applyPercentDiscount(5)} className="rounded-2xl border border-current/20 py-3 font-black">
              5% off
            </button>
            <button type="button" onClick={() => applyPercentDiscount(10)} className="rounded-2xl border border-current/20 py-3 font-black">
              10% off
            </button>
            <button type="button" onClick={applyManualPercent} className="rounded-2xl border border-current/20 py-3 font-black">
              Manual %
            </button>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2">
            <input value={manualPercent} onChange={(e) => setManualPercent(e.target.value)} placeholder="Manual %" className={inputClass} inputMode="decimal" />
            <div className="flex gap-2">
              <input value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} placeholder="Manual £" className={inputClass} inputMode="decimal" />
              <button type="button" onClick={applyManualAmount} className="rounded-2xl border border-current/20 px-4 font-black">
                Apply
              </button>
            </div>
          </div>

          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span className={mutedText}>Subtotal</span><span className="font-bold">{money(subtotal)}</span></div>
            <div className="flex justify-between"><span className={mutedText}>Discount before VAT</span><span className="font-bold">−{money(totalDiscount)}</span></div>
            <div className="flex justify-between"><span className={mutedText}>Net</span><span className="font-bold">{money(netAmount)}</span></div>
            <div className="flex justify-between"><span className={mutedText}>VAT included at 20%</span><span className="font-bold">{money(vatAmount)}</span></div>
            <div className="flex items-end justify-between pt-2">
              <span className="text-lg font-black">{mode === 'refund' ? 'Refund total' : 'Total'}</span>
              <span className="text-4xl font-black tracking-tight">{money(total)}</span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setPaymentMethod('cash')} className={`rounded-3xl py-4 text-xl font-black ${paymentMethod === 'cash' ? 'bg-green-300 text-black ring-4 ring-green-500/40' : 'bg-green-100 text-black'}`}>
              💷 Cash
            </button>
            <button type="button" onClick={() => setPaymentMethod('card')} className={`rounded-3xl py-4 text-xl font-black ${paymentMethod === 'card' ? 'bg-sky-300 text-black ring-4 ring-sky-500/40' : 'bg-sky-100 text-black'}`}>
              💳 Card<br /><span className="text-xs">VISA · MC · AMEX</span>
            </button>
          </div>

          {paymentMethod === 'cash' && mode === 'sale' && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <input value={cashTendered} onChange={(e) => setCashTendered(e.target.value)} placeholder="Cash tendered" className={inputClass} inputMode="decimal" />
              <div className={`rounded-2xl p-3 text-right ${darkMode ? 'bg-neutral-950' : 'bg-neutral-100'}`}>
                <p className={`text-xs font-bold uppercase tracking-widest ${mutedText}`}>Change</p>
                <p className="text-2xl font-black">{money(changeDue)}</p>
              </div>
            </div>
          )}

          <button type="button" disabled={!paymentMethod || basket.length === 0 || saleBusy} onClick={() => paymentMethod && completeSale(paymentMethod)} className="mt-4 w-full rounded-3xl bg-emerald-400 py-5 text-2xl font-black text-black disabled:opacity-40">
            {saleBusy ? 'Saving…' : mode === 'refund' ? 'Complete Refund' : paymentMethod === 'cash' ? 'Complete Cash Sale' : paymentMethod === 'card' ? 'Complete Card Sale' : 'Select Payment'}
          </button>

          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => {
                const confirmed = window.confirm('Enter refund mode? Only SKUs with sold records can be refunded.')
                if (!confirmed) return
                clearSale()
                setMode('refund')
                setPaymentMethod('card')
                setMessage('Refund mode enabled. Scan the sold SKU to refund.')
              }}
              className="text-xs font-bold text-red-500 underline"
            >
              Card refund / refund mode
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}
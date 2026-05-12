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
}

type PaymentMethod = 'cash' | 'card' | null

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
  const [scanValue, setScanValue] = useState('')
  const [basket, setBasket] = useState<BasketLine[]>([])
  const [loadingSku, setLoadingSku] = useState('')
  const [message, setMessage] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(null)
  const [discountPercent, setDiscountPercent] = useState(0)
  const [manualDiscount, setManualDiscount] = useState('')
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

  const totalItems = useMemo(() => {
    return basket.reduce((sum, line) => sum + line.quantity, 0)
  }, [basket])

  const percentDiscountAmount = useMemo(() => {
    return subtotal * (discountPercent / 100)
  }, [subtotal, discountPercent])

  const manualDiscountAmount = useMemo(() => {
    const parsed = Number(manualDiscount)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }, [manualDiscount])

  const totalDiscount = Math.min(subtotal, percentDiscountAmount + manualDiscountAmount)
  const total = Math.max(0, subtotal - totalDiscount)
  const changeDue = Math.max(0, (Number(cashTendered) || 0) - total)

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
      return
    }

    setBasket((current) =>
      current.map((line) => (line.sku === sku ? { ...line, quantity } : line))
    )
  }

  function clearSale() {
    setBasket([])
    setPaymentMethod(null)
    setDiscountPercent(0)
    setManualDiscount('')
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

    const rows = basket.map((line) => ({
      sku: line.sku,
      action: 'adjust_stock',
      payload: {
        sku: line.sku,
        delta: -line.quantity,
        reason: method === 'cash' ? 'pos_cash_sale' : 'pos_card_sale',
        payment_method: method,
        sale_id: saleId,
        sold_at: soldAt,
        quantity: line.quantity,
        unit_price: line.price,
        line_total: Number((line.price * line.quantity).toFixed(2)),
        subtotal: Number(subtotal.toFixed(2)),
        discount_percent: discountPercent,
        discount_amount: Number(totalDiscount.toFixed(2)),
        total: Number(total.toFixed(2)),
        location: line.location,
        bin: line.bin,
      },
      status: 'pending',
    }))

    const { error } = await supabase.from('linnworks_sync_queue').insert(rows)

    if (error) {
      saveOfflineQueue(rows)
      throw new Error(`Sale saved offline because queue insert failed: ${error.message}`)
    }

    return saleId
  }

  async function completeSale(method: 'cash' | 'card') {
    if (basket.length === 0) {
      setMessage('Basket is empty.')
      return
    }

    if (method === 'cash' && Number(cashTendered || 0) < total) {
      setMessage('Cash tendered is less than total.')
      return
    }

    setSaleBusy(true)
    setMessage('')

    try {
      const saleId = await createQueueRows(method)

      if (method === 'card') {
        setMessage(
          `Card sale queued. Sale ID: ${saleId}. Square Terminal push is not connected yet.`
        )
      } else {
        setMessage(
          `Cash sale queued. Change due: ${money(changeDue)}. Cash drawer/receipt printer not connected yet.`
        )
      }

      clearSale()
    } catch (error: any) {
      setMessage(error.message || 'Could not complete sale.')
    } finally {
      setSaleBusy(false)
    }
  }

  async function retryOfflineQueue() {
    const saved = localStorage.getItem(OFFLINE_QUEUE_KEY)
    if (!saved) return

    let rows: any[] = []

    try {
      const parsed = JSON.parse(saved)
      rows = Array.isArray(parsed) ? parsed : []
    } catch {
      rows = []
    }

    if (rows.length === 0) {
      setOfflineCount(0)
      return
    }

    setSaleBusy(true)

    try {
      const { error } = await supabase.from('linnworks_sync_queue').insert(rows)
      if (error) throw new Error(error.message)

      localStorage.removeItem(OFFLINE_QUEUE_KEY)
      setOfflineCount(0)
      setMessage('Offline queue uploaded.')
    } catch (error: any) {
      setMessage(error.message || 'Could not upload offline queue.')
    } finally {
      setSaleBusy(false)
    }
  }

  return (
    <main className={pageClass}>
      <AppNav />

      <div className="mx-auto flex min-h-[calc(100vh-70px)] max-w-5xl flex-col gap-4 p-3 sm:p-5">
        <section className={`${panelClass} p-4 sm:p-5`}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Checkout</h1>
              <p className={`text-sm ${mutedText}`}>Scan SKU barcodes to build a sale.</p>
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
            <div
              className={`mt-3 rounded-2xl p-3 text-sm font-semibold ${
                darkMode ? 'bg-neutral-800 text-neutral-100' : 'bg-neutral-100 text-neutral-900'
              }`}
            >
              {message}
            </div>
          )}

          {offlineCount > 0 && (
            <button
              type="button"
              onClick={retryOfflineQueue}
              className="mt-3 w-full rounded-2xl bg-amber-400 px-4 py-3 font-black text-black"
            >
              Upload offline queue ({offlineCount})
            </button>
          )}
        </section>

        <section className={`${panelClass} flex flex-1 flex-col overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-current/10 p-4">
            <div>
              <p className={`text-xs font-bold uppercase tracking-widest ${mutedText}`}>Basket</p>
              <p className="text-lg font-black">{totalItems} items</p>
            </div>
            <button
              type="button"
              onClick={clearSale}
              className="rounded-full bg-red-500 px-4 py-2 text-sm font-black text-white"
            >
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
              basket.map((line) => (
                <div
                  key={line.sku}
                  className={`rounded-3xl p-4 ${
                    darkMode ? 'bg-neutral-950' : 'bg-neutral-100'
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
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-black">{money(line.price * line.quantity)}</p>
                      <p className={`text-sm ${mutedText}`}>{money(line.price)} each</p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <div className="flex items-center rounded-full border border-current/20">
                      <button
                        type="button"
                        onClick={() => updateQty(line.sku, line.quantity - 1)}
                        className="px-4 py-2 text-xl font-black"
                      >
                        −
                      </button>
                      <span className="min-w-10 text-center font-black">{line.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateQty(line.sku, line.quantity + 1)}
                        className="px-4 py-2 text-xl font-black"
                      >
                        +
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => updateQty(line.sku, 0)}
                      className="rounded-full px-4 py-2 text-sm font-bold text-red-500"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className={`${panelClass} p-4 sm:p-5`}>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => {
                setDiscountPercent(5)
                setManualDiscount('')
              }}
              className="rounded-2xl border border-current/20 py-3 font-black"
            >
              5% off
            </button>
            <button
              type="button"
              onClick={() => {
                setDiscountPercent(10)
                setManualDiscount('')
              }}
              className="rounded-2xl border border-current/20 py-3 font-black"
            >
              10% off
            </button>
            <button
              type="button"
              onClick={() => {
                setDiscountPercent(0)
                setManualDiscount('')
              }}
              className="rounded-2xl border border-current/20 py-3 font-black"
            >
              No off
            </button>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2">
            <input
              value={manualDiscount}
              onChange={(event) => setManualDiscount(event.target.value)}
              placeholder="Manual discount £"
              className={
                darkMode
                  ? 'rounded-2xl border border-neutral-700 bg-neutral-950 px-4 py-3 font-bold outline-none'
                  : 'rounded-2xl border border-neutral-300 bg-white px-4 py-3 font-bold outline-none'
              }
              inputMode="decimal"
            />
            <button
              type="button"
              className="rounded-2xl border border-red-500/50 py-3 font-black text-red-500"
              onClick={() => setMessage('Refund flow not built yet. This button is reserved.')}
            >
              Refund
            </button>
          </div>

          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className={mutedText}>Subtotal</span>
              <span className="font-bold">{money(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className={mutedText}>Discount</span>
              <span className="font-bold">−{money(totalDiscount)}</span>
            </div>
            <div className="flex items-end justify-between pt-2">
              <span className="text-lg font-black">Total</span>
              <span className="text-4xl font-black tracking-tight">{money(total)}</span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setPaymentMethod('cash')}
              className={`rounded-3xl py-4 text-xl font-black ${
                paymentMethod === 'cash'
                  ? 'bg-white text-black'
                  : 'border border-current/20'
              }`}
            >
              Cash
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod('card')}
              className={`rounded-3xl py-4 text-xl font-black ${
                paymentMethod === 'card'
                  ? 'bg-white text-black'
                  : 'border border-current/20'
              }`}
            >
              Card
            </button>
          </div>

          {paymentMethod === 'cash' && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <input
                value={cashTendered}
                onChange={(event) => setCashTendered(event.target.value)}
                placeholder="Cash tendered"
                className={inputClass}
                inputMode="decimal"
              />
              <div
                className={`rounded-2xl p-3 text-right ${
                  darkMode ? 'bg-neutral-950' : 'bg-neutral-100'
                }`}
              >
                <p className={`text-xs font-bold uppercase tracking-widest ${mutedText}`}>
                  Change
                </p>
                <p className="text-2xl font-black">{money(changeDue)}</p>
              </div>
            </div>
          )}

          {paymentMethod === 'card' && (
            <div className={`mt-4 rounded-2xl p-3 text-sm font-semibold ${mutedText}`}>
              Card selected. Square Terminal push will be connected later; this currently queues the sale only.
            </div>
          )}

          <button
            type="button"
            disabled={!paymentMethod || basket.length === 0 || saleBusy}
            onClick={() => paymentMethod && completeSale(paymentMethod)}
            className="mt-4 w-full rounded-3xl bg-emerald-400 py-5 text-2xl font-black text-black disabled:opacity-40"
          >
            {saleBusy ? 'Saving…' : paymentMethod === 'cash' ? 'Complete Cash Sale' : paymentMethod === 'card' ? 'Complete Card Sale' : 'Select Payment'}
          </button>
        </section>
      </div>
    </main>
  )
}
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

type ItemRow = {
  id: string
  sku: string
  brand?: string | null
  reporting_category?: string | null
  sub_type?: string | null
  subtype?: string | null
  item_sub_type?: string | null
  colour?: string | null
  color?: string | null
  main_colour?: string | null
  final_title?: string | null
  basic_title?: string | null
  selling_price?: number | null
  stock_level?: number | null
  current_location?: string | null
  current_bin?: string | null
}

type BasketLine = {
  sku: string
  title: string
  brand: string
  category: string
  subType: string
  colour: string
  thumbnailUrl: string
  price: number
  quantity: number
  location: string
  bin: string
  stockLevel: number
  lineDiscountPercent: number
  originalLineId?: string
  maxRefundQuantity?: number
  isReturnLine?: boolean
}

type PaymentMethod = 'cash' | 'card' | null
type CheckoutMode = 'sale' | 'refund' | 'exchange'

const OFFLINE_TX_KEY = 'dohpe_pos_offline_transactions_v1'

function money(value: number) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(value || 0)
}

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function makeSaleNumber() {
  const date = new Date()
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `POS-${y}${m}${d}-${rand}`
}

function getOfflineTransactions(): any[] {
  if (typeof window === 'undefined') return []
  const saved = localStorage.getItem(OFFLINE_TX_KEY)
  if (!saved) return []

  try {
    const parsed = JSON.parse(saved)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function setOfflineTransactions(rows: any[]) {
  if (typeof window === 'undefined') return

  if (rows.length === 0) {
    localStorage.removeItem(OFFLINE_TX_KEY)
    return
  }

  localStorage.setItem(OFFLINE_TX_KEY, JSON.stringify(rows))
}

function getSubType(item: ItemRow) {
  return text(item.sub_type || item.subtype || item.item_sub_type)
}

function getColour(item: ItemRow) {
  return text(item.colour || item.color || item.main_colour)
}

function getLineTitle(item: ItemRow) {
  return item.final_title || item.basic_title || item.sku
}

function CardBadge({ children, className = '' }: { children: string; className?: string }) {
  return (
    <span className={`inline-flex h-5 min-w-9 items-center justify-center rounded bg-white px-1 text-[9px] font-black shadow-sm ${className}`}>
      {children}
    </span>
  )
}

export default function CheckoutPage() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const retryingRef = useRef(false)

  const [darkMode, setDarkMode] = useState(true)
  const [mode, setMode] = useState<CheckoutMode>('sale')
  const [scanValue, setScanValue] = useState('')
  const [basket, setBasket] = useState<BasketLine[]>([])
  const [selectedSku, setSelectedSku] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(null)
  const [basketDiscountPercent, setBasketDiscountPercent] = useState(0)
  const [cashTendered, setCashTendered] = useState('')
  const [message, setMessage] = useState('')
  const [saleBusy, setSaleBusy] = useState(false)
  const [loadingSku, setLoadingSku] = useState('')
  const [originalSale, setOriginalSale] = useState<any | null>(null)
  const [exchangeCredit, setExchangeCredit] = useState(0)

  const saleLines = basket.filter((line) => !line.isReturnLine)
  const returnLines = basket.filter((line) => line.isReturnLine)

  const saleSubtotal = useMemo(() => {
    return saleLines.reduce((sum, line) => sum + line.price * line.quantity, 0)
  }, [saleLines])

  const returnSubtotal = useMemo(() => {
    return returnLines.reduce((sum, line) => sum + line.price * line.quantity, 0)
  }, [returnLines])

  const lineDiscountTotal = useMemo(() => {
    return saleLines.reduce((sum, line) => {
      const lineSubtotal = line.price * line.quantity
      return sum + lineSubtotal * ((line.lineDiscountPercent || 0) / 100)
    }, 0)
  }, [saleLines])

  const basketPercentDiscountAmount = saleSubtotal * (basketDiscountPercent / 100)
  const totalDiscount = Math.min(saleSubtotal, lineDiscountTotal + basketPercentDiscountAmount)

  const subtotal = mode === 'exchange' ? saleSubtotal - exchangeCredit : saleSubtotal
  const total = mode === 'refund'
    ? returnSubtotal
    : Math.max(0, saleSubtotal - totalDiscount - exchangeCredit)

  const balanceDue = mode === 'exchange' ? saleSubtotal - exchangeCredit - totalDiscount : total
  const refundDue = mode === 'exchange' ? Math.max(0, -balanceDue) : 0
  const payableTotal = Math.max(0, balanceDue)
  const displayedTotal = mode === 'exchange' ? payableTotal : total

  const vatAmount = displayedTotal / 6
  const netAmount = displayedTotal - vatAmount
  const totalItems = basket.reduce((sum, line) => sum + line.quantity, 0)
  const changeDue = Math.max(0, (Number(cashTendered) || 0) - displayedTotal)
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

  const retryOfflineTransactions = useCallback(async () => {
    if (retryingRef.current) return

    const pending = getOfflineTransactions()
    if (pending.length === 0) return

    retryingRef.current = true

    try {
      const stillPending: any[] = []

      for (const tx of pending) {
        try {
          await writeTransactionOnline(tx)
        } catch {
          stillPending.push(tx)
        }
      }

      setOfflineTransactions(stillPending)
    } finally {
      retryingRef.current = false
    }
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
    retryOfflineTransactions()

    const handleOnline = () => retryOfflineTransactions()
    window.addEventListener('online', handleOnline)

    const interval = window.setInterval(() => {
      if (navigator.onLine) retryOfflineTransactions()
    }, 30000)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.clearInterval(interval)
    }
  }, [retryOfflineTransactions])

  async function getThumbnailUrl(itemId: string) {
    const { data } = await supabase
      .from('item_images')
      .select('processed_url, original_url')
      .eq('item_id', itemId)
      .order('image_order', { ascending: true })
      .limit(1)
      .maybeSingle()

    return text(data?.processed_url || data?.original_url)
  }

  async function loadSaleForRefund(saleNumber: string) {
    const confirmed = window.confirm(`Enter refund mode for receipt ${saleNumber}?`)
    if (!confirmed) return

    const { data: sale, error: saleError } = await supabase
      .from('pos_sales')
      .select('*')
      .eq('sale_number', saleNumber)
      .maybeSingle()

    if (saleError) throw new Error(saleError.message)
    if (!sale) {
      setMessage(`Receipt not found: ${saleNumber}`)
      return
    }

    const { data: lines, error: linesError } = await supabase
      .from('pos_sale_lines')
      .select('*')
      .eq('sale_id', sale.id)
      .order('created_at', { ascending: true })

    if (linesError) throw new Error(linesError.message)

    const refundLines: BasketLine[] = (lines || [])
      .map((line: any) => {
        const soldQty = Number(line.quantity || 0)
        const alreadyRefunded = Number(line.refunded_quantity || 0)
        const maxRefundQty = Math.max(0, soldQty - alreadyRefunded)

        return {
          sku: line.sku,
          title: line.title || line.sku,
          brand: line.brand || '',
          category: line.reporting_category || '',
          subType: line.sub_type || '',
          colour: line.colour || '',
          thumbnailUrl: '',
          price: Number(line.unit_price || 0),
          quantity: 0,
          location: 'SHOP-1',
          bin: 'SHOP-1',
          stockLevel: 0,
          lineDiscountPercent: Number(line.discount_percent || 0),
          originalLineId: line.id,
          maxRefundQuantity: maxRefundQty,
          isReturnLine: true,
        }
      })
      .filter((line: BasketLine) => Number(line.maxRefundQuantity || 0) > 0)

    clearSale(false)
    setOriginalSale(sale)
    setBasket(refundLines)
    setMode('refund')
    setPaymentMethod(null)
    setMessage('Select items and quantities to refund.')
  }

  async function addScannedSku(rawSku?: string) {
    const sku = text(rawSku || scanValue)
    if (!sku) return

    if (sku.toUpperCase().startsWith('POS-')) {
      setScanValue('')
      await loadSaleForRefund(sku.toUpperCase())
      return
    }

    setLoadingSku(sku)
    setMessage('')

    try {
      const { data, error } = await supabase
        .from('items')
        .select('*')
        .eq('sku', sku)
        .maybeSingle()

      if (error) throw new Error(error.message)

      if (!data) {
        setMessage(`SKU not found: ${sku}`)
        return
      }

      const item = data as ItemRow
      const price = Number(item.selling_price || 0)
      const thumbnailUrl = item.id ? await getThumbnailUrl(item.id) : ''

      setBasket((current) => {
        const existing = current.find(
          (line) => !line.isReturnLine && line.sku.toLowerCase() === sku.toLowerCase()
        )

        if (existing) {
          return current.map((line) =>
            !line.isReturnLine && line.sku.toLowerCase() === sku.toLowerCase()
              ? { ...line, quantity: line.quantity + 1 }
              : line
          )
        }

        return [
          ...current,
          {
            sku: item.sku,
            title: getLineTitle(item),
            brand: text(item.brand),
            category: text(item.reporting_category),
            subType: getSubType(item),
            colour: getColour(item),
            thumbnailUrl,
            price,
            quantity: 1,
            location: item.current_location || 'SHOP-1',
            bin: item.current_bin || item.current_location || 'SHOP-1',
            stockLevel: Number(item.stock_level || 0),
            lineDiscountPercent: 0,
            isReturnLine: false,
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

  function hasLineDiscounts() {
    return basket.some((line) => !line.isReturnLine && line.lineDiscountPercent > 0)
  }

  function applyPercentDiscount(percent: number) {
    if (mode !== 'sale') {
      setMessage('Discounts only apply to normal sales.')
      return
    }

    if (selectedLine && !selectedLine.isReturnLine) {
      if (basketDiscountPercent > 0) {
        setMessage('Remove the basket discount before applying an item discount.')
        return
      }

      setBasket((current) =>
        current.map((line) =>
          line.sku === selectedLine.sku && !line.isReturnLine
            ? { ...line, lineDiscountPercent: percent }
            : line
        )
      )
      setMessage(`${percent}% discount applied to ${selectedLine.sku}.`)
      return
    }

    if (hasLineDiscounts()) {
      setMessage('Remove item discounts before applying a whole basket discount.')
      return
    }

    const confirmed = window.confirm(
      `${percent}% will be applied to the WHOLE basket. Select an item first if this is item-only. Continue?`
    )

    if (!confirmed) return

    setBasketDiscountPercent(percent)
    setMessage(`${percent}% discount applied to whole basket.`)
  }

  function updateQty(line: BasketLine, nextQty: number) {
    if (line.isReturnLine) {
      const max = Number(line.maxRefundQuantity || 0)
      const safeQty = Math.max(0, Math.min(nextQty, max))

      setBasket((current) =>
        current.map((row) =>
          row.originalLineId === line.originalLineId ? { ...row, quantity: safeQty } : row
        )
      )
      return
    }

    if (nextQty <= 0) {
      setBasket((current) => current.filter((row) => row.sku !== line.sku || row.isReturnLine))
      if (selectedSku === line.sku) setSelectedSku('')
      return
    }

    setBasket((current) =>
      current.map((row) =>
        row.sku === line.sku && !row.isReturnLine ? { ...row, quantity: nextQty } : row
      )
    )
  }

  function clearSale(resetMode = true) {
    setBasket([])
    setSelectedSku('')
    setPaymentMethod(null)
    setBasketDiscountPercent(0)
    setCashTendered('')
    setMessage('')
    setOriginalSale(null)
    setExchangeCredit(0)
    if (resetMode) setMode('sale')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function buildTransaction(method: 'cash' | 'card', action: 'sale' | 'refund' | 'exchange') {
    const saleNumber = makeSaleNumber()
    const saleId = crypto.randomUUID()
    const now = new Date().toISOString()

    const returnValue = returnLines.reduce((sum, line) => sum + line.price * line.quantity, 0)
    const saleValue = saleLines.reduce((sum, line) => sum + line.price * line.quantity, 0)

    const queueRows: any[] = []

    for (const line of returnLines.filter((row) => row.quantity > 0)) {
      queueRows.push({
        sku: line.sku,
        action: 'adjust_stock',
        payload: {
          sku: line.sku,
          delta: line.quantity,
          reason: action === 'exchange' ? 'pos_exchange_return' : 'pos_refund',
          payment_method: method,
          sale_id: saleId,
          sale_number: saleNumber,
          original_sale_id: originalSale?.id || null,
          quantity: line.quantity,
          total: Number(returnValue.toFixed(2)),
          location: line.location,
          bin: line.bin,
          local_first: true,
        },
        status: 'pending',
      })
    }

    for (const line of saleLines.filter((row) => row.quantity > 0)) {
      queueRows.push({
        sku: line.sku,
        action: 'adjust_stock',
        payload: {
          sku: line.sku,
          delta: -line.quantity,
          reason: action === 'exchange' ? 'pos_exchange_sale' : method === 'cash' ? 'pos_cash_sale' : 'pos_card_sale',
          payment_method: method,
          sale_id: saleId,
          sale_number: saleNumber,
          quantity: line.quantity,
          total: Number(displayedTotal.toFixed(2)),
          location: line.location,
          bin: line.bin,
          local_first: true,
        },
        status: 'pending',
      })
    }

    return {
      id: saleId,
      sale_number: saleNumber,
      mode: action,
      payment_method: method,
      original_sale_id: originalSale?.id || null,
      subtotal: Number(saleValue.toFixed(2)),
      discount_amount: Number(totalDiscount.toFixed(2)),
      total: Number(displayedTotal.toFixed(2)),
      vat_amount: Number(vatAmount.toFixed(2)),
      net_amount: Number(netAmount.toFixed(2)),
      cash_tendered: method === 'cash' ? Number(cashTendered || 0) : null,
      change_due: method === 'cash' ? Number(changeDue.toFixed(2)) : null,
      exchange_credit: Number(exchangeCredit.toFixed(2)),
      refund_method: action === 'refund' ? method : null,
      square_status: method === 'card' ? 'manual_terminal_payment_recorded' : 'not_required',
      status: 'completed',
      created_at: now,
      updated_at: now,
      lines: basket
        .filter((line) => line.quantity > 0)
        .map((line) => ({
          sale_id: saleId,
          sku: line.sku,
          title: line.title,
          brand: line.brand,
          reporting_category: line.category,
          sub_type: line.subType,
          colour: line.colour,
          quantity: line.quantity,
          unit_price: Number(line.price.toFixed(2)),
          line_total: Number((line.price * line.quantity).toFixed(2)),
          discount_percent: line.lineDiscountPercent,
          discount_amount: Number(((line.price * line.quantity) * (line.lineDiscountPercent / 100)).toFixed(2)),
          original_line_id: line.originalLineId || null,
          max_refundable_quantity: line.isReturnLine ? line.maxRefundQuantity || line.quantity : line.quantity,
        })),
      queueRows,
    }
  }

  async function writeTransactionOnline(tx: any) {
    const { lines, queueRows, ...sale } = tx

    const { error: saleError } = await supabase.from('pos_sales').insert(sale)
    if (saleError) throw new Error(saleError.message)

    if (lines.length > 0) {
      const { error: linesError } = await supabase.from('pos_sale_lines').insert(lines)
      if (linesError) throw new Error(linesError.message)
    }

    if (queueRows.length > 0) {
      const { error: queueError } = await supabase.from('linnworks_sync_queue').insert(queueRows)
      if (queueError) throw new Error(queueError.message)
    }

    for (const line of lines.filter((line: any) => line.original_line_id)) {
      const { data: originalLine } = await supabase
        .from('pos_sale_lines')
        .select('refunded_quantity')
        .eq('id', line.original_line_id)
        .maybeSingle()

      const currentRefunded = Number(originalLine?.refunded_quantity || 0)

      await supabase
        .from('pos_sale_lines')
        .update({ refunded_quantity: currentRefunded + Number(line.quantity || 0) })
        .eq('id', line.original_line_id)
    }
  }

  async function saveTransaction(tx: any) {
    try {
      await writeTransactionOnline(tx)
    } catch {
      const pending = getOfflineTransactions()
      setOfflineTransactions([...pending, tx])
    }
  }

  async function completeSale(method: 'cash' | 'card') {
    if (basket.length === 0) {
      setMessage('Basket is empty.')
      return
    }

    if (mode === 'refund' && returnLines.every((line) => line.quantity <= 0)) {
      setMessage('Select at least one item and quantity to refund.')
      return
    }

    if (mode === 'sale' && method === 'cash' && Number(cashTendered || 0) < displayedTotal) {
      setMessage('Cash tendered is less than total.')
      return
    }

    setSaleBusy(true)

    try {
      const action: 'sale' | 'refund' | 'exchange' = mode
      const tx = buildTransaction(method, action)

      await saveTransaction(tx)

      if (method === 'card' && (mode === 'refund' || refundDue > 0)) {
        setMessage('Card refund recorded. Square refund API still needs connecting.')
      } else if (mode === 'exchange') {
        setMessage(`Exchange recorded. Receipt: ${tx.sale_number}`)
      } else if (mode === 'refund') {
        setMessage(`Refund recorded. Receipt: ${tx.sale_number}`)
      } else {
        setMessage(`Sale recorded. Receipt: ${tx.sale_number}`)
      }

      clearSale()
      retryOfflineTransactions()
    } catch (error: any) {
      setMessage(error.message || 'Could not complete transaction.')
    } finally {
      setSaleBusy(false)
    }
  }

  function beginExchange() {
    const selectedReturns = returnLines.filter((line) => line.quantity > 0)
    if (selectedReturns.length === 0) {
      setMessage('Select at least one item and quantity to exchange.')
      return
    }

    const credit = selectedReturns.reduce((sum, line) => sum + line.price * line.quantity, 0)

    setBasket(selectedReturns)
    setExchangeCredit(credit)
    setMode('exchange')
    setPaymentMethod(null)
    setMessage(`Exchange credit applied: ${money(credit)}. Scan replacement items.`)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  return (
    <main className={pageClass}>
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-3 p-3 sm:p-5">
        <section className={`${panelClass} p-4`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black tracking-tight">
                {mode === 'refund' ? 'Refund' : mode === 'exchange' ? 'Exchange' : 'Checkout'}
              </h1>
              <p className={`text-sm ${mutedText}`}>
                {mode === 'refund'
                  ? 'Select items and quantities to refund.'
                  : selectedLine
                    ? `Discount target: ${selectedLine.sku}`
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
              placeholder="Scan SKU or receipt barcode"
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
          <div className="flex items-center justify-between border-b border-current/10 px-4 py-3">
            <div>
              <p className={`text-xs font-bold uppercase tracking-widest ${mutedText}`}>Basket</p>
              <p className="text-base font-black">{totalItems} items</p>
            </div>
            <button
              type="button"
              onClick={() => clearSale()}
              className="rounded-full bg-red-500 px-4 py-2 text-sm font-black text-white"
            >
              Clear
            </button>
          </div>

          <div className="flex-1 space-y-2 overflow-auto p-2">
            {basket.length === 0 ? (
              <div className={`rounded-3xl p-8 text-center ${mutedText}`}>
                <p className="text-lg font-bold">No items scanned yet</p>
                <p className="text-sm">Scan SKU or receipt barcode.</p>
              </div>
            ) : (
              basket.map((line) => {
                const key = line.originalLineId || line.sku
                const isSelected = selectedSku === key
                const maxRefund = Number(line.maxRefundQuantity || 0)

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedSku(isSelected ? '' : key)}
                    className={`w-full rounded-2xl p-2 text-left ${
                      isSelected
                        ? 'bg-emerald-500/20 ring-2 ring-emerald-400'
                        : darkMode
                          ? 'bg-neutral-950'
                          : 'bg-neutral-100'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-neutral-800">
                        {line.thumbnailUrl ? (
                          <img src={line.thumbnailUrl} alt={line.sku} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-neutral-400">
                            NO IMG
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black">{line.brand || 'Unknown Brand'}</p>
                            <p className={`truncate text-xs ${mutedText}`}>
                              {[line.category, line.subType, line.colour].filter(Boolean).join(' · ') || line.title}
                            </p>
                            <p className={`truncate text-[11px] ${mutedText}`}>{line.sku}</p>
                          </div>

                          <div className="shrink-0 text-right">
                            <p className="text-base font-black">
                              {line.isReturnLine ? '-' : ''}
                              {money(line.price * line.quantity)}
                            </p>
                            <p className={`text-[11px] ${mutedText}`}>{money(line.price)} each</p>
                          </div>
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-2">
                          <div className="flex items-center rounded-full border border-current/20">
                            <span
                              onClick={(event) => {
                                event.stopPropagation()
                                updateQty(line, line.quantity - 1)
                              }}
                              className="px-3 py-1 text-lg font-black"
                            >
                              −
                            </span>
                            <span className="min-w-8 text-center text-sm font-black">{line.quantity}</span>
                            <span
                              onClick={(event) => {
                                event.stopPropagation()
                                updateQty(line, line.quantity + 1)
                              }}
                              className="px-3 py-1 text-lg font-black"
                            >
                              +
                            </span>
                          </div>

                          {line.isReturnLine && (
                            <span className={`text-xs font-bold ${mutedText}`}>Max {maxRefund}</span>
                          )}

                          {line.lineDiscountPercent > 0 && (
                            <span className="text-xs font-black text-emerald-400">{line.lineDiscountPercent}% off</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </section>

        <section className={`${panelClass} p-4`}>
          {mode === 'sale' && (
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => applyPercentDiscount(5)} className="rounded-2xl border border-current/20 py-3 font-black">
                5% off
              </button>
              <button type="button" onClick={() => applyPercentDiscount(10)} className="rounded-2xl border border-current/20 py-3 font-black">
                10% off
              </button>
            </div>
          )}

          <div className="space-y-1 text-sm">
            {mode === 'exchange' && (
              <div className="flex justify-between">
                <span className={mutedText}>Exchange credit</span>
                <span className="font-bold">−{money(exchangeCredit)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className={mutedText}>Subtotal</span>
              <span className="font-bold">{money(mode === 'refund' ? returnSubtotal : saleSubtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className={mutedText}>Discount</span>
              <span className="font-bold">−{money(totalDiscount)}</span>
            </div>
            <div className="flex justify-between">
              <span className={mutedText}>Net</span>
              <span className="font-bold">{money(netAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className={mutedText}>VAT included at 20%</span>
              <span className="font-bold">{money(vatAmount)}</span>
            </div>
            {mode === 'exchange' && refundDue > 0 && (
              <div className="flex justify-between text-red-400">
                <span>Refund due</span>
                <span className="font-black">{money(refundDue)}</span>
              </div>
            )}
            <div className="flex items-end justify-between pt-2">
              <span className="text-lg font-black">
                {mode === 'refund' ? 'Refund total' : mode === 'exchange' ? 'Balance due' : 'Total'}
              </span>
              <span className="text-4xl font-black tracking-tight">{money(displayedTotal)}</span>
            </div>
          </div>

          {mode === 'refund' ? (
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button type="button" onClick={() => completeSale('cash')} className="rounded-3xl bg-green-100 py-4 text-sm font-black text-black">
                CASH REFUND
              </button>
              <button type="button" onClick={() => completeSale('card')} className="rounded-3xl bg-sky-100 py-4 text-sm font-black text-black">
                CARD REFUND
              </button>
              <button type="button" onClick={beginExchange} className="rounded-3xl bg-amber-100 py-4 text-sm font-black text-black">
                EXCHANGE
              </button>
            </div>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('cash')}
                  className={`rounded-3xl py-4 text-xl font-black ${
                    paymentMethod === 'cash'
                      ? 'bg-green-300 text-black ring-4 ring-green-500/40'
                      : 'bg-green-100 text-black'
                  }`}
                >
                  CASH <span className="text-2xl">💷</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod('card')}
                  className={`rounded-3xl py-4 text-xl font-black ${
                    paymentMethod === 'card'
                      ? 'bg-sky-300 text-black ring-4 ring-sky-500/40'
                      : 'bg-sky-100 text-black'
                  }`}
                >
                  <span className="inline-flex flex-wrap items-center justify-center gap-1">
                    CARD
                    <CardBadge className="text-blue-700">VISA</CardBadge>
                    <CardBadge className="text-red-600">MC</CardBadge>
                    <CardBadge className="text-sky-700">AMEX</CardBadge>
                  </span>
                </button>
              </div>

              {paymentMethod === 'cash' && displayedTotal > 0 && (
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <input
                    value={cashTendered}
                    onChange={(event) => setCashTendered(event.target.value)}
                    placeholder="Cash tendered"
                    className={inputClass}
                    inputMode="decimal"
                  />
                  <div className={`rounded-2xl p-3 text-right ${darkMode ? 'bg-neutral-950' : 'bg-neutral-100'}`}>
                    <p className={`text-xs font-bold uppercase tracking-widest ${mutedText}`}>Change</p>
                    <p className="text-2xl font-black">{money(changeDue)}</p>
                  </div>
                </div>
              )}

              <button
                type="button"
                disabled={!paymentMethod || basket.length === 0 || saleBusy}
                onClick={() => paymentMethod && completeSale(paymentMethod)}
                className="mt-4 w-full rounded-3xl bg-emerald-400 py-5 text-2xl font-black text-black disabled:opacity-40"
              >
                {saleBusy
                  ? 'Saving…'
                  : mode === 'exchange'
                    ? 'Complete Exchange'
                    : paymentMethod === 'cash'
                      ? 'Complete Cash Sale'
                      : paymentMethod === 'card'
                        ? 'Record Card Sale'
                        : 'Select Payment'}
              </button>
            </>
          )}

          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => {
                const receipt = window.prompt('Scan or enter receipt barcode')
                if (!receipt) return
                loadSaleForRefund(receipt.trim().toUpperCase())
              }}
              className="text-xs font-bold text-red-500 underline"
            >
              Refund / exchange receipt
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}
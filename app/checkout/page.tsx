'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'

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
type CardPanelState = 'options' | 'waiting' | 'unclear'
type PaymentResultType = 'success' | 'failed' | null

type CardPaymentDetails = {
  payment_provider?: string
  square_status?: string
  square_checkout_id?: string | null
  square_payment_id?: string | null
  square_payment_status?: string | null
  square_receipt_url?: string | null
  square_terminal_device_id?: string | null
  square_refund_id?: string | null
  square_refund_status?: string | null
  payment_reference?: string | null
  payment_confirmed_at?: string | null
  manual_payment_reason?: string | null
}

type HistoryLine = {
  id: string
  sale_id: string
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
  created_at: string
}

type HistorySale = {
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
  square_checkout_id: string | null
  square_payment_id: string | null
  square_payment_status: string | null
  square_receipt_url: string | null
  square_terminal_device_id: string | null
  square_refund_id?: string | null
  square_refund_status?: string | null
  payment_provider: string | null
  payment_reference: string | null
  payment_confirmed_at: string | null
  manual_payment_reason: string | null
  status: string | null
  original_sale_id: string | null
  exchange_credit: number | null
  refund_method: string | null
  checkout_location: string | null
  created_at: string
  updated_at: string | null
  activity_at?: string | null
  original_sale?: HistorySale | null
  related_sales?: HistorySale[]
  returned_qty_by_original_line_id?: Record<string, number>
  lines: HistoryLine[]
}

const OFFLINE_TX_KEY = 'dohpe_pos_offline_transactions_v1'
const CHECKOUT_LOCATION_KEY = 'dohpe_checkout_location_v1'

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

function formatDateTime(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function getSavedCheckoutLocation() {
  if (typeof window === 'undefined') return 'SHOP-1'
  return localStorage.getItem(CHECKOUT_LOCATION_KEY) || 'SHOP-1'
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

  const deduped = rows.filter((tx, index, all) => {
    const key = tx?.id || tx?.sale_number
    if (!key) return true
    return all.findIndex((row) => (row?.id || row?.sale_number) === key) === index
  })

  if (deduped.length === 0) {
    localStorage.removeItem(OFFLINE_TX_KEY)
    return
  }

  localStorage.setItem(OFFLINE_TX_KEY, JSON.stringify(deduped))
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

function CardLogos() {
  return (
    <img
      src="https://www.americanexpress.com/content/dam/amex/us/merchant/supplies-uplift/product/images/4_Card_color_horizontal.png"
      alt="Card payments"
      className="h-7 w-auto rounded-md bg-white"
    />
  )
}

export default function CheckoutPage() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const retryingRef = useRef(false)
  const paymentResultTimerRef = useRef<number | null>(null)

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
  const [checkoutLocation, setCheckoutLocation] = useState('SHOP-1')
  const [cardPanelOpen, setCardPanelOpen] = useState(false)
  const [cardPanelState, setCardPanelState] = useState<CardPanelState>('options')
  const [cardPanelMessage, setCardPanelMessage] = useState('')
  const [paymentResultType, setPaymentResultType] = useState<PaymentResultType>(null)
  const [paymentResultTitle, setPaymentResultTitle] = useState('')
  const [paymentResultMessage, setPaymentResultMessage] = useState('')

  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyMessage, setHistoryMessage] = useState('')
  const [historyQuery, setHistoryQuery] = useState('')
  const [historyDateFrom, setHistoryDateFrom] = useState('')
  const [historyDateTo, setHistoryDateTo] = useState('')
  const [historyPaymentMethod, setHistoryPaymentMethod] = useState('')
  const [historyMode, setHistoryMode] = useState('')
  const [historySales, setHistorySales] = useState<HistorySale[]>([])
  const [expandedHistorySaleId, setExpandedHistorySaleId] = useState('')

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

  const total =
    mode === 'refund'
      ? returnSubtotal
      : Math.max(0, saleSubtotal - totalDiscount - exchangeCredit)

  const balanceDue =
    mode === 'exchange' ? saleSubtotal - exchangeCredit - totalDiscount : total

  const refundDue = mode === 'exchange' ? Math.max(0, -balanceDue) : 0
  const payableTotal = Math.max(0, balanceDue)
  const displayedTotal = mode === 'exchange' ? payableTotal : total

  const vatAmount = displayedTotal / 6
  const netAmount = displayedTotal - vatAmount
  const totalItems = basket.reduce((sum, line) => sum + line.quantity, 0)
  const changeDue = Math.max(0, (Number(cashTendered) || 0) - displayedTotal)
  const selectedLine = basket.find((line) => line.sku === selectedSku)

  const pageClass = 'min-h-screen bg-neutral-100 text-neutral-950'
  const panelClass = 'rounded-3xl border border-neutral-200 bg-white shadow-xl'
  const mutedText = 'text-neutral-500'
  const inputClass =
    'w-full rounded-2xl border border-neutral-300 bg-white px-4 py-4 text-xl font-semibold outline-none focus:border-black'

  useEffect(() => {
    setCheckoutLocation(getSavedCheckoutLocation())
  }, [])

  useEffect(() => {
    return () => {
      if (paymentResultTimerRef.current) {
        window.clearTimeout(paymentResultTimerRef.current)
      }
    }
  }, [])

  function showPaymentResult(type: Exclude<PaymentResultType, null>, title: string, body: string) {
    if (paymentResultTimerRef.current) {
      window.clearTimeout(paymentResultTimerRef.current)
    }

    setPaymentResultType(type)
    setPaymentResultTitle(title)
    setPaymentResultMessage(body)

    paymentResultTimerRef.current = window.setTimeout(() => {
      setPaymentResultType(null)
      setPaymentResultTitle('')
      setPaymentResultMessage('')
    }, 6000)
  }

  async function writeTransactionOnline(tx: any) {
    const response = await fetch('/api/pos/save-transaction', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(tx),
    })

    const data = await response.json().catch(() => null)

    if (!response.ok || !data?.ok) {
      throw new Error(data?.message || 'POS transaction API failed.')
    }

    return data
  }

  const retryOfflineTransactions = useCallback(async () => {
    if (retryingRef.current) return

    const pending = getOfflineTransactions()
    if (pending.length === 0) return

    retryingRef.current = true

    try {
      const stillPending: any[] = []
      const completedKeys = new Set<string>()

      for (const tx of pending) {
        const key = text(tx?.id || tx?.sale_number)

        if (key && completedKeys.has(key)) {
          continue
        }

        try {
          const result = await writeTransactionOnline(tx)

          if (result?.ok) {
            if (key) completedKeys.add(key)
            continue
          }

          stillPending.push(tx)
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

  function saveCheckoutLocation(value: string) {
    const clean = text(value) || 'SHOP-1'
    setCheckoutLocation(clean)
    localStorage.setItem(CHECKOUT_LOCATION_KEY, clean)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

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

  async function lookupSaleForRefund(saleNumber: string) {
    const response = await fetch(
      `/api/pos/lookup-sale?sale_number=${encodeURIComponent(saleNumber)}`
    )

    const data = await response.json().catch(() => null)

    if (!response.ok || !data?.ok) {
      throw new Error(data?.message || `Receipt not found: ${saleNumber}`)
    }

    return {
      sale: data.sale,
      lines: Array.isArray(data.lines) ? data.lines : [],
    }
  }

  async function loadSaleForRefund(saleNumber: string) {
    const cleanSaleNumber = text(saleNumber).toUpperCase()

    if (!cleanSaleNumber) return

    const confirmed = window.confirm(`Enter refund mode for receipt ${cleanSaleNumber}?`)
    if (!confirmed) return

    try {
      const { sale, lines } = await lookupSaleForRefund(cleanSaleNumber)
      const returnLocation = checkoutLocation || 'SHOP-1'

      const refundLines: BasketLine[] = lines
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
            location: returnLocation,
            bin: returnLocation,
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
      setHistoryOpen(false)

      if (refundLines.length === 0) {
        setMessage('This receipt has no refundable items left.')
      } else {
        setMessage('Select items and quantities to refund.')
      }
    } catch (error: any) {
      setMessage(error.message || `Receipt not found: ${cleanSaleNumber}`)
    }
  }

  async function fetchHistory() {
    setHistoryBusy(true)
    setHistoryMessage('')

    try {
      const params = new URLSearchParams()
      params.set('limit', '50')

      if (historyQuery.trim()) params.set('query', historyQuery.trim())
      if (historyDateFrom) params.set('date_from', historyDateFrom)
      if (historyDateTo) params.set('date_to', historyDateTo)
      if (historyPaymentMethod) params.set('payment_method', historyPaymentMethod)
      if (historyMode) params.set('mode', historyMode)

      const response = await fetch(`/api/pos/history?${params.toString()}`)
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not load POS history.')
      }

      const sales = Array.isArray(data.sales) ? data.sales : []
      setHistorySales(sales)
      setExpandedHistorySaleId(sales[0]?.id || '')

      if (sales.length === 0) {
        setHistoryMessage('No sales found.')
      }
    } catch (error: any) {
      setHistoryMessage(error.message || 'Could not load POS history.')
    } finally {
      setHistoryBusy(false)
    }
  }

  function openHistory() {
    setHistoryOpen(true)
    setTimeout(() => {
      fetchHistory()
    }, 50)
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
      const activeLocation = checkoutLocation || item.current_location || 'SHOP-1'

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
            location: activeLocation,
            bin: activeLocation,
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

  function closeCardPanel() {
    setCardPanelOpen(false)
    setCardPanelState('options')
    setCardPanelMessage('')
    setPaymentMethod(null)
    setTimeout(() => inputRef.current?.focus(), 50)
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
    setCardPanelOpen(false)
    setCardPanelState('options')
    setCardPanelMessage('')
    if (resetMode) setMode('sale')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function getCardRefundAmount() {
    if (mode === 'refund') return returnSubtotal
    if (mode === 'exchange') return refundDue
    return 0
  }

  async function callSquareRefund(amount: number) {
    const originalPaymentId = text(originalSale?.square_payment_id)

    if (!originalPaymentId) {
      throw new Error('Original sale does not have a Square payment ID.')
    }

    const response = await fetch('/api/pos/square-refund', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        payment_id: originalPaymentId,
        amount,
        currency: 'GBP',
        sale_number: originalSale?.sale_number || '',
        reason: `POS refund for ${originalSale?.sale_number || originalPaymentId}`,
      }),
    })

    const data = await response.json().catch(() => null)

    if (!response.ok || !data?.ok) {
      throw new Error(data?.message || 'Square refund failed.')
    }

    return data
  }

  function buildTransaction(
    method: 'cash' | 'card',
    action: 'sale' | 'refund' | 'exchange',
    cardDetails?: CardPaymentDetails
  ) {
    const saleNumber = makeSaleNumber()
    const saleId = crypto.randomUUID()
    const now = new Date().toISOString()

    const returnValue = returnLines.reduce((sum, line) => sum + line.price * line.quantity, 0)
    const saleValue = saleLines.reduce((sum, line) => sum + line.price * line.quantity, 0)
    const activeReturnLocation = checkoutLocation || 'SHOP-1'

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
          location: line.location || activeReturnLocation,
          bin: line.bin || activeReturnLocation,
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
          reason:
            action === 'exchange'
              ? 'pos_exchange_sale'
              : method === 'cash'
                ? 'pos_cash_sale'
                : 'pos_card_sale',
          payment_method: method,
          sale_id: saleId,
          sale_number: saleNumber,
          quantity: line.quantity,
          total: Number(displayedTotal.toFixed(2)),
          location: line.location || checkoutLocation || 'SHOP-1',
          bin: line.bin || checkoutLocation || 'SHOP-1',
          local_first: true,
        },
        status: 'pending',
      })
    }

    const defaultCardDetails: CardPaymentDetails =
      method === 'card'
        ? {
            payment_provider: 'square_manual',
            square_status: 'manual_terminal_payment_recorded',
            manual_payment_reason: 'manual_card_entry',
            payment_confirmed_at: now,
          }
        : {
            payment_provider: 'none',
            square_status: 'not_required',
          }

    const finalCardDetails =
      method === 'card'
        ? {
            ...defaultCardDetails,
            ...(cardDetails || {}),
          }
        : defaultCardDetails

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
      square_status: finalCardDetails.square_status || 'not_required',
      square_checkout_id: finalCardDetails.square_checkout_id || null,
      square_payment_id: finalCardDetails.square_payment_id || null,
      square_payment_status: finalCardDetails.square_payment_status || null,
      square_receipt_url: finalCardDetails.square_receipt_url || null,
      square_terminal_device_id: finalCardDetails.square_terminal_device_id || null,
      square_refund_id: finalCardDetails.square_refund_id || null,
      square_refund_status: finalCardDetails.square_refund_status || null,
      payment_provider: finalCardDetails.payment_provider || 'none',
      payment_reference: finalCardDetails.payment_reference || null,
      payment_confirmed_at: finalCardDetails.payment_confirmed_at || null,
      manual_payment_reason: finalCardDetails.manual_payment_reason || null,
      status: 'completed',
      checkout_location: checkoutLocation || 'SHOP-1',
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
          discount_amount: Number(
            ((line.price * line.quantity) * (line.lineDiscountPercent / 100)).toFixed(2)
          ),
          original_line_id: line.originalLineId || null,
          max_refundable_quantity: line.isReturnLine
            ? line.maxRefundQuantity || line.quantity
            : line.quantity,
        })),
      queueRows,
    }
  }

  async function saveTransaction(tx: any) {
    try {
      await writeTransactionOnline(tx)
    } catch (error: any) {
      console.error('POS_TRANSACTION_SAVE_FAILED', error)

      const pending = getOfflineTransactions()
      const key = text(tx?.id || tx?.sale_number)
      const alreadyPending = key
        ? pending.some((row) => text(row?.id || row?.sale_number) === key)
        : false

      if (!alreadyPending) {
        setOfflineTransactions([...pending, tx])
      }

      throw error
    }
  }

  async function completeSale(method: 'cash' | 'card', cardDetails?: CardPaymentDetails) {
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
      const tx = buildTransaction(method, action, cardDetails)

      await saveTransaction(tx)

      clearSale()

      if (method === 'card' && (mode === 'refund' || refundDue > 0)) {
        setMessage(`Card refund recorded. Receipt: ${tx.sale_number}`)
      } else if (mode === 'exchange') {
        setMessage(`Exchange recorded. Receipt: ${tx.sale_number}`)
      } else if (mode === 'refund') {
        setMessage(`Refund recorded. Receipt: ${tx.sale_number}`)
      } else {
        setMessage(`Sale recorded. Receipt: ${tx.sale_number}`)
      }

      if (method === 'card') {
        showPaymentResult(
          'success',
          mode === 'refund' || refundDue > 0 ? 'Refund Succeeded' : 'Payment Succeeded',
          `Card transaction recorded. Receipt: ${tx.sale_number}`
        )
      }

      retryOfflineTransactions()
    } catch (error: any) {
      const errorMessage = error.message || 'Could not complete transaction.'
      setMessage(errorMessage)

      if (method === 'card') {
        setCardPanelOpen(true)
        setCardPanelState('unclear')
        setCardPanelMessage(
          `App offline / save failed. If the card payment has completed on the card reader, press Record Manual Sale so the sale is stored locally and synced later. Error: ${errorMessage}`
        )
        showPaymentResult('failed', 'Payment Record Failed', errorMessage)
      }
    } finally {
      setSaleBusy(false)
    }
  }

  async function completeCardRefund() {
    if (returnLines.every((line) => line.quantity <= 0)) {
      setMessage('Select at least one item and quantity to refund.')
      return
    }

    const refundAmount = getCardRefundAmount()

    if (refundAmount <= 0) {
      setMessage('Card refund amount must be more than £0.')
      return
    }

    const originalPaymentId = text(originalSale?.square_payment_id)
    const now = new Date().toISOString()

    if (originalPaymentId) {
      const confirmed = window.confirm(
        `Refund ${money(refundAmount)} back to the original Square card payment?`
      )

      if (!confirmed) return

      setSaleBusy(true)
      setMessage('Sending refund to Square...')

      try {
        const squareRefund = await callSquareRefund(refundAmount)

        await completeSale('card', {
          payment_provider: 'square',
          square_status: 'square_refund_completed',
          square_payment_id: originalPaymentId,
          square_payment_status: originalSale?.square_payment_status || null,
          square_receipt_url: originalSale?.square_receipt_url || null,
          square_terminal_device_id: originalSale?.square_terminal_device_id || null,
          square_refund_id: squareRefund.refund_id || null,
          square_refund_status: squareRefund.status || null,
          payment_reference: squareRefund.refund_id || originalPaymentId,
          payment_confirmed_at: now,
          manual_payment_reason: null,
        })
      } catch (error: any) {
        const errorMessage = error.message || 'Square refund failed.'
        setMessage(errorMessage)
        showPaymentResult('failed', 'Refund Failed', errorMessage)
      } finally {
        setSaleBusy(false)
      }

      return
    }

    const confirmedManual = window.confirm(
      `This original sale does not have a Square payment ID, so the app cannot refund it automatically.\n\nRefund ${money(
        refundAmount
      )} manually using Square receipt/dashboard/terminal first, then press OK to record the refund in POS.`
    )

    if (!confirmedManual) return

    await completeSale('card', {
      payment_provider: 'square_manual',
      square_status: 'manual_square_refund_recorded',
      square_payment_status: 'MANUAL_REFUND_CONFIRMED',
      square_refund_id: null,
      square_refund_status: 'MANUAL',
      payment_reference: null,
      payment_confirmed_at: now,
      manual_payment_reason: 'manual_card_refund_confirmed_by_staff',
    })
  }

  function openCardPanel() {
    if (basket.length === 0) {
      setMessage('Basket is empty.')
      return
    }

    if (displayedTotal <= 0) {
      setMessage('Card total must be more than £0.')
      return
    }

    setPaymentMethod('card')
    setCardPanelState('options')
    setCardPanelMessage('')
    setCardPanelOpen(true)
  }

  async function completeManualCardSale() {
    const confirmed = window.confirm(
      `Record this card sale manually for ${money(displayedTotal)}?\n\nOnly continue if payment has definitely been taken on the card machine.`
    )

    if (!confirmed) return

    const now = new Date().toISOString()

    setCardPanelMessage('Recording manual card sale...')

    await completeSale('card', {
      payment_provider: 'square_manual',
      square_status: 'manual_terminal_payment_recorded',
      square_payment_status: 'MANUAL_CONFIRMED',
      payment_reference: null,
      payment_confirmed_at: now,
      manual_payment_reason: 'manual_card_entry_confirmed_by_staff',
    })
  }

  function cancelCardPayment() {
    const confirmed = window.confirm(
      'Cancel card payment and return to checkout?\n\nNo sale will be recorded.'
    )

    if (!confirmed) return

    showPaymentResult('failed', 'Payment Cancelled', 'No sale was recorded.')
    closeCardPanel()
  }

  async function sendTotalToSquareTerminal() {
    if (basket.length === 0) {
      setCardPanelMessage('Basket is empty.')
      return
    }

    setCardPanelState('waiting')
    setCardPanelMessage('Sending total to Square Terminal...')

    try {
      const response = await fetch('/api/pos/square-terminal-checkout', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          amount: Number(displayedTotal.toFixed(2)),
          currency: 'GBP',
          checkout_location: checkoutLocation || 'SHOP-1',
          mode,
          item_count: totalItems,
        }),
      })

      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'No successful response from Square Terminal.')
      }

      const status = text(data.status || data.square_status || data.checkout_status).toLowerCase()

      if (['paid', 'completed', 'complete', 'success', 'succeeded'].includes(status)) {
        const now = new Date().toISOString()

        setCardPanelMessage('Square payment confirmed. Recording sale...')

        await completeSale('card', {
          payment_provider: 'square',
          square_status: 'square_terminal_paid',
          square_checkout_id: data.checkout_id || data.checkout?.id || null,
          square_payment_id: data.payment_id || data.payment?.id || null,
          square_payment_status: data.payment?.status || data.status || null,
          square_receipt_url: data.payment?.receipt_url || null,
          square_terminal_device_id:
            data.checkout?.device_options?.device_id ||
            data.checkout?.device_id ||
            null,
          payment_reference: data.payment_id || data.payment?.id || data.checkout_id || null,
          payment_confirmed_at: now,
          manual_payment_reason: null,
        })

        return
      }

      if (
        ['cancelled', 'canceled', 'cancelled_by_customer', 'canceled_by_customer'].includes(status)
      ) {
        setCardPanelMessage('Square payment cancelled.')
        showPaymentResult('failed', 'Payment Cancelled', 'Square Terminal cancelled the payment.')
        closeCardPanel()
        return
      }

      setCardPanelState('unclear')
      setCardPanelMessage(
        data?.message ||
          `App offline / Square response unclear. Add ${money(
            displayedTotal
          )} to the card reader manually. After payment completes, press Record Manual Sale. If payment did not complete, press Cancel Sale.`
      )
    } catch (error: any) {
      setCardPanelState('unclear')
      setCardPanelMessage(
        `App offline / Square unavailable. Add ${money(
          displayedTotal
        )} to the card reader manually. After payment completes, press Record Manual Sale. If payment did not complete, press Cancel Sale. ${
          error?.message ? `Error: ${error.message}` : ''
        }`
      )
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


  function getRootHistorySale(sale: HistorySale) {
    return sale.original_sale || sale
  }

  function getRelatedHistorySales(sale: HistorySale) {
    return Array.isArray(sale.related_sales) ? sale.related_sales : []
  }

  function getLineAlreadyRefunded(line: HistoryLine, sale: HistorySale) {
    const relatedReturned = sale.returned_qty_by_original_line_id?.[line.id]

    if (relatedReturned !== undefined && relatedReturned !== null) {
      return Number(relatedReturned || 0)
    }

    return Number(line.refunded_quantity || 0)
  }

  function getLineRemainingRefundable(line: HistoryLine, sale: HistorySale) {
    const soldQty = Number(line.quantity || 0)
    const maxRefundable =
      line.max_refundable_quantity === null || line.max_refundable_quantity === undefined
        ? soldQty
        : Number(line.max_refundable_quantity || 0)
    const alreadyRefunded = getLineAlreadyRefunded(line, sale)

    return Math.max(0, Math.min(soldQty, maxRefundable) - alreadyRefunded)
  }

  function getTotalRemainingRefundable(sale: HistorySale) {
    const rootSale = getRootHistorySale(sale)

    return (rootSale.lines || []).reduce(
      (sum, line) => sum + getLineRemainingRefundable(line, sale),
      0
    )
  }

  function hasSquareApiRefundAvailable(sale: HistorySale) {
    const rootSale = getRootHistorySale(sale)
    return rootSale.payment_method === 'card' && Boolean(rootSale.square_payment_id)
  }

  function getRefundMethodLabel(sale: HistorySale) {
    const rootSale = getRootHistorySale(sale)

    if (rootSale.payment_method === 'cash') return 'Cash refund only'
    if (hasSquareApiRefundAvailable(sale)) return 'Square API refund available'
    if (rootSale.payment_method === 'card') return 'Manual card refund only'

    return 'Refund method unknown'
  }

  function getHistoryFamilyLabel(sale: HistorySale) {
    const rootSale = getRootHistorySale(sale)
    const related = getRelatedHistorySales(sale)
    const refundCount = related.filter((row) => row.mode === 'refund').length
    const exchangeCount = related.filter((row) => row.mode === 'exchange').length

    if (sale.mode !== 'sale' && rootSale.id !== sale.id) {
      return `Linked to ${rootSale.sale_number}`
    }

    if (refundCount || exchangeCount) {
      return `${refundCount} refund${refundCount === 1 ? '' : 's'} · ${exchangeCount} exchange${exchangeCount === 1 ? '' : 's'}`
    }

    return 'Original sale'
  }

  function printHistorySale(sale: HistorySale) {
    const rootSale = getRootHistorySale(sale)
    const related = getRelatedHistorySales(sale)
    const rows = (rootSale.lines || [])
      .map((line) => {
        const alreadyRefunded = getLineAlreadyRefunded(line, sale)
        const remaining = getLineRemainingRefundable(line, sale)

        return `
          <tr>
            <td>${line.sku || ''}</td>
            <td>${line.brand || line.title || ''}</td>
            <td style="text-align:center">${line.quantity || 0}</td>
            <td style="text-align:right">${money(Number(line.unit_price || 0))}</td>
            <td style="text-align:center">${alreadyRefunded}</td>
            <td style="text-align:center">${remaining}</td>
            <td style="text-align:right">${money(Number(line.line_total || 0))}</td>
          </tr>
        `
      })
      .join('')

    const relatedRows = related
      .map(
        (row) => `
          <tr>
            <td>${row.sale_number}</td>
            <td>${formatDateTime(row.created_at)}</td>
            <td>${row.mode || ''}</td>
            <td>${row.payment_method || ''}</td>
            <td>${row.square_refund_status || row.square_status || row.status || ''}</td>
            <td style="text-align:right">${money(Number(row.total || 0))}</td>
          </tr>
        `
      )
      .join('')

    const printWindow = window.open('', '_blank', 'width=900,height=700')

    if (!printWindow) {
      setHistoryMessage('Popup blocked. Allow popups to print receipt.')
      return
    }

    printWindow.document.write(`
      <html>
        <head>
          <title>${rootSale.sale_number}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
            h1 { margin: 0 0 8px; font-size: 28px; }
            h2 { margin-top: 28px; font-size: 18px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border-bottom: 1px solid #ddd; padding: 8px; font-size: 13px; text-align: left; }
            th { background: #f2f2f2; }
            .meta { margin: 3px 0; font-size: 13px; }
            .total { margin-top: 16px; text-align: right; font-size: 22px; font-weight: 800; }
            .badge { display: inline-block; padding: 6px 10px; border-radius: 999px; background: #eee; font-weight: 700; font-size: 12px; }
            @media print { button { display: none; } }
          </style>
        </head>
        <body>
          <button onclick="window.print()" style="padding:10px 14px;margin-bottom:18px;font-weight:700">Print</button>
          <h1>Dohpe POS Receipt</h1>
          <div class="badge">${getRefundMethodLabel(sale)}</div>
          <p class="meta"><strong>Receipt:</strong> ${rootSale.sale_number}</p>
          <p class="meta"><strong>Date:</strong> ${formatDateTime(rootSale.created_at)}</p>
          <p class="meta"><strong>Payment:</strong> ${rootSale.payment_method || '-'} / ${rootSale.payment_provider || '-'}</p>
          <p class="meta"><strong>Square payment:</strong> ${rootSale.square_payment_id || '-'}</p>
          <p class="meta"><strong>Location:</strong> ${rootSale.checkout_location || '-'}</p>

          <h2>Items</h2>
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Item</th>
                <th style="text-align:center">Qty</th>
                <th style="text-align:right">Unit</th>
                <th style="text-align:center">Refunded</th>
                <th style="text-align:center">Remaining</th>
                <th style="text-align:right">Line</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>

          <div class="total">Total: ${money(Number(rootSale.total || 0))}</div>

          <h2>Linked refunds / exchanges</h2>
          <table>
            <thead>
              <tr>
                <th>POS No.</th>
                <th>Date</th>
                <th>Mode</th>
                <th>Payment</th>
                <th>Status</th>
                <th style="text-align:right">Total</th>
              </tr>
            </thead>
            <tbody>${relatedRows || '<tr><td colspan="6">No linked refunds/exchanges</td></tr>'}</tbody>
          </table>
        </body>
      </html>
    `)

    printWindow.document.close()
  }

  return (
    <StaffPermissionGate permission="checkout">
      <main className={pageClass}>
        <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-3 p-3 sm:p-5">
          <section className={`${panelClass} p-4`}>
            <div className="mb-3 flex items-start justify-between gap-3">
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

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={openHistory}
                  className="rounded-xl bg-neutral-900 px-3 py-2 text-xs font-black text-white"
                >
                  History
                </button>

                <input
                  value={checkoutLocation}
                  onChange={(event) => setCheckoutLocation(event.target.value)}
                  onBlur={(event) => saveCheckoutLocation(event.target.value)}
                  placeholder="Location"
                  className="w-24 rounded-xl border border-neutral-300 bg-white px-2 py-2 text-xs font-bold uppercase outline-none focus:border-black"
                />

                <button
                  type="button"
                  onClick={() => saveCheckoutLocation(checkoutLocation)}
                  className="rounded-xl bg-black px-3 py-2 text-xs font-black text-white"
                >
                  Save
                </button>
              </div>
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
                className="rounded-2xl bg-black px-5 py-3 font-black text-white disabled:opacity-40"
              >
                Add
              </button>
            </form>

            {message && (
              <div className="mt-3 rounded-2xl bg-neutral-100 p-3 text-sm font-semibold">
                {message}
              </div>
            )}
          </section>

          <section className={`${panelClass} flex flex-1 flex-col overflow-hidden`}>
            <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
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
                          ? 'bg-emerald-100 ring-2 ring-emerald-400'
                          : 'bg-neutral-100'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-neutral-200">
                          {line.thumbnailUrl ? (
                            <img
                              src={line.thumbnailUrl}
                              alt={line.sku}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-neutral-400">
                              NO IMG
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-black">
                                {line.brand || 'Unknown Brand'}
                              </p>
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
                            <div className="flex items-center rounded-full border border-neutral-300">
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
                              <span className="text-xs font-black text-emerald-600">
                                {line.lineDiscountPercent}% off
                              </span>
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
                <button
                  type="button"
                  onClick={() => applyPercentDiscount(5)}
                  className="rounded-2xl border border-neutral-300 py-3 font-black"
                >
                  5% off
                </button>
                <button
                  type="button"
                  onClick={() => applyPercentDiscount(10)}
                  className="rounded-2xl border border-neutral-300 py-3 font-black"
                >
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
                <div className="flex justify-between text-red-500">
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
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => completeSale('cash')}
                  disabled={saleBusy}
                  className="rounded-3xl bg-green-100 py-4 text-sm font-black text-black disabled:opacity-40"
                >
                  CASH REFUND
                </button>
                <button
                  type="button"
                  onClick={completeCardRefund}
                  disabled={saleBusy}
                  className="rounded-3xl bg-sky-100 py-4 text-sm font-black text-black disabled:opacity-40"
                >
                  CARD REFUND
                </button>
              </div>
            ) : mode === 'exchange' && refundDue > 0 ? (
              <>
                <div className="mt-4 rounded-2xl bg-red-50 p-3 text-sm font-bold text-red-800">
                  Replacement item is cheaper. Refund the customer {money(refundDue)}.
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => completeSale('cash')}
                    disabled={saleBusy}
                    className="rounded-3xl bg-green-100 py-4 text-sm font-black text-black disabled:opacity-40"
                  >
                    CASH REFUND DIFFERENCE
                  </button>

                  <button
                    type="button"
                    onClick={completeCardRefund}
                    disabled={saleBusy}
                    className="rounded-3xl bg-sky-100 py-4 text-sm font-black text-black disabled:opacity-40"
                  >
                    CARD REFUND DIFFERENCE
                  </button>
                </div>
              </>
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
                    onClick={openCardPanel}
                    className={`rounded-3xl py-4 text-xl font-black ${
                      paymentMethod === 'card'
                        ? 'bg-sky-300 text-black ring-4 ring-sky-500/40'
                        : 'bg-sky-100 text-black'
                    }`}
                  >
                    <span className="inline-flex items-center justify-center gap-2">
                      CARD
                      <CardLogos />
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
                    <div className="rounded-2xl bg-neutral-100 p-3 text-right">
                      <p className={`text-xs font-bold uppercase tracking-widest ${mutedText}`}>Change</p>
                      <p className="text-2xl font-black">{money(changeDue)}</p>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  disabled={!paymentMethod || basket.length === 0 || saleBusy}
                  onClick={() => {
                    if (paymentMethod === 'card') {
                      openCardPanel()
                      return
                    }

                    if (paymentMethod === 'cash') {
                      completeSale('cash')
                    }
                  }}
                  className="mt-4 w-full rounded-3xl bg-emerald-400 py-5 text-2xl font-black text-black disabled:opacity-40"
                >
                  {saleBusy
                    ? 'Saving…'
                    : mode === 'exchange'
                      ? 'Complete Exchange'
                      : paymentMethod === 'cash'
                        ? 'Complete Cash Sale'
                        : paymentMethod === 'card'
                          ? 'Continue Card Payment'
                          : 'Select Payment'}
                </button>
              </>
            )}

            {mode === 'refund' && (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={beginExchange}
                  disabled={saleBusy}
                  className="text-xs font-black text-amber-700 underline disabled:opacity-40"
                >
                  Exchange instead
                </button>
              </div>
            )}

            <div className="mt-4 flex justify-center gap-4">
              <button
                type="button"
                onClick={openHistory}
                className="text-xs font-bold text-black underline"
              >
                History
              </button>

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

        {historyOpen && (
          <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-3">
            <div className="flex w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white text-neutral-950 shadow-2xl">
              <div className="border-b border-neutral-200 p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-black">POS History</h2>
                    <p className="text-sm font-semibold text-neutral-500">
                      Search receipts, SKUs, Square IDs, then print, open receipt, refund or exchange.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setHistoryOpen(false)
                      setTimeout(() => inputRef.current?.focus(), 50)
                    }}
                    className="rounded-2xl bg-black px-4 py-2 text-sm font-black text-white"
                  >
                    Close
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
                  <input
                    value={historyQuery}
                    onChange={(event) => setHistoryQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') fetchHistory()
                    }}
                    placeholder="Receipt / SKU / Square ID"
                    className="rounded-2xl border border-neutral-300 px-3 py-3 text-sm font-bold outline-none focus:border-black md:col-span-2"
                  />

                  <input
                    value={historyDateFrom}
                    onChange={(event) => setHistoryDateFrom(event.target.value)}
                    type="date"
                    className="rounded-2xl border border-neutral-300 px-3 py-3 text-sm font-bold outline-none focus:border-black"
                  />

                  <input
                    value={historyDateTo}
                    onChange={(event) => setHistoryDateTo(event.target.value)}
                    type="date"
                    className="rounded-2xl border border-neutral-300 px-3 py-3 text-sm font-bold outline-none focus:border-black"
                  />

                  <select
                    value={historyPaymentMethod}
                    onChange={(event) => setHistoryPaymentMethod(event.target.value)}
                    className="rounded-2xl border border-neutral-300 px-3 py-3 text-sm font-bold outline-none focus:border-black"
                  >
                    <option value="">All payments</option>
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                  </select>

                  <select
                    value={historyMode}
                    onChange={(event) => setHistoryMode(event.target.value)}
                    className="rounded-2xl border border-neutral-300 px-3 py-3 text-sm font-bold outline-none focus:border-black"
                  >
                    <option value="">All modes</option>
                    <option value="sale">Sale</option>
                    <option value="refund">Refund</option>
                    <option value="exchange">Exchange</option>
                  </select>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={fetchHistory}
                    disabled={historyBusy}
                    className="rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-black text-black disabled:opacity-40"
                  >
                    {historyBusy ? 'Searching…' : 'Search'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setHistoryQuery('')
                      setHistoryDateFrom('')
                      setHistoryDateTo('')
                      setHistoryPaymentMethod('')
                      setHistoryMode('')
                      setTimeout(fetchHistory, 50)
                    }}
                    disabled={historyBusy}
                    className="rounded-2xl border border-neutral-300 px-5 py-3 text-sm font-black disabled:opacity-40"
                  >
                    Reset
                  </button>
                </div>

                {historyMessage && (
                  <div className="mt-3 rounded-2xl bg-neutral-100 p-3 text-sm font-bold">
                    {historyMessage}
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-auto p-3">
                {historySales.length === 0 ? (
                  <div className="rounded-3xl p-8 text-center text-neutral-500">
                    <p className="text-lg font-bold">No history loaded</p>
                    <p className="text-sm">Use search or reset to load recent transaction activity.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {historySales.map((sale) => {
                      const rootSale = getRootHistorySale(sale)
                      const relatedSales = getRelatedHistorySales(sale)
                      const expanded = expandedHistorySaleId === sale.id
                      const rootLines = rootSale.lines || []
                      const saleTotal = Number(rootSale.total || 0)
                      const remainingRefundable = getTotalRemainingRefundable(sale)
                      const fullyRefunded = rootLines.length > 0 && remainingRefundable <= 0
                      const refundMethodLabel = getRefundMethodLabel(sale)
                      const latestActivity = sale.activity_at || sale.updated_at || sale.created_at

                      return (
                        <div
                          key={sale.id}
                          className="overflow-hidden rounded-3xl border border-neutral-200 bg-neutral-50"
                        >
                          <button
                            type="button"
                            onClick={() => setExpandedHistorySaleId(expanded ? '' : sale.id)}
                            className="w-full p-4 text-left"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                  <p className="truncate text-lg font-black">{rootSale.sale_number}</p>
                                  {sale.mode !== 'sale' && sale.sale_number !== rootSale.sale_number && (
                                    <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-black text-amber-800">
                                      Activity: {sale.sale_number}
                                    </span>
                                  )}
                                  {fullyRefunded && (
                                    <span className="rounded-full bg-red-100 px-2 py-1 text-[11px] font-black text-red-700">
                                      Fully refunded
                                    </span>
                                  )}
                                </div>

                                <p className="text-xs font-bold text-neutral-500">
                                  Sale: {formatDateTime(rootSale.created_at)} · Latest activity:{' '}
                                  {formatDateTime(latestActivity)}
                                </p>
                                <p className="mt-1 truncate text-xs font-semibold text-neutral-500">
                                  {rootSale.payment_method || 'unknown'} · {rootSale.mode || 'sale'} ·{' '}
                                  {rootLines.length} line{rootLines.length === 1 ? '' : 's'} ·{' '}
                                  {getHistoryFamilyLabel(sale)}
                                </p>
                                <p className="mt-1 truncate text-xs font-semibold text-neutral-500">
                                  {refundMethodLabel}
                                  {rootSale.square_payment_id ? ` · Square payment: ${rootSale.square_payment_id}` : ''}
                                </p>
                              </div>

                              <div className="shrink-0 text-right">
                                <p className="text-2xl font-black">{money(saleTotal)}</p>
                                <p className="text-xs font-bold text-neutral-500">
                                  Refundable lines: {remainingRefundable}
                                </p>
                                <p className="text-xs font-bold text-neutral-500">
                                  {expanded ? 'Hide' : 'Open'}
                                </p>
                              </div>
                            </div>
                          </button>

                          {expanded && (
                            <div className="border-t border-neutral-200 bg-white p-4">
                              <div className="mb-3 grid grid-cols-2 gap-2 text-xs font-bold text-neutral-600 md:grid-cols-5">
                                <div className="rounded-2xl bg-neutral-100 p-3">
                                  <p className="uppercase tracking-widest text-neutral-400">Payment</p>
                                  <p>{rootSale.payment_method || '-'}</p>
                                </div>

                                <div className="rounded-2xl bg-neutral-100 p-3">
                                  <p className="uppercase tracking-widest text-neutral-400">Square</p>
                                  <p>{rootSale.square_status || rootSale.square_payment_status || '-'}</p>
                                </div>

                                <div className="rounded-2xl bg-neutral-100 p-3">
                                  <p className="uppercase tracking-widest text-neutral-400">Refund type</p>
                                  <p>{refundMethodLabel}</p>
                                </div>

                                <div className="rounded-2xl bg-neutral-100 p-3">
                                  <p className="uppercase tracking-widest text-neutral-400">Location</p>
                                  <p>{rootSale.checkout_location || '-'}</p>
                                </div>

                                <div className="rounded-2xl bg-neutral-100 p-3">
                                  <p className="uppercase tracking-widest text-neutral-400">Provider</p>
                                  <p>{rootSale.payment_provider || '-'}</p>
                                </div>
                              </div>

                              <div className="rounded-3xl border border-neutral-200 bg-white p-4">
                                <div className="mb-3 flex items-start justify-between gap-3">
                                  <div>
                                    <h3 className="text-lg font-black">Receipt items</h3>
                                    <p className="text-xs font-bold text-neutral-500">
                                      Sold, refunded and remaining quantities from this transaction family.
                                    </p>
                                  </div>
                                  <p className="text-right text-sm font-black">{money(saleTotal)}</p>
                                </div>

                                <div className="space-y-2">
                                  {rootLines.map((line) => {
                                    const alreadyRefunded = getLineAlreadyRefunded(line, sale)
                                    const remaining = getLineRemainingRefundable(line, sale)

                                    return (
                                      <div
                                        key={line.id}
                                        className="flex items-start justify-between gap-3 rounded-2xl bg-neutral-100 p-3"
                                      >
                                        <div className="min-w-0">
                                          <p className="truncate text-sm font-black">
                                            {line.brand || line.title || line.sku}
                                          </p>
                                          <p className="truncate text-xs font-semibold text-neutral-500">
                                            {[line.reporting_category, line.sub_type, line.colour]
                                              .filter(Boolean)
                                              .join(' · ') || line.title || ''}
                                          </p>
                                          <p className="truncate text-xs font-bold text-neutral-500">
                                            {line.sku}
                                          </p>
                                        </div>

                                        <div className="shrink-0 text-right">
                                          <p className="text-sm font-black">
                                            {line.quantity} × {money(Number(line.unit_price || 0))}
                                          </p>
                                          <p className="text-base font-black">
                                            {money(Number(line.line_total || 0))}
                                          </p>
                                          <p className="text-[11px] font-bold text-neutral-500">
                                            Refunded: {alreadyRefunded} · Remaining: {remaining}
                                          </p>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>

                              <div className="mt-3 rounded-3xl border border-neutral-200 bg-neutral-50 p-4">
                                <h3 className="text-lg font-black">Linked refunds / exchanges</h3>

                                {relatedSales.length === 0 ? (
                                  <p className="mt-2 text-sm font-bold text-neutral-500">
                                    No linked refunds or exchanges yet.
                                  </p>
                                ) : (
                                  <div className="mt-3 space-y-2">
                                    {relatedSales.map((related) => (
                                      <div
                                        key={related.id}
                                        className="flex items-start justify-between gap-3 rounded-2xl bg-white p-3"
                                      >
                                        <div className="min-w-0">
                                          <p className="text-sm font-black">{related.sale_number}</p>
                                          <p className="text-xs font-bold text-neutral-500">
                                            {formatDateTime(related.created_at)} · {related.mode || '-'} ·{' '}
                                            {related.payment_method || '-'}
                                          </p>
                                          <p className="truncate text-xs font-bold text-neutral-500">
                                            {related.square_refund_id
                                              ? `Square refund: ${related.square_refund_id}`
                                              : related.square_status || related.status || ''}
                                          </p>
                                        </div>

                                        <div className="shrink-0 text-right">
                                          <p className="text-base font-black">
                                            {money(Number(related.total || 0))}
                                          </p>
                                          <p className="text-[11px] font-black text-neutral-500">
                                            {related.square_refund_status || related.square_status || related.status || ''}
                                          </p>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-4">
                                <button
                                  type="button"
                                  onClick={() => printHistorySale(sale)}
                                  className="rounded-2xl border border-neutral-300 px-4 py-4 text-sm font-black"
                                >
                                  Print Receipt
                                </button>

                                {rootSale.square_receipt_url ? (
                                  <a
                                    href={rootSale.square_receipt_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-2xl bg-sky-100 px-4 py-4 text-center text-sm font-black text-black"
                                  >
                                    Open Square Receipt
                                  </a>
                                ) : (
                                  <div className="rounded-2xl bg-neutral-100 px-4 py-4 text-center text-sm font-black text-neutral-400">
                                    No Square Receipt
                                  </div>
                                )}

                                <button
                                  type="button"
                                  disabled={fullyRefunded}
                                  onClick={() => loadSaleForRefund(rootSale.sale_number)}
                                  className="rounded-2xl bg-red-500 px-4 py-4 text-sm font-black text-white disabled:bg-neutral-200 disabled:text-neutral-400"
                                >
                                  {fullyRefunded ? 'Fully Refunded' : 'Load Refund / Exchange'}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard?.writeText(rootSale.sale_number)
                                    setHistoryMessage(`Copied ${rootSale.sale_number}`)
                                  }}
                                  className="rounded-2xl border border-neutral-300 px-4 py-4 text-sm font-black"
                                >
                                  Copy Receipt No.
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {cardPanelOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-md rounded-3xl bg-white p-5 text-neutral-950 shadow-2xl">
              <div className="mb-4">
                <h2 className="text-2xl font-black">Card Payment</h2>
                <p className="mt-1 text-sm font-semibold text-neutral-500">
                  Total to pay: {money(displayedTotal)}
                </p>
              </div>

              {cardPanelMessage && (
                <div
                  className={`mb-4 rounded-2xl p-3 text-sm font-bold ${
                    cardPanelState === 'unclear'
                      ? 'bg-yellow-50 text-yellow-950'
                      : 'bg-neutral-100 text-neutral-950'
                  }`}
                >
                  {cardPanelMessage}
                </div>
              )}

              {cardPanelState === 'options' && (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={sendTotalToSquareTerminal}
                    disabled={saleBusy}
                    className="w-full rounded-2xl bg-sky-500 px-4 py-4 text-lg font-black text-white disabled:opacity-40"
                  >
                    Send Total to Square Terminal
                  </button>

                  <button
                    type="button"
                    onClick={completeManualCardSale}
                    disabled={saleBusy}
                    className="w-full rounded-2xl bg-neutral-900 px-4 py-4 text-lg font-black text-white disabled:opacity-40"
                  >
                    Manual Entry / Record Card Sale
                  </button>

                  <button
                    type="button"
                    onClick={closeCardPanel}
                    disabled={saleBusy}
                    className="w-full rounded-2xl border border-neutral-300 px-4 py-4 text-lg font-black disabled:opacity-40"
                  >
                    Cancel / Back
                  </button>
                </div>
              )}

              {cardPanelState === 'waiting' && (
                <div className="space-y-3">
                  <div className="rounded-2xl bg-sky-50 p-4 text-center text-sm font-bold text-sky-900">
                    Waiting for Square Terminal response...
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setCardPanelState('unclear')
                      setCardPanelMessage(
                        `No Square response. Add ${money(
                          displayedTotal
                        )} to the card reader manually. After payment completes, press Record Manual Sale. If payment did not complete, press Cancel Sale.`
                      )
                    }}
                    disabled={saleBusy}
                    className="w-full rounded-2xl border border-neutral-300 px-4 py-4 text-lg font-black disabled:opacity-40"
                  >
                    No Response / Manual Options
                  </button>
                </div>
              )}

              {cardPanelState === 'unclear' && (
                <div className="space-y-3">
                  <div className="rounded-2xl bg-yellow-50 p-4 text-sm font-black text-yellow-950">
                    APP OFFLINE / SQUARE UNCLEAR
                    <br />
                    <span className="font-bold">
                      Add {money(displayedTotal)} to the card reader manually. Only record the sale
                      after the card payment has completed.
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={completeManualCardSale}
                    disabled={saleBusy}
                    className="w-full rounded-2xl bg-emerald-500 px-4 py-4 text-lg font-black text-black disabled:opacity-40"
                  >
                    Record Manual Sale
                  </button>

                  <button
                    type="button"
                    onClick={cancelCardPayment}
                    disabled={saleBusy}
                    className="w-full rounded-2xl bg-red-500 px-4 py-4 text-lg font-black text-white disabled:opacity-40"
                  >
                    Cancel Sale
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {paymentResultType && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
            <div
              className={`w-full max-w-md rounded-[2rem] p-8 text-center shadow-2xl ${
                paymentResultType === 'success'
                  ? 'bg-emerald-500 text-black'
                  : 'bg-red-500 text-white'
              }`}
            >
              <div className="mx-auto mb-5 flex h-28 w-28 items-center justify-center rounded-full bg-white text-7xl font-black text-black">
                {paymentResultType === 'success' ? '✓' : '✕'}
              </div>

              <h2 className="text-3xl font-black">
                {paymentResultTitle}
              </h2>

              <p className="mt-3 text-lg font-bold">
                {paymentResultMessage}
              </p>

              <p className="mt-5 text-sm font-black opacity-80">
                This message will close automatically.
              </p>
            </div>
          </div>
        )}
      </main>
    </StaffPermissionGate>
  )
}
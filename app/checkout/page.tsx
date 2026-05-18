'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { useStaff } from '@/app/context/StaffContext'

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
  isBag?: boolean
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

const DOHPE_LOGO_URL =
  'https://hmeaanftisuhcdrzmpil.supabase.co/storage/v1/object/public/item-images/originals/Dohpe_logo_transparent_bk__black_wider_version.png'

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

function escapeHtml(value: any) {
  return text(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
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
  const scannerBufferRef = useRef('')
  const scannerTimerRef = useRef<number | null>(null)
  const retryingRef = useRef(false)
  const paymentResultTimerRef = useRef<number | null>(null)
  const { staff, clearStaff } = useStaff()

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
  const [locationEditorOpen, setLocationEditorOpen] = useState(false)
  const [locationDraft, setLocationDraft] = useState('SHOP-1')
  const [manualEntryOpen, setManualEntryOpen] = useState(false)
  const [manualTitle, setManualTitle] = useState('')
  const [manualPrice, setManualPrice] = useState('')
  const [manualQty, setManualQty] = useState('1')
  const [manualDiscountOpen, setManualDiscountOpen] = useState(false)
  const [manualDiscountPercent, setManualDiscountPercent] = useState('')
  const [cashPanelOpen, setCashPanelOpen] = useState(false)
  const [cardPanelOpen, setCardPanelOpen] = useState(false)
  const [cardPanelState, setCardPanelState] = useState<CardPanelState>('options')
  const [cardPanelMessage, setCardPanelMessage] = useState('')
  const [paymentResultType, setPaymentResultType] = useState<PaymentResultType>(null)
  const [paymentResultTitle, setPaymentResultTitle] = useState('')
  const [paymentResultMessage, setPaymentResultMessage] = useState('')
  const [paymentResultTx, setPaymentResultTx] = useState<any | null>(null)


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
  const selectedLine = basket.find((line) => (line.originalLineId || line.sku) === selectedSku)

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

      if (scannerTimerRef.current) {
        window.clearTimeout(scannerTimerRef.current)
      }
    }
  }, [])

  function makeFailedReceipt(reason: string) {
    const now = new Date().toISOString()

    return {
      id: crypto.randomUUID(),
      sale_number: `FAILED-${makeSaleNumber()}`,
      mode,
      payment_method: paymentMethod || 'card',
      payment_provider: 'none',
      square_status: 'failed_or_unclear',
      status: 'failed',
      checkout_location: checkoutLocation || 'SHOP-1',
      created_at: now,
      updated_at: now,
      subtotal: Number(saleSubtotal.toFixed(2)),
      discount_amount: Number(totalDiscount.toFixed(2)),
      total: Number(displayedTotal.toFixed(2)),
      vat_amount: Number(vatAmount.toFixed(2)),
      net_amount: Number(netAmount.toFixed(2)),
      manual_payment_reason: reason,
      lines: basket
        .filter((line) => line.quantity > 0)
        .map((line) => ({
          sku: line.sku,
          title: line.title,
          brand: line.brand,
          reporting_category: line.category,
          sub_type: line.subType,
          colour: line.colour,
          quantity: line.quantity,
          unit_price: Number(line.price.toFixed(2)),
          line_total: Number((line.price * line.quantity).toFixed(2)),
        })),
    }
  }

  function closePaymentResult() {
    if (paymentResultTimerRef.current) {
      window.clearTimeout(paymentResultTimerRef.current)
    }

    setPaymentResultType(null)
    setPaymentResultTitle('')
    setPaymentResultMessage('')
    setPaymentResultTx(null)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function showPaymentResult(
    type: Exclude<PaymentResultType, null>,
    title: string,
    body: string,
    tx?: any
  ) {
    if (paymentResultTimerRef.current) {
      window.clearTimeout(paymentResultTimerRef.current)
    }

    setPaymentResultType(type)
    setPaymentResultTitle(title)
    setPaymentResultMessage(body)
    setPaymentResultTx(tx || (type === 'failed' ? makeFailedReceipt(body) : null))
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

  function openLocationEditor() {
    setLocationDraft(checkoutLocation || 'SHOP-1')
    setLocationEditorOpen(true)
  }

  function confirmLocationEditor(value?: string) {
    saveCheckoutLocation(value || locationDraft)
    setLocationEditorOpen(false)
  }

  function addManualEntryToBasket() {
    const price = Number(manualPrice)
    const quantity = Math.max(1, Math.floor(Number(manualQty) || 1))

    if (!Number.isFinite(price) || price <= 0) {
      setMessage('Enter a valid manual price.')
      return
    }

    const cleanTitle = text(manualTitle) || 'Manual item'
    const manualSku = `MANUAL-${Date.now().toString(36).toUpperCase()}`

    setBasket((current) => [
      ...current,
      {
        sku: manualSku,
        title: cleanTitle,
        brand: 'DOHPE',
        category: 'Manual',
        subType: '',
        colour: '',
        thumbnailUrl: '',
        price,
        quantity,
        location: checkoutLocation || 'SHOP-1',
        bin: checkoutLocation || 'SHOP-1',
        stockLevel: 999,
        lineDiscountPercent: 0,
        isReturnLine: false,
      },
    ])

    setManualTitle('')
    setManualPrice('')
    setManualQty('1')
    setManualEntryOpen(false)
    setMessage('Manual item added.')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function signOutStaff() {
    clearStaff()
    window.location.href = '/staff?next=/checkout?pos_app=1'
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

  function addBagToBasket() {
    const bagSku = 'BAG-20P'

    setBasket((current) => {
      const existing = current.find((line) => line.sku === bagSku && line.isBag)

      if (existing) {
        return current.map((line) =>
          line.sku === bagSku && line.isBag ? { ...line, quantity: line.quantity + 1 } : line
        )
      }

      return [
        ...current,
        {
          sku: bagSku,
          title: 'Carrier Bag',
          brand: 'DOHPE',
          category: 'Bag',
          subType: '',
          colour: '',
          thumbnailUrl: '',
          price: 0.2,
          quantity: 1,
          location: checkoutLocation || 'SHOP-1',
          bin: checkoutLocation || 'SHOP-1',
          stockLevel: 999,
          lineDiscountPercent: 0,
          isReturnLine: false,
          isBag: true,
        },
      ]
    })

    setMessage('20p bag added.')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function roundUpToNearest(value: number, nearest: number) {
    if (value <= 0) return 0
    return Math.ceil(value / nearest) * nearest
  }

  function getCashSuggestions() {
    const values = [
      displayedTotal,
      roundUpToNearest(displayedTotal, 1),
      roundUpToNearest(displayedTotal, 5),
      roundUpToNearest(displayedTotal, 10),
      roundUpToNearest(displayedTotal, 20),
    ]
      .filter((value) => value > 0)
      .map((value) => Number(value.toFixed(2)))

    return Array.from(new Set(values)).slice(0, 5)
  }

  function setSuggestedCash(value: number) {
    setCashTendered(value.toFixed(2))
    setTimeout(() => inputRef.current?.focus(), 50)
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

  async function fetchHistory(overrides?: { query?: string }) {
    setHistoryBusy(true)
    setHistoryMessage('')

    try {
      const params = new URLSearchParams()
      params.set('limit', '50')

      const searchQuery = overrides?.query ?? historyQuery.trim()
      if (searchQuery) params.set('query', searchQuery)
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
      setExpandedHistorySaleId('')

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

  useEffect(() => {
    if (typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    const receipt = text(params.get('receipt')).toUpperCase()

    if (!receipt) return

    setHistoryQuery(receipt)
    setHistoryOpen(true)

    setTimeout(() => {
      fetchHistory({ query: receipt })
    }, 100)
  }, [])


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

  useEffect(() => {
    function handleGlobalScanner(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const tagName = target?.tagName?.toLowerCase()

      if (
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        target?.isContentEditable
      ) {
        return
      }

      if (event.key === 'Enter') {
        const buffered = scannerBufferRef.current.trim()
        scannerBufferRef.current = ''

        if (buffered.length >= 3) {
          event.preventDefault()
          addScannedSku(buffered)
        }

        return
      }

      if (event.key.length !== 1) return

      scannerBufferRef.current += event.key

      if (scannerTimerRef.current) {
        window.clearTimeout(scannerTimerRef.current)
      }

      scannerTimerRef.current = window.setTimeout(() => {
        scannerBufferRef.current = ''
      }, 250)
    }

    window.addEventListener('keydown', handleGlobalScanner)

    return () => {
      window.removeEventListener('keydown', handleGlobalScanner)
    }
  })

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

  function applyManualDiscount() {
    const percent = Number(manualDiscountPercent)

    if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
      setMessage('Enter a valid discount percentage.')
      return
    }

    applyPercentDiscount(percent)
    setManualDiscountOpen(false)
    setManualDiscountPercent('')
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
        row.sku === line.sku && !line.isReturnLine ? { ...row, quantity: nextQty } : row
      )
    )
  }

  function closeCardPanel() {
    setCardPanelOpen(false)
    setCashPanelOpen(false)
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

    for (const line of saleLines.filter((row) => row.quantity > 0 && !row.isBag)) {
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

  function openReceiptWindow(tx: any, sourceSale?: HistorySale) {
    const saleNumberRaw = text(tx?.sale_number || sourceSale?.sale_number || '')
    const saleNumber = escapeHtml(saleNumberRaw)
    const createdAt = escapeHtml(formatDateTime(tx?.created_at || sourceSale?.created_at))
    const payment = escapeHtml(tx?.payment_method || sourceSale?.payment_method || '')
    const provider = escapeHtml(tx?.payment_provider || sourceSale?.payment_provider || '')
    const location = escapeHtml(tx?.checkout_location || sourceSale?.checkout_location || checkoutLocation || 'SHOP-1')
    const totalValue = Number(tx?.total ?? sourceSale?.total ?? 0)
    const vatValue = Number(tx?.vat_amount ?? sourceSale?.vat_amount ?? totalValue / 6)
    const netValue = Number(tx?.net_amount ?? sourceSale?.net_amount ?? totalValue - vatValue)
    const lines = Array.isArray(tx?.lines) ? tx.lines : sourceSale?.lines || []

    const rows = lines
      .map((line: any) => {
        const qty = Number(line.quantity || 0)
        const unit = Number(line.unit_price || line.price || 0)
        const lineTotal = Number(line.line_total || unit * qty || 0)
        const name = [line.brand, line.title || line.sku].filter(Boolean).join(' - ')

        return `
          <tr>
            <td class="item">
              <div class="name">${escapeHtml(name || line.sku)}</div>
              <div class="sku">${escapeHtml(line.sku)}</div>
            </td>
            <td class="qty">${qty}</td>
            <td class="price">${escapeHtml(money(lineTotal))}</td>
          </tr>
        `
      })
      .join('')

    const appReceiptUrl = `${window.location.origin}/checkout?receipt=${encodeURIComponent(saleNumberRaw)}`
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(appReceiptUrl)}`

    const printWindow = window.open('', '_blank', 'width=420,height=700')

    if (!printWindow) {
      setMessage('Popup blocked. Allow popups to print receipt.')
      setHistoryMessage('Popup blocked. Allow popups to print receipt.')
      return
    }

    printWindow.document.write(`
      <html>
        <head>
          <title>${saleNumber}</title>
          <style>
            * { box-sizing: border-box; }
            body {
              margin: 0;
              background: #f3f3f3;
              color: #111;
              font-family: Arial, Helvetica, sans-serif;
            }
            .receipt {
              width: 80mm;
              min-height: 100vh;
              margin: 0 auto;
              background: white;
              padding: 10px 10px 16px;
            }
            .center { text-align: center; }
            .logo-wrap {
              width: 62mm;
              height: 34mm;
              margin: 0 auto 2px;
              overflow: hidden;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .logo {
              width: 72mm;
              max-width: none;
              height: auto;
              object-fit: contain;
              display: block;
              transform: translateY(-1mm);
            }
            h1 {
              font-size: 18px;
              margin: 0;
              letter-spacing: 0.5px;
            }
            .small {
              font-size: 11px;
              line-height: 1.35;
            }
            .meta {
              margin-top: 10px;
              padding-top: 8px;
              border-top: 1px dashed #111;
              border-bottom: 1px dashed #111;
              padding-bottom: 8px;
            }
            .meta-row {
              display: flex;
              justify-content: space-between;
              gap: 8px;
              font-size: 11px;
              margin: 2px 0;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 10px;
            }
            td {
              vertical-align: top;
              padding: 5px 0;
              border-bottom: 1px dotted #ccc;
              font-size: 12px;
            }
            .item { width: 58%; }
            .name { font-weight: 700; line-height: 1.2; }
            .sku { font-size: 10px; color: #555; margin-top: 2px; }
            .qty {
              width: 12%;
              text-align: center;
              font-weight: 700;
            }
            .price {
              width: 30%;
              text-align: right;
              font-weight: 700;
            }
            .totals {
              margin-top: 10px;
              border-top: 1px dashed #111;
              padding-top: 8px;
            }
            .total-row {
              display: flex;
              justify-content: space-between;
              font-size: 12px;
              margin: 3px 0;
            }
            .grand {
              font-size: 18px;
              font-weight: 900;
              margin-top: 7px;
            }
            .qr {
              width: 105px;
              height: 105px;
              margin: 10px auto 4px;
              display: block;
            }
            .footer {
              margin-top: 10px;
              border-top: 1px dashed #111;
              padding-top: 8px;
              font-size: 10px;
              line-height: 1.35;
              text-align: center;
            }
            .screen-actions {
              width: 80mm;
              margin: 12px auto;
              display: flex;
              gap: 8px;
            }
            .screen-actions button {
              flex: 1;
              border: 0;
              border-radius: 12px;
              padding: 12px;
              font-weight: 900;
              cursor: pointer;
            }
            @media print {
              body { background: white; }
              .receipt { width: 80mm; margin: 0; padding: 0 2mm; }
              .screen-actions { display: none; }
              @page { size: 80mm auto; margin: 3mm; }
            }
          </style>
        </head>
        <body>
          <div class="screen-actions">
            <button onclick="window.print()">Print</button>
            <button onclick="window.close()">Close</button>
          </div>

          <div class="receipt">
            <div class="center">
              <div class="logo-wrap">
                <img class="logo" src="${DOHPE_LOGO_URL}" />
              </div>
              <h1>DOHPE VINTAGE</h1>
              <div class="small">22 Pottergate, Norwich, NR2 1DX</div>
            </div>

            <div class="meta">
              <div class="meta-row"><span>Receipt</span><strong>${saleNumber}</strong></div>
              <div class="meta-row"><span>Date</span><strong>${createdAt}</strong></div>
              <div class="meta-row"><span>Payment</span><strong>${payment}${provider ? ` / ${provider}` : ''}</strong></div>
              <div class="meta-row"><span>Location</span><strong>${location}</strong></div>
            </div>

            <table>
              <tbody>
                ${rows || '<tr><td>No items</td></tr>'}
              </tbody>
            </table>

            <div class="totals">
              <div class="total-row"><span>Net</span><strong>${escapeHtml(money(netValue))}</strong></div>
              <div class="total-row"><span>VAT included</span><strong>${escapeHtml(money(vatValue))}</strong></div>
              <div class="total-row grand"><span>Total</span><strong>${escapeHtml(money(totalValue))}</strong></div>
            </div>

            <img class="qr" src="${qrUrl}" />

            <div class="footer">
              <div>No refunds or exchanges accepted.</div>
              <div>Thank you for shopping with DOHPE Vintage.</div>
            </div>
          </div>
        </body>
      </html>
    `)

    printWindow.document.close()
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

      showPaymentResult(
        'success',
        mode === 'refund' || refundDue > 0
          ? 'Refund Succeeded'
          : mode === 'exchange'
            ? 'Exchange Complete'
            : method === 'cash'
              ? 'Cash Sale Complete'
              : 'Payment Succeeded',
        `Receipt: ${tx.sale_number}`,
        tx
      )

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
    openReceiptWindow(null, getRootHistorySale(sale))
  }

  return (
    <StaffPermissionGate permission="checkout">
      <main className={pageClass}>
        <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-3 p-3 sm:p-5">
          <section className={`${panelClass} p-4`}>
            <div className="mb-3 rounded-[1.6rem] bg-neutral-100 p-1">
              <div className="grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setHistoryOpen(false)
                    setTimeout(() => inputRef.current?.focus(), 50)
                  }}
                  className={`rounded-[1.3rem] px-4 py-3 text-lg font-black ${
                    !historyOpen ? 'bg-white text-black shadow-sm' : 'text-neutral-500'
                  }`}
                >
                  Checkout
                </button>

                <button
                  type="button"
                  onClick={openHistory}
                  className={`rounded-[1.3rem] px-4 py-3 text-lg font-black ${
                    historyOpen ? 'bg-white text-black shadow-sm' : 'text-neutral-500'
                  }`}
                >
                  Transactions
                </button>

                <button
                  type="button"
                  onClick={() => setMessage('Library view coming soon.')}
                  className="rounded-[1.3rem] px-4 py-3 text-lg font-black text-neutral-500"
                >
                  Library
                </button>
              </div>
            </div>

            <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={openLocationEditor}
                className="rounded-xl border border-neutral-300 bg-white px-3 py-2 text-xs font-black uppercase"
              >
                {checkoutLocation || 'SHOP-1'}
              </button>

              <div className="rounded-xl bg-neutral-100 px-3 py-2 text-xs font-black">
                {staff?.name ? `Pinned: ${staff.name}` : 'No staff pinned'}
              </div>

              <button
                type="button"
                onClick={signOutStaff}
                className="rounded-xl bg-neutral-900 px-3 py-2 text-xs font-black text-white"
              >
                Log out
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
                className="rounded-2xl bg-black px-5 py-3 font-black text-white disabled:opacity-40"
              >
                Add
              </button>

              <button
                type="button"
                onClick={() => setManualEntryOpen(true)}
                className="rounded-2xl bg-neutral-900 px-5 py-3 text-xl font-black text-white"
                aria-label="Open keypad"
                title="Keypad"
              >
                ⌨
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
              <div className="mb-3 grid grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => applyPercentDiscount(5)}
                  className="rounded-2xl border border-neutral-300 py-3 text-sm font-black"
                >
                  5% off
                </button>

                <button
                  type="button"
                  onClick={() => applyPercentDiscount(10)}
                  className="rounded-2xl border border-neutral-300 py-3 text-sm font-black"
                >
                  10% off
                </button>

                {manualDiscountOpen ? (
                  <div className="flex overflow-hidden rounded-2xl border border-neutral-300 bg-white">
                    <input
                      value={manualDiscountPercent}
                      onChange={(event) => setManualDiscountPercent(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') applyManualDiscount()
                      }}
                      placeholder="%"
                      inputMode="decimal"
                      className="min-w-0 flex-1 px-2 py-3 text-center text-sm font-black outline-none"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={applyManualDiscount}
                      className="bg-black px-2 text-xs font-black text-white"
                    >
                      OK
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setManualDiscountOpen(true)}
                    className="rounded-2xl border border-neutral-300 py-3 text-sm font-black"
                  >
                    Manual Discount
                  </button>
                )}

                <button
                  type="button"
                  onClick={addBagToBasket}
                  className="rounded-2xl border border-neutral-300 py-3 text-sm font-black"
                >
                  +20p Bag
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
                    onClick={() => {
                      if (basket.length === 0) {
                        setMessage('Basket is empty.')
                        return
                      }

                      setPaymentMethod('cash')
                      setCashPanelOpen(true)
                    }}
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
              </>
            )}

          </section>
        </div>

        {historyOpen && (
          <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-3">
            <div className="flex w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white text-neutral-950 shadow-2xl">
              <div className="border-b border-neutral-200 p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-black">POS Transactions</h2>
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
                    onClick={() => fetchHistory()}
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
                      setTimeout(() => fetchHistory(), 50)
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
                    <p className="text-lg font-bold">No transactions loaded</p>
                    <p className="text-sm">Search or reset to load recent transactions.</p>
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
                                <span className="mt-2 inline-flex rounded-xl bg-black px-4 py-2 text-xs font-black text-white">
                                  {expanded ? 'Close' : 'Open'}
                                </span>
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



        {cashPanelOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-md rounded-3xl bg-white p-5 text-neutral-950 shadow-2xl">
              <h2 className="text-2xl font-black">Cash Payment</h2>
              <p className="mt-1 text-sm font-bold text-neutral-500">
                Total due: {money(displayedTotal)}
              </p>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <input
                  value={cashTendered}
                  onChange={(event) => setCashTendered(event.target.value)}
                  placeholder="Cash tendered"
                  className={inputClass}
                  inputMode="decimal"
                  autoFocus
                />

                <div className="rounded-2xl bg-neutral-100 p-3 text-right">
                  <p className={`text-xs font-bold uppercase tracking-widest ${mutedText}`}>Change</p>
                  <p className="text-2xl font-black">{money(changeDue)}</p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {getCashSuggestions().map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSuggestedCash(value)}
                    className="rounded-2xl border border-neutral-300 bg-white px-3 py-3 text-sm font-black"
                  >
                    {value === Number(displayedTotal.toFixed(2)) ? 'Exact ' : ''}
                    {money(value)}
                  </button>
                ))}
              </div>

              <button
                type="button"
                disabled={saleBusy || basket.length === 0 || Number(cashTendered || 0) < displayedTotal}
                onClick={() => completeSale('cash')}
                className="mt-4 w-full rounded-3xl bg-emerald-400 py-5 text-xl font-black text-black disabled:opacity-40"
              >
                {saleBusy ? 'Saving…' : 'Complete Cash Sale'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setCashPanelOpen(false)
                  setTimeout(() => inputRef.current?.focus(), 50)
                }}
                disabled={saleBusy}
                className="mt-3 w-full rounded-2xl border border-neutral-300 py-4 text-sm font-black disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {locationEditorOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-sm rounded-3xl bg-white p-5 text-neutral-950 shadow-2xl">
              <h2 className="mb-3 text-xl font-black">Checkout location</h2>

              <div className="grid grid-cols-2 gap-2">
                {['SHOP-1', 'WAREHOUSE'].map((location) => (
                  <button
                    key={location}
                    type="button"
                    onClick={() => confirmLocationEditor(location)}
                    className="rounded-2xl bg-neutral-100 px-4 py-4 text-sm font-black"
                  >
                    {location}
                  </button>
                ))}
              </div>

              <input
                value={locationDraft}
                onChange={(event) => setLocationDraft(event.target.value.toUpperCase())}
                placeholder="Custom location"
                className="mt-3 w-full rounded-2xl border border-neutral-300 px-4 py-4 text-lg font-black uppercase outline-none focus:border-black"
                autoFocus
              />

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setLocationEditorOpen(false)}
                  className="rounded-2xl border border-neutral-300 py-3 text-sm font-black"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={() => confirmLocationEditor()}
                  className="rounded-2xl bg-black py-3 text-sm font-black text-white"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {manualEntryOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-md rounded-3xl bg-white p-5 text-neutral-950 shadow-2xl">
              <h2 className="mb-3 text-xl font-black">Manual item / keypad</h2>

              <input
                value={manualTitle}
                onChange={(event) => setManualTitle(event.target.value)}
                placeholder="Item name, optional"
                className="mb-3 w-full rounded-2xl border border-neutral-300 px-4 py-4 text-lg font-bold outline-none focus:border-black"
              />

              <div className="grid grid-cols-2 gap-3">
                <input
                  value={manualPrice}
                  onChange={(event) => setManualPrice(event.target.value)}
                  placeholder="Price"
                  inputMode="decimal"
                  className="w-full rounded-2xl border border-neutral-300 px-4 py-4 text-2xl font-black outline-none focus:border-black"
                  autoFocus
                />

                <input
                  value={manualQty}
                  onChange={(event) => setManualQty(event.target.value.replace(/\D/g, ''))}
                  placeholder="Qty"
                  inputMode="numeric"
                  className="w-full rounded-2xl border border-neutral-300 px-4 py-4 text-2xl font-black outline-none focus:border-black"
                />
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                {['5', '10', '15', '20', '25', '30'].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setManualPrice(value)}
                    className="rounded-2xl bg-neutral-100 py-3 text-sm font-black"
                  >
                    £{value}
                  </button>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setManualEntryOpen(false)
                    setTimeout(() => inputRef.current?.focus(), 50)
                  }}
                  className="rounded-2xl border border-neutral-300 py-4 text-sm font-black"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={addManualEntryToBasket}
                  className="rounded-2xl bg-emerald-400 py-4 text-sm font-black text-black"
                >
                  Add to basket
                </button>
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

              <h2 className="text-3xl font-black">{paymentResultTitle}</h2>

              <p className="mt-3 text-lg font-bold">{paymentResultMessage}</p>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    openReceiptWindow(paymentResultTx)
                    closePaymentResult()
                  }}
                  className="rounded-2xl bg-black px-4 py-4 text-lg font-black text-white"
                >
                  {paymentResultType === 'success' ? 'Yes, Print' : 'Print Failed Receipt'}
                </button>

                <button
                  type="button"
                  onClick={closePaymentResult}
                  className="rounded-2xl bg-white px-4 py-4 text-lg font-black text-black"
                >
                  {paymentResultType === 'success' ? 'No Receipt' : 'Close'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </StaffPermissionGate>
  )
}
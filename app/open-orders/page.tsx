'use client'

import { useEffect, useMemo, useState } from 'react'
import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { useCompany } from '@/app/context/CompanyContext'
import { useStaff } from '@/app/context/StaffContext'

type GridColumn = {
  key: string
  label: string
  width: number
  visible?: boolean
}

type OpenOrderPayload = {
  ok: boolean
  message?: string
  views?: any[]
  orders?: any[]
  locations?: any[]
  staff?: any[]
  pickwaves?: any[]
  channels?: string[]
}

const DEFAULT_COLUMNS: GridColumn[] = [
  { key: 'select', label: '', width: 44, visible: true },
  { key: 'general', label: 'General', width: 315, visible: true },
  { key: 'company_name', label: 'Company', width: 135, visible: false },
  { key: 'paid_symbol', label: 'Paid', width: 42, visible: false },
  { key: 'invoice_symbol', label: 'A4', width: 42, visible: false },
  { key: 'shipping_symbol', label: 'Ship', width: 48, visible: false },
  { key: 'locked_symbol', label: 'Lock', width: 48, visible: false },
  { key: 'picking_symbol', label: 'Pick', width: 48, visible: false },
  { key: 'notes_symbol', label: 'Notes', width: 52, visible: false },
  { key: 'external_order_number', label: 'Order', width: 150, visible: false },
  { key: 'ordered_at', label: 'Date', width: 135, visible: false },
  { key: 'channel', label: 'Source', width: 115, visible: false },
  { key: 'buyer_name', label: 'Customer', width: 245, visible: true },
  { key: 'total_amount', label: 'Total', width: 125, visible: true },
  { key: 'lines', label: 'Items', width: 450, visible: true },
  { key: 'order_location_name', label: 'Location', width: 120, visible: false },
  { key: 'postal_service_name', label: 'Shipping', width: 160, visible: true },
  { key: 'order_status', label: 'Status', width: 120, visible: false },
  { key: 'pick_status', label: 'Pick', width: 120, visible: false },
]

const ORDER_SYMBOL_COLUMNS = new Set([
  'paid_symbol',
  'invoice_symbol',
  'shipping_symbol',
  'locked_symbol',
  'picking_symbol',
  'notes_symbol',
])

const GENERAL_LEGACY_COLUMNS = new Set([
  'icons',
  'company_name',
  'external_order_number',
  'ordered_at',
  'channel',
])

const HIDDEN_STATUS_COLUMNS = new Set(['order_status', 'pick_status'])

function normaliseColumns(columns: any[]): GridColumn[] {
  const usingFallbackColumns = !(Array.isArray(columns) && columns.length > 0)
  const source = usingFallbackColumns ? DEFAULT_COLUMNS : columns
  const expanded: GridColumn[] = []

  for (const column of source) {
    const key = text(column.key)
    if (HIDDEN_STATUS_COLUMNS.has(key)) continue
    if (GENERAL_LEGACY_COLUMNS.has(key) || ORDER_SYMBOL_COLUMNS.has(key)) {
      if (!expanded.some((existing) => existing.key === 'general')) {
        expanded.push({ key: 'general', label: 'General', width: 315, visible: true })
      }
      continue
    }

    expanded.push({
      key,
      label: text(column.label),
      width:
        usingFallbackColumns && key === 'buyer_name'
          ? 245
          : usingFallbackColumns && key === 'total_amount'
            ? 125
            : Math.max(numberValue(column.width, 120), 42),
      visible:
        usingFallbackColumns && ['order_location_name', 'order_status', 'pick_status'].includes(key)
          ? false
          : column.visible !== false,
    })
  }

  const existingKeys = new Set(expanded.map((column) => column.key))
  for (const column of DEFAULT_COLUMNS) {
    if (HIDDEN_STATUS_COLUMNS.has(column.key)) continue
    if (GENERAL_LEGACY_COLUMNS.has(column.key) || ORDER_SYMBOL_COLUMNS.has(column.key)) continue
    if (!existingKeys.has(column.key)) expanded.push({ ...column, visible: column.visible !== false })
  }

  return expanded.filter((column) => column.key)
}

function text(value: unknown) {
  return String(value || '').trim()
}

function numberValue(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function formatDate(value: unknown) {
  const raw = text(value)
  if (!raw) return '-'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatMoney(value: unknown, currency = 'GBP') {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '-'
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency || 'GBP',
  }).format(amount)
}

function formatLastUpdated(value: Date | null) {
  if (!value) return 'Not loaded yet'
  return `Last updated ${value.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })}`
}

function rawValue(order: any, paths: string[]) {
  for (const path of paths) {
    const value = path.split('.').reduce((current, key) => current?.[key], order)
    if (text(value)) return value
  }
  return ''
}

function shippingCost(order: any) {
  return rawValue(order, [
    'shipping_cost',
    'postage_cost',
    'shipping_total',
    'raw_payload.shipping_cost',
    'raw_payload.shipping_total',
    'raw_payload.totals.shipping',
    'raw_payload.PostageCost',
  ])
}

function buyerUsername(order: any) {
  return text(rawValue(order, [
    'buyer_username',
    'raw_payload.buyer_username',
    'raw_payload.buyer.userName',
    'raw_payload.buyer.username',
    'raw_payload.BuyerUsername',
  ]))
}

function compactAddress(order: any) {
  const address = order.shipping_address || order.raw_payload?.shipping_address || order.raw_payload?.shippingAddress || order.raw_payload?.ShippingAddress || {}
  const parts = [
    address.line1 || address.address1 || address.Address1,
    address.city || address.town || address.City,
    address.postcode || address.postal_code || address.PostCode,
    order.shipping_country || address.country || address.Country,
  ]
    .map(text)
    .filter(Boolean)

  return parts.join(', ')
}

function statusClass(status: unknown) {
  const value = text(status).toLowerCase()
  if (['open', 'reserved', 'paid'].includes(value)) return 'border-emerald-500/40 bg-emerald-950 text-emerald-100'
  if (['picking', 'part_picked', 'picked', 'queued'].includes(value)) return 'border-sky-500/40 bg-sky-950 text-sky-100'
  if (['on_hold', 'parked', 'unpaid'].includes(value)) return 'border-amber-500/40 bg-amber-950 text-amber-100'
  if (['failed', 'cancelled', 'locked'].includes(value)) return 'border-red-500/40 bg-red-950 text-red-100'
  return 'border-neutral-700 bg-neutral-900 text-neutral-200'
}

function titleCase(value: unknown) {
  const raw = text(value).replace(/_/g, ' ')
  return raw ? raw.replace(/\b\w/g, (match) => match.toUpperCase()) : '-'
}

function displayLocation(locationName: unknown, locationMap: Map<string, string>) {
  const code = text(locationName)
  if (!code) return '-'
  return locationMap.get(code) || code
}

function compactLines(order: any) {
  const lines = Array.isArray(order.lines) ? order.lines : []
  if (lines.length === 0) return '-'
  const first = lines[0]
  const label = `${numberValue(first.quantity, 1)} x ${text(first.sku)}`
  return lines.length > 1 ? `${label} +${lines.length - 1}` : label
}

function hasOrderNotes(order: any) {
  return numberValue(order.notes_count) > 0 || numberValue(order.processing_notes_count) > 0
}

function orderSymbolState(order: any, key: string) {
  if (key === 'paid_symbol') {
    return {
      active: text(order.payment_status).toLowerCase() === 'paid',
      label: '£',
      title: text(order.payment_status).toLowerCase() === 'paid' ? 'Paid' : 'Not paid',
    }
  }
  if (key === 'invoice_symbol') {
    return {
      active: text(order.invoice_status) === 'printed',
      label: 'A4',
      title: `Invoice ${titleCase(order.invoice_status).toLowerCase()}`,
    }
  }
  if (key === 'shipping_symbol') {
    return {
      active: text(order.shipping_label_status) === 'printed',
      label: 'ENV',
      title: `Shipping label ${titleCase(order.shipping_label_status).toLowerCase()}`,
    }
  }
  if (key === 'locked_symbol') {
    return {
      active: order.is_locked === true,
      label: 'LOCK',
      title: order.is_locked ? text(order.locked_reason) || 'Locked' : 'Not locked',
    }
  }
  if (key === 'picking_symbol') {
    return {
      active: Boolean(order.pickwave_id) || ['picking', 'part_picked', 'picked'].includes(text(order.order_status)),
      label: 'SCAN',
      title: order.pickwave_id ? 'Pick in progress' : 'Not claimed for picking',
    }
  }
  if (key === 'notes_symbol') {
    return {
      active: hasOrderNotes(order),
      label: 'NOTE',
      title: hasOrderNotes(order) ? 'Order notes present' : 'No order notes',
    }
  }
  return { active: false, label: '-', title: '' }
}

function OrderSymbolIcon({ columnKey }: { columnKey: string }) {
  if (columnKey === 'paid_symbol') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <text x="12" y="18" textAnchor="middle" fontSize="20" fontWeight="900">
          {'\u00a3'}
        </text>
      </svg>
    )
  }
  if (columnKey === 'invoice_symbol') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 2h9l5 5v15H6V2Zm8 1.5V8h4.5L14 3.5ZM8.5 12h9v1.8h-9V12Zm0 4h9v1.8h-9V16Z" />
      </svg>
    )
  }
  if (columnKey === 'shipping_symbol') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 5h18v14H3V5Zm2.4 2 6.6 5 6.6-5H5.4Zm13.6 9V9.4l-7 5.2-7-5.2V16h14Z" />
      </svg>
    )
  }
  if (columnKey === 'locked_symbol') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 10V7a5 5 0 0 1 10 0v3h2v12H5V10h2Zm3 0h4V7a2 2 0 0 0-4 0v3Zm3.3 5.8a1.8 1.8 0 1 0-2.6 0V19h2.6v-3.2Z" />
      </svg>
    )
  }
  if (columnKey === 'picking_symbol') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 5h18v4H3V5Zm1 7h2v7H4v-7Zm4 0h1.5v7H8v-7Zm3 0h3v7h-3v-7Zm4.5 0H17v7h-1.5v-7Zm3 0H20v7h-1.5v-7ZM3 21h18v2H3v-2Z" />
      </svg>
    )
  }
  if (columnKey === 'notes_symbol') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 4h16v11H8l-4 4V4Zm4 5h8V7H8v2Zm0 4h6v-2H8v2Z" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 22 20H2L12 2Zm0 6-4 8h8l-4-8Z" />
    </svg>
  )
}

function OrderSymbol({ order, columnKey }: { order: any; columnKey: string }) {
  const symbol = orderSymbolState(order, columnKey)
  return (
    <span
      title={symbol.title}
      className={
        symbol.active
          ? 'open-order-symbol active'
          : 'open-order-symbol'
      }
    >
      <OrderSymbolIcon columnKey={columnKey} />
    </span>
  )
}

function loopbaseOrderNumber(order: any) {
  const number = numberValue(order.loopbase_order_number)
  if (number > 0) return `#${number.toString().padStart(6, '0')}`
  return `#${text(order.external_order_number || order.external_order_id) || 'Pending'}`
}

function GeneralCell({ order }: { order: any }) {
  const symbolKeys = [
    'paid_symbol',
    'shipping_symbol',
    'invoice_symbol',
    'notes_symbol',
    'locked_symbol',
    'picking_symbol',
  ]
  const customSymbols = Array.isArray(order.custom_symbols) ? order.custom_symbols.slice(0, 6) : []

  return (
    <div className="open-order-general">
      <div className="open-order-symbol-grid">
        {symbolKeys.map((key) => (
          <OrderSymbol key={key} order={order} columnKey={key} />
        ))}
        {customSymbols.map((symbol: any, index: number) => (
          <span
            key={`${text(symbol.key) || 'custom'}-${index}`}
            title={text(symbol.title || symbol.label)}
            className={symbol.active ? 'open-order-symbol active' : 'open-order-symbol'}
          >
            <OrderSymbolIcon columnKey="custom_symbol" />
          </span>
        ))}
      </div>
      <div className="mt-1 min-w-0 text-sm font-bold">
        <span className="font-black text-blue-500">{loopbaseOrderNumber(order)}</span>
        <span className="ml-1 text-neutral-500">via {text(order.channel || order.order_source) || 'unknown'}</span>
      </div>
      {text(order.company?.name) ? (
        <div className="truncate text-[11px] font-bold text-neutral-500">{text(order.company.name)}</div>
      ) : null}
      <div className="text-sm font-bold text-neutral-500">
        <span className="font-black text-neutral-700 dark:text-neutral-300">Date:</span> {formatDate(order.ordered_at)}
      </div>
    </div>
  )
}

function ToggleButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-lg border border-emerald-500 bg-emerald-600 px-3 py-2 text-xs font-black text-white'
          : 'rounded-lg border border-neutral-700 bg-white px-3 py-2 text-xs font-black text-neutral-900 hover:bg-neutral-100'
      }
    >
      {children}
    </button>
  )
}

function OpenOrdersInner() {
  const { activeCompanyId } = useCompany()
  const { staff } = useStaff()
  const [payload, setPayload] = useState<OpenOrderPayload>({ ok: true })
  const [loading, setLoading] = useState(true)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)
  const [statusFilter, setStatusFilter] = useState('open,reserved,picking,part_picked,picked,on_hold,failed')
  const [locationFilter, setLocationFilter] = useState('all')
  const [channelFilter, setChannelFilter] = useState('all')
  const [companyScope, setCompanyScope] = useState<'active' | 'managed'>('active')
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedOrderId, setSelectedOrderId] = useState('')
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null)
  const [viewKey, setViewKey] = useState('all-open-orders')
  const [columnModalOpen, setColumnModalOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [pickModalOpen, setPickModalOpen] = useState(false)
  const [shippingModalOpen, setShippingModalOpen] = useState(false)
  const [orderModalOpen, setOrderModalOpen] = useState(false)
  const [newOrderModalOpen, setNewOrderModalOpen] = useState(false)
  const [printModalOpen, setPrintModalOpen] = useState(false)
  const [processModalOpen, setProcessModalOpen] = useState(false)
  const [noteModalOpen, setNoteModalOpen] = useState(false)
  const [actionStatus, setActionStatus] = useState('')
  const [actionError, setActionError] = useState('')
  const [shippingName, setShippingName] = useState('')
  const [noteText, setNoteText] = useState('')
  const [printInvoice, setPrintInvoice] = useState(true)
  const [printPackingSlip, setPrintPackingSlip] = useState(false)
  const [pickStaffId, setPickStaffId] = useState('')
  const [pickGrouping, setPickGrouping] = useState<'items' | 'orders'>('items')
  const [pickSorting, setPickSorting] = useState<'bin_priority' | 'order_view'>('bin_priority')
  const [draftColumns, setDraftColumns] = useState<GridColumn[]>(DEFAULT_COLUMNS)
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})

  async function loadOrders() {
    setLoading(true)
    setActionError('')
    const params = new URLSearchParams({
      statuses: statusFilter,
      location: locationFilter,
      channel: channelFilter,
      scope: companyScope,
      search,
      limit: '250',
    })

    const response = await fetch(`/api/open-orders?${params.toString()}`, { cache: 'no-store' })
    const nextPayload = await response.json().catch(() => ({ ok: false, message: 'Open Orders failed to load.' }))
    setPayload(nextPayload)
    setLastUpdatedAt(new Date())
    setLoading(false)

    if (nextPayload.ok && !selectedOrderId && nextPayload.orders?.[0]?.id) {
      setSelectedOrderId(String(nextPayload.orders[0].id))
    }
  }

  useEffect(() => {
    if (!activeCompanyId) return
    loadOrders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId, statusFilter, locationFilter, channelFilter, companyScope])

  useEffect(() => {
    if (!staff?.id) return
    setPickStaffId(String(staff.id))
  }, [staff?.id])

  const views = payload.views || []
  const orders = payload.orders || []
  const locations = payload.locations || []
  const staffList = payload.staff || []
  const pickwaves = payload.pickwaves || []
  const channels = payload.channels || []
  const activeView = views.find((view) => text(view.view_key) === viewKey) || views[0]
  const visibleColumns = useMemo<GridColumn[]>(() => {
    const sourceColumns = normaliseColumns(activeView?.columns)
    return sourceColumns
      .map((column) => ({ ...column, width: columnWidths[column.key] || column.width }))
      .filter((column: GridColumn) => column.key && column.visible)
  }, [activeView, columnWidths])
  const gridTemplate = visibleColumns.map((column) => `${column.width}px`).join(' ')
  const locationMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const location of locations) {
      map.set(text(location.name), text(location.label) || text(location.name))
    }
    return map
  }, [locations])
  const selectedOrder = orders.find((order) => String(order.id) === selectedOrderId) || orders[0]
  const selectedCount = selectedIds.size
  const selectedOrders = orders.filter((order) => selectedIds.has(String(order.id)))
  const selectedAllParked = selectedOrders.length > 0 && selectedOrders.every((order) => order.is_parked)
  const selectedAllLocked = selectedOrders.length > 0 && selectedOrders.every((order) => order.is_locked)
  const viewOptions = views.length > 0 ? views : [{ view_key: 'all-open-orders', name: 'All Open Orders' }]

  function selectedOrderIds() {
    return Array.from(selectedIds)
  }

  function toggleSelected(orderId: string, rowIndex?: number, shiftKey = false) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (shiftKey && lastSelectedIndex !== null && typeof rowIndex === 'number') {
        const start = Math.min(lastSelectedIndex, rowIndex)
        const end = Math.max(lastSelectedIndex, rowIndex)
        for (let index = start; index <= end; index += 1) {
          const rangeOrder = orders[index]
          if (rangeOrder?.id) next.add(String(rangeOrder.id))
        }
      } else if (next.has(orderId)) {
        next.delete(orderId)
      } else {
        next.add(orderId)
      }
      return next
    })
    if (typeof rowIndex === 'number') setLastSelectedIndex(rowIndex)
    setSelectedOrderId(orderId)
  }

  function toggleAll() {
    setSelectedIds((current) => {
      if (current.size === orders.length) return new Set()
      return new Set(orders.map((order) => String(order.id)))
    })
  }

  function openActionMenu(target: 'view' | 'pick' | 'print' | 'process' | 'shipping' | 'note' | 'park' | 'lock' | 'columns') {
    setActionsOpen(false)
    if (target === 'view') setOrderModalOpen(true)
    if (target === 'pick') setPickModalOpen(true)
    if (target === 'print') setPrintModalOpen(true)
    if (target === 'process') setProcessModalOpen(true)
    if (target === 'shipping') setShippingModalOpen(true)
    if (target === 'note') setNoteModalOpen(true)
    if (target === 'park') {
      runAction(selectedAllParked ? 'unpark' : 'park', selectedAllParked ? {} : { reason: 'Manually parked from Open Orders' })
    }
    if (target === 'lock') {
      runAction(selectedAllLocked ? 'unlock' : 'lock', selectedAllLocked ? {} : { reason: 'Manually locked from Open Orders' })
    }
    if (target === 'columns') openColumnEditor()
  }

  function renderCell(order: any, columnKey: string, rowIndex = 0) {
    if (columnKey === 'select') {
      return (
        <input
          type="checkbox"
          checked={selectedIds.has(String(order.id))}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => toggleSelected(String(order.id), rowIndex, (event.nativeEvent as MouseEvent).shiftKey)}
          className="h-4 w-4 accent-emerald-500"
        />
      )
    }

    if (columnKey === 'general') return <GeneralCell order={order} />
    if (ORDER_SYMBOL_COLUMNS.has(columnKey)) return <OrderSymbol order={order} columnKey={columnKey} />

    if (columnKey === 'company_name') return <span>{text(order.company?.name) || '-'}</span>
    if (columnKey === 'ordered_at') return <span>{formatDate(order.ordered_at)}</span>
    if (columnKey === 'buyer_name') {
      const username = buyerUsername(order)
      const address = compactAddress(order)
      return (
        <div className="min-w-0 leading-tight">
          <div className="truncate font-black">{text(order.buyer_name) || '-'}</div>
          {username ? <div className="truncate text-xs font-bold text-blue-500">@{username}</div> : null}
          {address ? <div className="truncate text-[11px] font-bold text-neutral-500">{address}</div> : null}
        </div>
      )
    }
    if (columnKey === 'total_amount') {
      const shipping = shippingCost(order)
      return (
        <div className="leading-tight">
          <div className="font-black">{formatMoney(order.total_amount, order.currency || 'GBP')}</div>
          <div className="text-[11px] font-bold text-neutral-500">Shipping {shipping ? formatMoney(shipping, order.currency || 'GBP') : '-'}</div>
        </div>
      )
    }
    if (columnKey === 'lines') return <span title={(order.lines || []).map((line: any) => `${line.quantity} x ${line.sku}`).join('\n')}>{compactLines(order)}</span>
    if (columnKey === 'order_location_name') return <span>{displayLocation(order.order_location_name, locationMap)}</span>
    if (columnKey === 'order_status') return <span className={`rounded-md border px-2 py-1 text-[11px] font-black ${statusClass(order.order_status)}`}>{titleCase(order.order_status)}</span>
    if (columnKey === 'pick_status') {
      if (order.pickwave_id) return <span className="rounded-md border border-sky-500/40 bg-sky-950 px-2 py-1 text-[11px] font-black text-sky-100">Claimed</span>
      return <span className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] font-black text-neutral-200">Waiting</span>
    }

    return <span>{text(order[columnKey]) || '-'}</span>
  }

  async function runAction(action: string, extra: Record<string, unknown> = {}) {
    const ids = selectedOrderIds()
    if (ids.length === 0) {
      setActionError('Select at least one order first.')
      return
    }

    setActionStatus('Working...')
    setActionError('')
    const response = await fetch('/api/open-orders/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, order_ids: ids, ...extra }),
    })
    const result = await response.json().catch(() => ({ ok: false, message: 'Action failed.' }))

    if (!response.ok || !result.ok) {
      setActionError(result.message || 'Action failed.')
      setActionStatus('')
      return
    }

    setActionStatus(
      action === 'start_pick'
        ? `Pickwave ${result.pickwave?.pickwave_number || result.pickwave?.name || ''} created for ${result.lines} lines.`
        : 'Action completed.'
    )
    setPickModalOpen(false)
    setShippingModalOpen(false)
    await loadOrders()
    window.setTimeout(() => setActionStatus(''), 2500)
  }

  async function saveColumns(columnsToSave = draftColumns, closeModal = true) {
    setActionStatus('Saving view...')
    setActionError('')
    const response = await fetch('/api/open-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save_view',
        view_key: viewKey || 'all-open-orders',
        name: activeView?.name || 'All Open Orders',
        columns: columnsToSave,
        filters: activeView?.filters || {},
        sorting: activeView?.sorting || [{ key: 'ordered_at', direction: 'desc' }],
        hot_buttons: activeView?.hot_buttons || [],
      }),
    })
    const result = await response.json().catch(() => ({ ok: false, message: 'View save failed.' }))
    if (!response.ok || !result.ok) {
      setActionError(result.message || 'View save failed.')
      setActionStatus('')
      return
    }
    if (closeModal) setColumnModalOpen(false)
    await loadOrders()
    setActionStatus('View saved.')
    window.setTimeout(() => setActionStatus(''), 1800)
  }

  function startColumnResize(column: GridColumn, startX: number) {
    const startingColumns = normaliseColumns(activeView?.columns)
    const startingWidth = column.width

    function onMove(event: MouseEvent) {
      const nextWidth = Math.max(42, Math.round(startingWidth + event.clientX - startX))
      const nextColumns = startingColumns.map((item) =>
        item.key === column.key ? { ...item, width: nextWidth } : item
      )
      setDraftColumns(nextColumns)
      setColumnWidths((current) => ({ ...current, [column.key]: nextWidth }))
    }

    function onUp(event: MouseEvent) {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const finalWidth = Math.max(42, Math.round(startingWidth + event.clientX - startX))
      const nextColumns = startingColumns.map((item) =>
        item.key === column.key ? { ...item, width: finalWidth } : item
      )
      setColumnWidths((current) => ({ ...current, [column.key]: finalWidth }))
      saveColumns(nextColumns, false)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function openColumnEditor() {
    setDraftColumns(normaliseColumns(activeView?.columns))
    setColumnModalOpen(true)
  }

  return (
    <main className="open-orders-page min-h-screen bg-neutral-950 p-4 text-white">
      <header className="app-header rounded-3xl bg-black px-6 py-5 shadow-2xl">
        <AppNav current="open-orders" />
        <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-white">Open Orders</h1>
            <p className="mt-1 text-sm font-bold text-neutral-300">
              Multi-channel order control, custom views, picking, parking, locking, and dispatch preparation.
            </p>
          </div>
          <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-black text-white">
            {selectedCount} selected
          </div>
        </div>
      </header>

      <section className="mt-4 min-w-0 rounded-2xl border border-neutral-800 bg-neutral-900">
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 p-3">
          <select
            value={viewKey}
            onChange={(event) => setViewKey(event.target.value)}
            className="open-orders-control h-9 min-w-[170px] rounded-lg border px-3 text-xs font-black outline-none"
          >
            {viewOptions.map((view, index) => (
              <option key={text(view.view_key) || `view-${index}`} value={text(view.view_key) || 'all-open-orders'}>
                {text(view.name) || 'Open Orders'}
              </option>
            ))}
          </select>
          <select
            value={companyScope}
            onChange={(event) => setCompanyScope(event.target.value === 'managed' ? 'managed' : 'active')}
            className="open-orders-control h-9 rounded-lg border px-3 text-xs font-black outline-none"
          >
            <option value="active">Current company</option>
            <option value="managed">All managed companies</option>
          </select>
          <select
            value={locationFilter}
            onChange={(event) => setLocationFilter(event.target.value)}
            className="open-orders-control h-9 rounded-lg border px-3 text-xs font-black outline-none"
          >
            <option value="all">All locations</option>
            {locations.map((location) => (
              <option key={location.id} value={text(location.name)}>
                {text(location.label) || text(location.name)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={loadOrders}
            title="Refresh"
            className="open-orders-icon-button"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
              <path fill="currentColor" d="M17.7 6.3A8 8 0 1 0 20 12h-2.2a5.8 5.8 0 1 1-1.7-4.1L13 11h8V3l-3.3 3.3Z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            title="Filters"
            className={filtersOpen ? 'open-orders-icon-button active' : 'open-orders-icon-button'}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
              <path fill="currentColor" d="M3 5h18l-7 8v5l-4 2v-7L3 5Z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={openColumnEditor}
            title="View settings"
            className="open-orders-icon-button"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
              <path fill="currentColor" d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a7.8 7.8 0 0 0-2.6-1.5L14 2h-4l-.4 2.5A7.8 7.8 0 0 0 7 6L4.6 5 2.6 8.5l2 1.5c-.1.5-.1 1-.1 1.5s0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a7.8 7.8 0 0 0 2.6 1.5L10 22h4l.4-2.5A7.8 7.8 0 0 0 17 18l2.4 1 2-3.5-2-1.5ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" />
            </svg>
          </button>
          <div className="ml-auto flex min-w-[280px] items-center gap-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search orders, customers, SKUs"
              className="open-orders-control h-9 min-w-0 flex-1 rounded-lg border px-3 text-sm font-bold outline-none placeholder:text-neutral-500 focus:border-emerald-500"
            />
            <button type="button" onClick={loadOrders} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-500">
              Search
            </button>
            <button type="button" onClick={() => setNewOrderModalOpen(true)} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-500">
              New Order
            </button>
          </div>
        </div>

        {filtersOpen ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-black/40 p-3">
            <label className="flex items-center gap-2 text-[11px] font-black uppercase text-neutral-400">
              Channel
              <select
                value={channelFilter}
                onChange={(event) => setChannelFilter(event.target.value)}
                className="open-orders-control h-9 rounded-lg border px-3 text-xs font-black normal-case outline-none"
              >
                <option value="all">All channels</option>
                {channels.map((channel) => (
                  <option key={channel} value={channel}>
                    {channel}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <ToggleButton
                active={statusFilter.includes('open')}
                onClick={() => setStatusFilter('open,reserved,picking,part_picked,picked,on_hold,failed')}
              >
                Open
              </ToggleButton>
              <ToggleButton active={statusFilter === 'on_hold'} onClick={() => setStatusFilter('on_hold')}>
                Parked
              </ToggleButton>
              <ToggleButton active={statusFilter === 'picking'} onClick={() => setStatusFilter('picking')}>
                Picking
              </ToggleButton>
              <ToggleButton active={statusFilter === 'failed'} onClick={() => setStatusFilter('failed')}>
                Failed
              </ToggleButton>
            </div>
            <div className="ml-auto text-xs font-bold text-neutral-500">
              {pickwaves.length} active pickwave{pickwaves.length === 1 ? '' : 's'}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 p-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => setActionsOpen((open) => !open)}
              className="rounded-lg border border-blue-500/40 bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-500"
            >
              Actions
            </button>
            {actionsOpen ? (
              <div className="open-orders-action-menu absolute left-0 top-10 z-30 w-56 rounded-xl border border-neutral-700 bg-neutral-950 p-2 shadow-2xl">
                <button type="button" onClick={() => openActionMenu('view')}>View order</button>
                <button type="button" onClick={() => openActionMenu('print')}>{selectedCount > 1 ? 'Batch print' : 'Print'}</button>
                <button type="button" onClick={() => openActionMenu('process')}>{selectedCount > 1 ? 'Batch process' : 'Process'}</button>
                <button type="button" onClick={() => openActionMenu('shipping')}>Shipping</button>
                <button type="button" onClick={() => openActionMenu('pick')}>Start pick</button>
                <button type="button" onClick={() => openActionMenu('note')}>Add note</button>
                <button type="button" onClick={() => openActionMenu('park')}>{selectedAllParked ? 'Unpark selected' : 'Park selected'}</button>
                <button type="button" onClick={() => openActionMenu('lock')}>{selectedAllLocked ? 'Unlock selected' : 'Lock selected'}</button>
                <button type="button" onClick={() => openActionMenu('columns')}>View columns</button>
              </div>
            ) : null}
          </div>
          <button type="button" onClick={() => setPrintModalOpen(true)} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-500">
            {selectedCount > 1 ? 'Batch Print' : 'Print'}
          </button>
          <button type="button" onClick={() => setProcessModalOpen(true)} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-black text-white hover:bg-red-500">
            {selectedCount > 1 ? 'Batch Process' : 'Process'}
          </button>
          <div className="ml-auto text-right text-xs font-bold text-neutral-500">
            <div>{selectedCount > 0 ? `${selectedCount} selected` : `${orders.length} orders`}</div>
            <div>{formatLastUpdated(lastUpdatedAt)}</div>
          </div>
        </div>

          {actionStatus ? (
            <div className="border-b border-emerald-900 bg-emerald-950 px-4 py-2 text-xs font-black text-emerald-100">
              {actionStatus}
            </div>
          ) : null}
          {actionError ? (
            <div className="border-b border-red-900 bg-red-950 px-4 py-2 text-xs font-black text-red-100">
              {actionError}
            </div>
          ) : null}

          <div className="overflow-auto">
            <div className="min-w-max">
              <div
                className="grid border-b border-neutral-800 bg-black text-[11px] font-black uppercase text-neutral-400"
                style={{ gridTemplateColumns: gridTemplate }}
              >
                {visibleColumns.map((column) => (
                  <div key={column.key} className="relative flex h-10 items-center border-r border-neutral-900 px-3">
                    {column.key === 'select' ? (
                      <input
                        type="checkbox"
                        checked={orders.length > 0 && selectedIds.size === orders.length}
                        onChange={toggleAll}
                        className="h-4 w-4 accent-emerald-500"
                      />
                    ) : (
                      column.label
                    )}
                    {column.key !== 'select' ? (
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        title="Drag to resize column"
                        onMouseDown={(event) => {
                          event.preventDefault()
                          startColumnResize(column, event.clientX)
                        }}
                        className="absolute right-0 top-0 h-full w-2 cursor-col-resize border-r border-transparent hover:border-emerald-400"
                      />
                    ) : null}
                  </div>
                ))}
              </div>

              {loading ? (
                <div className="p-8 text-sm font-bold text-neutral-400">Loading open orders...</div>
              ) : !payload.ok ? (
                <div className="p-8 text-sm font-bold text-red-200">{payload.message || 'Open Orders failed to load.'}</div>
              ) : orders.length === 0 ? (
                <div className="p-8 text-sm font-bold text-neutral-400">No open orders match this view.</div>
              ) : (
                orders.map((order, rowIndex) => (
                  <button
                    type="button"
                    key={order.id}
                    onClick={() => setSelectedOrderId(String(order.id))}
                    className={
                      selectedIds.has(String(order.id))
                        ? 'open-order-row-selected grid w-full border-b border-blue-200 bg-blue-50 text-left text-sm font-bold text-neutral-950'
                        : String(order.id) === String(selectedOrder?.id)
                          ? 'open-order-row-focused grid w-full border-b border-blue-100 bg-blue-50/40 text-left text-sm font-bold text-neutral-950'
                        : order.is_locked
                          ? 'grid w-full border-b border-neutral-800 bg-neutral-950/70 text-left text-sm font-bold text-neutral-500'
                          : 'grid w-full border-b border-neutral-800 bg-neutral-900 text-left text-sm font-bold text-neutral-200 hover:bg-neutral-850'
                    }
                    style={{ gridTemplateColumns: gridTemplate }}
                  >
                    {visibleColumns.map((column) => (
                      <div
                        key={`${order.id}-${column.key}`}
                        className="flex min-h-14 items-center overflow-hidden border-r border-neutral-950 px-3"
                      >
                        <div className="min-w-0 truncate">{renderCell(order, column.key, rowIndex)}</div>
                      </div>
                    ))}
                  </button>
                ))
              )}
            </div>
          </div>
      </section>

      {newOrderModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-neutral-700 bg-neutral-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black text-white">New Order</h2>
                <p className="mt-1 text-sm font-bold text-neutral-400">
                  Manual order creation will use this entry point once shipping, payment, and line-item checks are wired.
                </p>
              </div>
              <button type="button" onClick={() => setNewOrderModalOpen(false)} className="rounded-lg bg-white px-3 py-2 text-xs font-black text-black">
                Close
              </button>
            </div>
            <div className="mt-5 rounded-xl border border-neutral-800 bg-black p-4 text-sm font-bold text-neutral-400">
              Placeholder only for now, matching the Linnworks-style command position without changing order creation logic yet.
            </div>
          </div>
        </div>
      ) : null}

      {orderModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-5xl rounded-2xl border border-neutral-700 bg-neutral-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black text-white">Order Detail</h2>
                <p className="mt-1 text-sm font-bold text-neutral-400">
                  {selectedOrder
                    ? text(selectedOrder.external_order_number) || text(selectedOrder.external_order_id)
                    : 'No order selected'}
                </p>
              </div>
              <button type="button" onClick={() => setOrderModalOpen(false)} className="rounded-lg bg-white px-3 py-2 text-xs font-black text-black">
                Close
              </button>
            </div>

            {!selectedOrder ? (
              <p className="mt-5 text-sm font-bold text-neutral-500">Select an order first.</p>
            ) : (
              <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
                <section className="rounded-xl border border-neutral-800 bg-black p-4">
                  <div className="text-[11px] font-black uppercase text-neutral-500">Order</div>
                  <div className="mt-2 grid grid-cols-2 gap-3 text-sm font-bold text-neutral-300">
                    <div>
                      <span className="block text-[11px] font-black uppercase text-neutral-500">Company</span>
                      {text(selectedOrder.company?.name) || '-'}
                    </div>
                    <div>
                      <span className="block text-[11px] font-black uppercase text-neutral-500">Status</span>
                      <span className={`inline-block rounded-md border px-2 py-1 text-[11px] font-black ${statusClass(selectedOrder.order_status)}`}>
                        {titleCase(selectedOrder.order_status)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[11px] font-black uppercase text-neutral-500">Channel</span>
                      {text(selectedOrder.channel) || '-'}
                    </div>
                    <div>
                      <span className="block text-[11px] font-black uppercase text-neutral-500">Date</span>
                      {formatDate(selectedOrder.ordered_at)}
                    </div>
                    <div>
                      <span className="block text-[11px] font-black uppercase text-neutral-500">Location</span>
                      {displayLocation(selectedOrder.order_location_name, locationMap)}
                    </div>
                    <div>
                      <span className="block text-[11px] font-black uppercase text-neutral-500">Total</span>
                      {formatMoney(selectedOrder.total_amount, selectedOrder.currency || 'GBP')}
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-neutral-800 bg-black p-4">
                  <div className="text-[11px] font-black uppercase text-neutral-500">Customer</div>
                  <div className="mt-2 text-sm font-black text-white">{text(selectedOrder.buyer_name) || '-'}</div>
                  <div className="mt-1 text-xs font-bold text-neutral-400">{text(selectedOrder.buyer_email) || '-'}</div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[11px] font-black">
                    {['paid_symbol', 'invoice_symbol', 'shipping_symbol', 'locked_symbol', 'picking_symbol', 'notes_symbol'].map((key) => (
                      <div key={key} className="rounded-lg border border-neutral-800 bg-neutral-950 p-2">
                        <OrderSymbol order={selectedOrder} columnKey={key} />
                        <div className="mt-1 text-neutral-500">{orderSymbolState(selectedOrder, key).title}</div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-xl border border-neutral-800 bg-black p-4 lg:col-span-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] font-black uppercase text-neutral-500">Lines</div>
                    <span className="rounded bg-neutral-900 px-2 py-1 text-[10px] font-black text-neutral-300">
                      {(selectedOrder.lines || []).length}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {(selectedOrder.lines || []).map((line: any) => (
                      <div key={line.id} className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-black text-white">{line.title || line.sku}</div>
                            <div className="text-[11px] font-bold text-neutral-400">{line.sku}</div>
                          </div>
                          <span className={`rounded border px-2 py-1 text-[10px] font-black ${statusClass(line.line_status)}`}>
                            {titleCase(line.line_status)}
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-4 gap-2 text-[11px] font-bold text-neutral-400">
                          <div>Qty {numberValue(line.quantity)}</div>
                          <div>Picked {numberValue(line.picked_quantity)}</div>
                          <div>Reserved {numberValue(line.reserved_quantity)}</div>
                          <div>Sent {numberValue(line.dispatched_quantity)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {columnModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-neutral-700 bg-neutral-950 p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-black text-white">Configure Columns</h2>
              <button type="button" onClick={() => setColumnModalOpen(false)} className="rounded-lg bg-white px-3 py-2 text-xs font-black text-black">
                Close
              </button>
            </div>
            <div className="mt-4 max-h-[60vh] space-y-2 overflow-auto">
              {draftColumns.map((column, index) => (
                <div key={column.key} className="grid grid-cols-[40px_1fr_90px] items-center gap-3 rounded-lg border border-neutral-800 bg-black p-3">
                  <input
                    type="checkbox"
                    checked={column.visible !== false}
                    onChange={(event) =>
                      setDraftColumns((current) =>
                        current.map((item) =>
                          item.key === column.key ? { ...item, visible: event.target.checked } : item
                        )
                      )
                    }
                    className="h-4 w-4 accent-emerald-500"
                  />
                  <div>
                    <div className="text-sm font-black text-white">{column.label || column.key}</div>
                    <div className="text-[11px] font-bold text-neutral-500">{column.key}</div>
                  </div>
                  <input
                    type="number"
                    min={42}
                    value={column.width}
                    onChange={(event) =>
                      setDraftColumns((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, width: numberValue(event.target.value, item.width) } : item
                        )
                      )
                    }
                    className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm font-bold text-white"
                  />
                </div>
              ))}
            </div>
            <button type="button" onClick={() => saveColumns()} className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-500">
              Save View
            </button>
          </div>
        </div>
      ) : null}

      {pickModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-neutral-700 bg-neutral-950 p-5 shadow-2xl">
            <h2 className="text-xl font-black text-white">Start Pick</h2>
            <p className="mt-1 text-sm font-bold text-neutral-400">
              Claim {selectedCount} selected order{selectedCount === 1 ? '' : 's'} into a pickwave.
            </p>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-[11px] font-black uppercase text-neutral-400">Picker</span>
                <select
                  value={pickStaffId}
                  onChange={(event) => setPickStaffId(event.target.value)}
                  className="open-orders-control mt-1 w-full rounded-lg border px-3 py-2 text-sm font-bold"
                >
                  <option value="">Choose staff</option>
                  {staffList.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <span className="text-[11px] font-black uppercase text-neutral-400">Group pickwave by</span>
                <div className="mt-1 flex gap-2">
                  <ToggleButton active={pickGrouping === 'items'} onClick={() => setPickGrouping('items')}>Items</ToggleButton>
                  <ToggleButton active={pickGrouping === 'orders'} onClick={() => setPickGrouping('orders')}>Orders</ToggleButton>
                </div>
              </div>
              <div>
                <span className="text-[11px] font-black uppercase text-neutral-400">Pick sequence</span>
                <div className="mt-1 flex gap-2">
                  <ToggleButton active={pickSorting === 'bin_priority'} onClick={() => setPickSorting('bin_priority')}>Bin Priority</ToggleButton>
                  <ToggleButton active={pickSorting === 'order_view'} onClick={() => setPickSorting('order_view')}>Grid Order</ToggleButton>
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setPickModalOpen(false)} className="rounded-lg border border-neutral-700 bg-white px-4 py-2 text-sm font-black text-black">
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  runAction('start_pick', {
                    staff_id: pickStaffId,
                    grouping_type: pickGrouping,
                    sorting_type: pickSorting,
                    location_name: locationFilter === 'all' ? '' : locationFilter,
                  })
                }
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-500"
              >
                Create Pickwave
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {printModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-neutral-700 bg-neutral-950 p-5 shadow-2xl">
            <h2 className="text-xl font-black text-white">{selectedCount > 1 ? 'Batch Print' : 'Print'}</h2>
            <p className="mt-1 text-sm font-bold text-neutral-400">
              Mark print documents for {selectedCount || 0} selected order{selectedCount === 1 ? '' : 's'}.
            </p>
            <div className="mt-4 space-y-3">
              <label className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-black p-3 text-sm font-black text-white">
                <input
                  type="checkbox"
                  checked={printInvoice}
                  onChange={(event) => setPrintInvoice(event.target.checked)}
                  className="h-4 w-4 accent-emerald-500"
                />
                Invoice
              </label>
              <label className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-black p-3 text-sm font-black text-white">
                <input
                  type="checkbox"
                  checked={printPackingSlip}
                  onChange={(event) => setPrintPackingSlip(event.target.checked)}
                  className="h-4 w-4 accent-emerald-500"
                />
                Packing slip
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setPrintModalOpen(false)} className="rounded-lg border border-neutral-700 bg-white px-4 py-2 text-sm font-black text-black">
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  runAction('print_documents', {
                    include_invoice: printInvoice,
                    include_packing_slip: printPackingSlip,
                  }).then(() => setPrintModalOpen(false))
                }
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-500"
              >
                Print
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {processModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-red-700 bg-neutral-950 p-5 shadow-2xl">
            <h2 className="text-xl font-black text-white">{selectedCount > 1 ? 'Batch Process' : 'Process Order'}</h2>
            <p className="mt-2 text-sm font-bold text-red-100">
              Processing dispatches orders and can deduct stock. This is intentionally blocked until pick allocation and shipping label checks are wired into the Loopbase order flow.
            </p>
            {selectedCount > 1 ? (
              <p className="mt-3 rounded-lg border border-red-800 bg-red-950 p-3 text-sm font-black text-red-100">
                Batch process will need a final warning because it can dispatch multiple orders at once.
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setProcessModalOpen(false)} className="rounded-lg border border-neutral-700 bg-white px-4 py-2 text-sm font-black text-black">
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {noteModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-neutral-700 bg-neutral-950 p-5 shadow-2xl">
            <h2 className="text-xl font-black text-white">Add Order Note</h2>
            <p className="mt-1 text-sm font-bold text-neutral-400">
              Add an internal note to {selectedCount || 0} selected order{selectedCount === 1 ? '' : 's'}.
            </p>
            <textarea
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              className="open-orders-control mt-4 h-32 w-full rounded-lg border px-3 py-2 text-sm font-bold outline-none"
              placeholder="Note"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setNoteModalOpen(false)} className="rounded-lg border border-neutral-700 bg-white px-4 py-2 text-sm font-black text-black">
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  runAction('add_note', {
                    note: noteText,
                    staff_id: staff?.id || null,
                  }).then(() => {
                    setNoteText('')
                    setNoteModalOpen(false)
                  })
                }
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-500"
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {shippingModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-neutral-700 bg-neutral-950 p-5 shadow-2xl">
            <h2 className="text-xl font-black text-white">Assign Shipping</h2>
            <p className="mt-1 text-sm font-bold text-neutral-400">Postal integrations will turn this into live quotes and labels later.</p>
            <label className="mt-4 block">
              <span className="text-[11px] font-black uppercase text-neutral-400">Service name or code</span>
              <input
                value={shippingName}
                onChange={(event) => setShippingName(event.target.value)}
                className="open-orders-control mt-1 w-full rounded-lg border px-3 py-2 text-sm font-bold"
                placeholder="Royal Mail Tracked 48"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShippingModalOpen(false)} className="rounded-lg border border-neutral-700 bg-white px-4 py-2 text-sm font-black text-black">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => runAction('assign_shipping', { postal_service_name: shippingName })}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-500"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}

export default function OpenOrdersPage() {
  return (
    <StaffPermissionGate permission="inventory">
      <OpenOrdersInner />
    </StaffPermissionGate>
  )
}

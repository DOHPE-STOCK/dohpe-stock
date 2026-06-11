import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getLinnworksIntegrationConfig, shouldRunLinnworksRoute } from '@/lib/linnworksIntegrationSettings'
import { getEnabledIntegrationCompanies } from '@/lib/tenantCronCompanies'

export const dynamic = 'force-dynamic'

const WAREHOUSE_LOCATION = 'WAREHOUSE'
const WAREHOUSE_STORAGE_LOCATION = 'LOCATION-1'
const WAREHOUSE_BIN = 'Default'
const TRANSFER_REASON = 'online_order_pick'
const ACTIVE_TRANSFER_ITEM_STATUSES = ['pending_pick', 'picked']
const RELEASE_ALLOWED_TRANSFER_STATUSES = ['pending_pick']

const DEFAULT_LOCATION_MAPPINGS: Record<string, string> = {
  'LOCATION-1': 'Default',
  'LOCATION-2': 'SHOP-1',
  'LOCATION-3': 'SHOP-2',
  'LOCATION-4': 'SHOP-3',
  'LOCATION-5': 'SHOP-4',
  WAREHOUSE: 'Default',
  DEFAULT: 'Default',
}

let activeLocationMappings = DEFAULT_LOCATION_MAPPINGS

type TrackedSale = {
  id: string
  company_id?: string | null
  linnworks_order_id: string | null
  sku: string | null
  current_status: string | null
  stock_deducted: boolean | null
  stock_deductions?: any[] | null
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('Missing Supabase admin environment variables.')
  }

  return createClient(url, serviceKey)
}

async function loadLocationMappings(supabase: any, companyId?: string) {
  let query = supabase
    .from('integration_settings')
    .select('settings')
    .eq('channel', 'linnworks')

  if (companyId) query = query.eq('company_id', companyId)

  const { data, error } = await query
    .maybeSingle()

  if (error) return DEFAULT_LOCATION_MAPPINGS

  const saved = data?.settings?.location_mapping || data?.settings?.location_mappings || {}
  const mappings: Record<string, string> = { ...DEFAULT_LOCATION_MAPPINGS }

  for (const [appLocation, linnworksLocation] of Object.entries(saved)) {
    const key = normaliseText(appLocation).toUpperCase()
    const value = normaliseText(linnworksLocation)
    if (key && value) mappings[key] = value
  }

  return mappings
}

async function authoriseLinnworks() {
  const applicationId = process.env.LINNWORKS_APP_ID
  const applicationSecret = process.env.LINNWORKS_APP_SECRET
  const token = process.env.LINNWORKS_APP_TOKEN

  if (!applicationId || !applicationSecret || !token) {
    throw new Error('Missing Linnworks environment variables.')
  }

  const response = await fetch('https://api.linnworks.net/api/Auth/AuthorizeByApplication', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ApplicationId: applicationId,
      ApplicationSecret: applicationSecret,
      Token: token,
    }),
  })

  const data = await response.json()

  if (!response.ok || !data?.Token || !data?.Server) {
    throw new Error('Linnworks authorisation failed.')
  }

  return {
    server: data.Server,
    token: data.Token,
  }
}

async function linnworksPost(server: string, token: string, path: string, body: any) {
  const response = await fetch(`${server}${path}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      Authorization: token,
    },
    body: JSON.stringify(body),
  })

  const responseText = await response.text()
  let data: any = null

  try {
    data = responseText ? JSON.parse(responseText) : null
  } catch {
    data = responseText
  }

  if (!response.ok) {
    throw new Error(
      `${path} failed: ${typeof data === 'string' ? data : JSON.stringify(data)}`
    )
  }

  return data
}

function normaliseText(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function upperText(value: any) {
  return normaliseText(value).toUpperCase()
}

function itemDescription(row: any) {
  const parts = [
    normaliseText(row?.sku),
    normaliseText(row?.items?.brand),
    normaliseText(row?.items?.reporting_category),
  ].filter(Boolean)

  return parts.join(' ')
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function appStorageLocation(value: any) {
  const clean = normaliseText(value)
  const upper = clean.toUpperCase()

  if (!clean) return WAREHOUSE_STORAGE_LOCATION
  if (/^LOCATION-\d+$/i.test(clean)) return upper

  if (upper === 'DEFAULT' || upper === 'WAREHOUSE') {
    const warehouseEntry = Object.entries(activeLocationMappings).find(([, mapped]) => {
      const mappedUpper = upperText(mapped)
      return mappedUpper === 'DEFAULT' || mappedUpper === 'WAREHOUSE'
    })

    return warehouseEntry?.[0] || WAREHOUSE_STORAGE_LOCATION
  }

  const mappedMatch = Object.entries(activeLocationMappings).find(([, mapped]) => {
    return upperText(mapped) === upper
  })

  if (mappedMatch?.[0]) return mappedMatch[0]

  const shopMatch = upper.match(/^SHOP-(\d+)$/)
  if (shopMatch) return `LOCATION-${Number(shopMatch[1]) + 1}`

  return upper
}

function canonicalLocation(value: any) {
  const storage = appStorageLocation(value)

  if (storage === WAREHOUSE_STORAGE_LOCATION) return WAREHOUSE_LOCATION

  const mapped = normaliseText(activeLocationMappings[storage])

  if (mapped) {
    const mappedUpper = mapped.toUpperCase()
    if (mappedUpper === 'DEFAULT' || mappedUpper === 'WAREHOUSE') return WAREHOUSE_LOCATION
    return mappedUpper.startsWith('SHOP-') ? mappedUpper : mapped
  }

  const match = storage.match(/^LOCATION-(\d+)$/i)
  if (match && Number(match[1]) >= 2) return `SHOP-${Number(match[1]) - 1}`

  return storage
}

function isShopStorageLocation(value: any) {
  const storage = appStorageLocation(value)
  return /^LOCATION-\d+$/i.test(storage) && storage !== WAREHOUSE_STORAGE_LOCATION
}

function getArrayFromCandidates(data: any, keys: string[]) {
  if (!data) return []
  if (Array.isArray(data)) return data

  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key]
  }

  return []
}

function getOrderRows(data: any) {
  return getArrayFromCandidates(data, [
    'Data',
    'data',
    'Orders',
    'orders',
    'Items',
    'items',
    'Results',
    'results',
  ])
}

function getOrderUuid(order: any) {
  const value = normaliseText(
    order?.OrderId ||
      order?.orderId ||
      order?.pkOrderId ||
      order?.PkOrderId ||
      order?.OrderID ||
      order?.orderID
  )

  return isUuid(value) ? value : ''
}

function getOrderItems(order: any) {
  return getArrayFromCandidates(order, [
    'Items',
    'items',
    'OrderItems',
    'orderItems',
    'OrderLines',
    'orderLines',
    'Rows',
    'rows',
  ])
}

function getItemSku(item: any) {
  return normaliseText(
    item?.SKU ||
      item?.Sku ||
      item?.sku ||
      item?.ItemNumber ||
      item?.itemNumber ||
      item?.ItemSKU ||
      item?.itemSku
  )
}

function getProcessedDate(order: any) {
  return normaliseText(
    order?.ProcessedDateTime ||
      order?.processedDateTime ||
      order?.ProcessedOn ||
      order?.processedOn ||
      order?.ProcessedDate ||
      order?.processedDate
  )
}

function getRawStatus(order: any) {
  return normaliseText(
    order?.Status ||
      order?.status ||
      order?.GeneralInfo?.Status ||
      order?.GeneralInfo?.StatusName ||
      order?.generalInfo?.status ||
      order?.generalInfo?.statusName
  )
}

function getPaymentStatus(order: any) {
  return normaliseText(
    order?.PaymentStatus ||
      order?.paymentStatus ||
      order?.PaymentStatusName ||
      order?.paymentStatusName ||
      order?.GeneralInfo?.PaymentStatus ||
      order?.GeneralInfo?.paymentStatus ||
      order?.TotalsInfo?.PaymentStatus ||
      order?.TotalsInfo?.paymentStatus ||
      order?.PaymentInfo?.PaymentStatus ||
      order?.PaymentInfo?.paymentStatus
  )
}

function getTrackingNumber(order: any) {
  return normaliseText(
    order?.ShippingInfo?.TrackingNumber ||
      order?.ShippingInfo?.PostalTrackingNumber ||
      order?.TrackingNumber
  )
}

function getShippingVendor(order: any) {
  return normaliseText(
    order?.ShippingInfo?.Vendor ||
      order?.ShippingInfo?.PostalServiceVendor
  )
}

function getShippingMethod(order: any) {
  return normaliseText(
    order?.ShippingInfo?.PostalServiceName ||
      order?.ShippingMethod
  )
}

function processedOrderContainsSku(order: any, sku: string) {
  const wanted = sku.toLowerCase()
  const items = getOrderItems(order)

  if (items.length === 0) return true

  return items.some((item: any) => getItemSku(item).toLowerCase() === wanted)
}

function orderHasCancellationReference(order: any) {
  const raw = JSON.stringify(order || {}).toLowerCase()

  return (
    raw.includes('cxl_reference') ||
    raw.includes('cancellation reference') ||
    raw.includes('cancel reference')
  )
}

function orderLooksCancelled(order: any) {
  const rawStatus = getRawStatus(order).toLowerCase()
  const paymentStatus = getPaymentStatus(order).toLowerCase()

  return (
    order?.Cancelled === true ||
    order?.cancelled === true ||
    order?.IsCancelled === true ||
    order?.isCancelled === true ||
    paymentStatus.includes('cancel') ||
    rawStatus.includes('cancel') ||
    rawStatus.includes('refund') ||
    rawStatus.includes('return') ||
    rawStatus.includes('void') ||
    orderHasCancellationReference(order)
  )
}

function orderLooksProcessed(order: any) {
  const processedAt = getProcessedDate(order)
  const rawStatus = getRawStatus(order).toLowerCase()

  return (
    order?.Processed === true ||
    order?.processed === true ||
    Boolean(processedAt) ||
    rawStatus === '1' ||
    rawStatus.includes('processed') ||
    rawStatus.includes('dispatch') ||
    rawStatus.includes('shipped') ||
    rawStatus.includes('complete')
  )
}

async function getTrackedOpenSales(
  supabase: any,
  limit: number,
  companyId?: string
): Promise<TrackedSale[]> {
  let query = supabase
    .from('linnworks_processed_sales')
    .select('id, company_id, linnworks_order_id, sku, current_status, stock_deducted, stock_deductions')
    .eq('stock_deducted', true)
    .not('current_status', 'in', '(processed,cancelled)')

  if (companyId) query = query.eq('company_id', companyId)

  const { data, error } = await query.limit(limit)

  if (error) throw new Error(error.message)

  return (data || []) as TrackedSale[]
}

async function getOrdersById(server: string, token: string, orderIds: string[]) {
  if (orderIds.length === 0) return []

  const data = await linnworksPost(server, token, '/api/Orders/GetOrdersById', {
    pkOrderIds: orderIds,
  })

  return getOrderRows(data)
}

async function sendTelegramReply(params: {
  chatId: string | null
  messageId: string | number | null
  text: string
}) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  if (!botToken || !params.chatId || !params.messageId) {
    return { skipped: true, reason: 'Telegram reply details missing.' }
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: params.chatId,
      reply_to_message_id: params.messageId,
      text: params.text,
    }),
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(`Telegram reply failed: ${JSON.stringify(data)}`)
  }

  return { ok: true }
}

async function sendTelegramMessage(message: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!botToken || !chatId) {
    return { skipped: true, reason: 'Telegram env vars missing.' }
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
    }),
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(`Telegram send failed: ${JSON.stringify(data)}`)
  }

  return { ok: true }
}

async function restoreAppStockLocation(params: {
  supabase: any
  itemId: string
  sku: string
  locationName: string
  binCode: string
  quantity: number
  companyId?: string
}) {
  const locationName = appStorageLocation(params.locationName)
  const binCode = normaliseText(params.binCode) || WAREHOUSE_BIN
  const now = new Date().toISOString()

  let existingQuery = params.supabase
    .from('item_stock_locations')
    .select('id, stock_level')
    .eq('item_id', params.itemId)
    .eq('location_name', locationName)
    .eq('bin_code', binCode)

  if (params.companyId) existingQuery = existingQuery.eq('company_id', params.companyId)

  const { data, error } = await existingQuery.limit(1)

  if (error) throw new Error(error.message)

  const existing = data?.[0]
  const nextStock = Number(existing?.stock_level || 0) + params.quantity

  if (existing) {
    let updateQuery = params.supabase
      .from('item_stock_locations')
      .update({
        stock_level: nextStock,
        source: 'linnworks_cancelled_order_release',
        updated_at: now,
      })
      .eq('id', existing.id)

    if (params.companyId) updateQuery = updateQuery.eq('company_id', params.companyId)

    const { error: updateError } = await updateQuery

    if (updateError) throw new Error(updateError.message)
    return
  }

  const { error: insertError } = await params.supabase
    .from('item_stock_locations')
    .insert({
      ...(params.companyId ? { company_id: params.companyId } : {}),
      item_id: params.itemId,
      sku: params.sku,
      location_name: locationName,
      location_id: null,
      bin_code: binCode,
      stock_level: params.quantity,
      source: 'linnworks_cancelled_order_release',
      synced_at: null,
      updated_at: now,
    })

  if (insertError) throw new Error(insertError.message)
}

async function updateItemSummary(supabase: any, itemId: string, companyId?: string) {
  let stockQuery = supabase
    .from('item_stock_locations')
    .select('location_name, bin_code, stock_level')
    .eq('item_id', itemId)

  if (companyId) stockQuery = stockQuery.eq('company_id', companyId)

  const { data, error } = await stockQuery

  if (error) throw new Error(error.message)

  const rows = data || []
  const stockLevel = rows.reduce((sum: number, row: any) => sum + Number(row.stock_level || 0), 0)
  const warehouseStock = rows
    .filter((row: any) => appStorageLocation(row.location_name) === WAREHOUSE_STORAGE_LOCATION)
    .reduce((sum: number, row: any) => sum + Number(row.stock_level || 0), 0)
  const shopFloorStock = rows
    .filter(
      (row: any) =>
        isShopStorageLocation(row.location_name) &&
        normaliseText(row.bin_code).toUpperCase() === 'FLOOR'
    )
    .reduce((sum: number, row: any) => sum + Number(row.stock_level || 0), 0)

  const displayRow =
    rows
      .filter((row: any) => Number(row.stock_level || 0) > 0)
      .sort((a: any, b: any) => Number(b.stock_level || 0) - Number(a.stock_level || 0))[0] || null

  let updateQuery = supabase
    .from('items')
    .update({
      stock_level: stockLevel,
      warehouse_stock: warehouseStock,
      shop_floor_stock: shopFloorStock,
      current_location: displayRow ? appStorageLocation(displayRow.location_name) : null,
      current_bin: displayRow?.bin_code || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)

  if (companyId) updateQuery = updateQuery.eq('company_id', companyId)

  const { error: updateError } = await updateQuery

  if (updateError) throw new Error(updateError.message)

  return { stockLevel, warehouseStock, shopFloorStock }
}

async function updateTransferStatusAfterCancellation(supabase: any, transferId: string, companyId?: string) {
  let itemsQuery = supabase
    .from('stock_transfer_items')
    .select('id, status')
    .eq('transfer_id', transferId)

  if (companyId) itemsQuery = itemsQuery.eq('company_id', companyId)

  const { data, error } = await itemsQuery

  if (error) throw new Error(error.message)

  const rows = data || []
  if (rows.length === 0) return { updated: false }

  const rowsStillPartOfTransfer = rows.filter((row: any) => {
    const status = normaliseText(row.status).toLowerCase()
    return !['cancelled', 'canceled', 'missing'].includes(status)
  })

  if (rowsStillPartOfTransfer.length > 0) return { updated: false }

  let updateQuery = supabase
    .from('stock_transfers')
    .update({ status: 'cancelled' })
    .eq('id', transferId)
    .eq('status', 'pending_pick')
    .eq('reason', TRANSFER_REASON)

  if (companyId) updateQuery = updateQuery.eq('company_id', companyId)

  const { error: updateError } = await updateQuery

  if (updateError) throw new Error(updateError.message)

  return { updated: true }
}

function shouldReleaseCancelledTransferItem(rowStatus: string, transferStatus: string) {
  const itemStatus = normaliseText(rowStatus).toLowerCase()
  const parentStatus = normaliseText(transferStatus).toLowerCase()

  return (
    ACTIVE_TRANSFER_ITEM_STATUSES.includes(itemStatus) &&
    RELEASE_ALLOWED_TRANSFER_STATUSES.includes(parentStatus)
  )
}

async function releaseCancelledShopTransferItems(params: {
  supabase: any
  orderId: string
  sku: string
  companyId?: string
}) {
  let transferItemsQuery = params.supabase
    .from('stock_transfer_items')
    .select(`
      id,
      item_id,
      sku,
      status,
      source_bin,
      source_order_id,
      telegram_chat_id,
      telegram_message_id,
      items (
        brand,
        reporting_category
      ),
      stock_transfers (
        id,
        transfer_number,
        from_location,
        to_location,
        status,
        reason
      )
    `)
    .eq('source_order_id', params.orderId)
    .eq('sku', params.sku)

  if (params.companyId) transferItemsQuery = transferItemsQuery.eq('company_id', params.companyId)

  const { data, error } = await transferItemsQuery

  if (error) throw new Error(error.message)

  const rows = data || []
  const released: any[] = []
  const leftAlone: any[] = []
  const telegramResults: any[] = []
  const affectedTransferIds = new Set<string>()

  for (const row of rows) {
    const transfer = Array.isArray(row.stock_transfers)
      ? row.stock_transfers[0]
      : row.stock_transfers

    if (!transfer || normaliseText(transfer.reason) !== TRANSFER_REASON) continue

    const status = normaliseText(row.status).toLowerCase()
    const transferStatus = normaliseText(transfer.status).toLowerCase()
    const fromLocation = appStorageLocation(transfer.from_location)
    const sourceBin = normaliseText(row.source_bin) || 'STOCK'

    if (shouldReleaseCancelledTransferItem(status, transferStatus)) {
      await restoreAppStockLocation({
        supabase: params.supabase,
        itemId: row.item_id,
        sku: row.sku,
        locationName: fromLocation,
        binCode: sourceBin,
        quantity: 1,
        companyId: params.companyId,
      })

      let updateQuery = params.supabase
        .from('stock_transfer_items')
        .update({ status: 'cancelled' })
        .eq('id', row.id)

      if (params.companyId) updateQuery = updateQuery.eq('company_id', params.companyId)

      const { error: updateError } = await updateQuery

      if (updateError) throw new Error(updateError.message)

      await updateItemSummary(params.supabase, row.item_id, params.companyId)
      affectedTransferIds.add(transfer.id)

      const displayFromLocation = canonicalLocation(fromLocation)
      const message = `🚫 Previous shop pick cancelled

SKU: ${row.sku}
${itemDescription(row)}
Transfer: #${String(transfer.transfer_number).padStart(7, '0')}
Action: remove item from transfer batch and allocate back to ${displayFromLocation} / ${sourceBin}`

      let telegram: any = { skipped: true }

      try {
        if (row.telegram_chat_id && row.telegram_message_id) {
          telegram = await sendTelegramReply({
            chatId: row.telegram_chat_id,
            messageId: row.telegram_message_id,
            text: message,
          })
        } else {
          telegram = await sendTelegramMessage(message)
        }
      } catch (telegramError: any) {
        telegram = { ok: false, error: telegramError.message || 'Telegram cancellation message failed.' }
      }

      telegramResults.push(telegram)
      released.push({
        transfer_id: transfer.id,
        transfer_number: transfer.transfer_number,
        transfer_item_id: row.id,
        sku: row.sku,
        restored_to: `${displayFromLocation} / ${sourceBin}`,
        previous_status: row.status,
        previous_transfer_status: transfer.status,
      })

      continue
    }

    leftAlone.push({
      transfer_id: transfer.id,
      transfer_number: transfer.transfer_number,
      transfer_item_id: row.id,
      sku: row.sku,
      status: row.status,
      transfer_status: transfer.status,
      reason: 'Transfer item was not pending_pick/picked on a pending_pick transfer, so no app stock release or cancellation message was applied.',
    })
  }

  const transferStatusUpdates: any[] = []
  for (const transferId of affectedTransferIds) {
    transferStatusUpdates.push(await updateTransferStatusAfterCancellation(params.supabase, transferId, params.companyId))
  }

  return { released, left_alone: leftAlone, telegram: telegramResults, transfer_status_updates: transferStatusUpdates }
}

async function restoreNonShopStockDeductions(params: {
  supabase: any
  sale: TrackedSale
  sku: string
  companyId?: string
}) {
  const deductions = Array.isArray(params.sale.stock_deductions)
    ? params.sale.stock_deductions
    : []

  if (deductions.length === 0) {
    return {
      restored: [],
      skipped: true,
      reason: 'No saved stock_deductions were available for this sale.',
    }
  }

  let itemQuery = params.supabase
    .from('items')
    .select('id, sku')
    .eq('sku', params.sku)

  if (params.companyId) itemQuery = itemQuery.eq('company_id', params.companyId)

  const { data: item, error: itemError } = await itemQuery.maybeSingle()

  if (itemError) throw new Error(itemError.message)
  if (!item?.id) {
    throw new Error(`Could not restore cancelled stock for ${params.sku}; item was not found.`)
  }

  const restored: any[] = []
  const skipped: any[] = []

  for (const deduction of deductions) {
    const locationName = appStorageLocation(deduction?.location_name)
    const binCode = normaliseText(deduction?.bin_code) || WAREHOUSE_BIN
    const quantity = Number(deduction?.quantity || 0)

    if (!quantity || quantity <= 0) {
      skipped.push({ deduction, reason: 'Invalid or zero quantity.' })
      continue
    }

    if (isShopStorageLocation(locationName)) {
      skipped.push({
        location_name: locationName,
        bin_code: binCode,
        quantity,
        reason: 'Shop deduction is restored by stock_transfer_items cancellation logic.',
      })
      continue
    }

    await restoreAppStockLocation({
      supabase: params.supabase,
      itemId: item.id,
      sku: params.sku,
      locationName,
      binCode,
      quantity,
      companyId: params.companyId,
    })

    restored.push({
      location_name: locationName,
      bin_code: binCode,
      quantity,
    })
  }

  await updateItemSummary(params.supabase, item.id, params.companyId)

  return { restored, skipped }
}

async function processProcessedOrders(request: Request, companyId?: string) {
  const startedAt = new Date().toISOString()

  try {
    const supabase = getSupabaseAdmin()
    const integrationConfig = await getLinnworksIntegrationConfig(supabase, companyId)
    const integrationGate = shouldRunLinnworksRoute({
      config: integrationConfig,
      route: 'processed_orders',
      manual: new URL(request.url).searchParams.get('manual') === 'true',
    })

    if (!integrationGate.ok) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        message: integrationGate.reason,
        company_id: companyId || null,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      })
    }
    activeLocationMappings = await loadLocationMappings(supabase, companyId)
    const url = new URL(request.url)
    const debug = url.searchParams.get('debug') === 'true'

    const trackedSales = await getTrackedOpenSales(supabase, 200, companyId)
    const { server, token } = await authoriseLinnworks()

    const orderIds = trackedSales
      .map((sale: TrackedSale) => normaliseText(sale.linnworks_order_id))
      .filter((id: string) => isUuid(id))

    const orders = await getOrdersById(server, token, orderIds)
    const results: any[] = []

    for (const sale of trackedSales) {
      const sku = normaliseText(sale.sku)
      const orderId = normaliseText(sale.linnworks_order_id)

      const order = orders.find((candidate: any) => {
        return getOrderUuid(candidate).toLowerCase() === orderId.toLowerCase()
      })

      if (!order) {
        results.push({
          ok: true,
          skipped: true,
          sku,
          linnworks_order_id: sale.linnworks_order_id,
          reason: 'Order not returned; no cancellation assumed.',
        })
        continue
      }

      if (!processedOrderContainsSku(order, sku)) {
        results.push({
          ok: true,
          skipped: true,
          sku,
          linnworks_order_id: sale.linnworks_order_id,
          reason: 'SKU not found on returned order.',
        })
        continue
      }

      if (orderLooksCancelled(order)) {
        const releaseResult = await releaseCancelledShopTransferItems({
          supabase,
          orderId,
          sku,
          companyId,
        })

        const savedDeductionRestoreResult = await restoreNonShopStockDeductions({
          supabase,
          sale,
          sku,
          companyId,
        })

        let saleUpdateQuery = supabase
          .from('linnworks_processed_sales')
          .update({
            current_status: 'cancelled',
            stock_deducted: false,
            updated_at: new Date().toISOString(),
          })
          .eq('id', sale.id)

        if (companyId) saleUpdateQuery = saleUpdateQuery.eq('company_id', companyId)

        const { error: saleError } = await saleUpdateQuery

        if (saleError) throw new Error(saleError.message)

        results.push({
          ok: true,
          sku,
          linnworks_order_id: sale.linnworks_order_id,
          current_status: 'cancelled',
          payment_status: getPaymentStatus(order),
          raw_status: getRawStatus(order),
          cancellation_reference_found: orderHasCancellationReference(order),
          release_result: releaseResult,
          saved_deduction_restore_result: savedDeductionRestoreResult,
          debug_order: debug ? order : undefined,
        })

        continue
      }

      if (!orderLooksProcessed(order)) {
        results.push({
          ok: true,
          skipped: true,
          sku,
          linnworks_order_id: sale.linnworks_order_id,
          reason: 'Order returned but does not look processed/cancelled yet.',
          raw_status: getRawStatus(order),
          payment_status: getPaymentStatus(order),
          processed_at: getProcessedDate(order),
          debug_order: debug ? order : undefined,
        })
        continue
      }

      const processedAt = getProcessedDate(order) || new Date().toISOString()
      const trackingNumber = getTrackingNumber(order)
      const shippingVendor = getShippingVendor(order)
      const shippingMethod = getShippingMethod(order)

      let saleUpdateQuery = supabase
        .from('linnworks_processed_sales')
        .update({
          current_status: 'processed',
          processed_at: processedAt,
          tracking_number: trackingNumber || null,
          shipping_vendor: shippingVendor || null,
          shipping_method: shippingMethod || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sale.id)

      if (companyId) saleUpdateQuery = saleUpdateQuery.eq('company_id', companyId)

      const { error: saleError } = await saleUpdateQuery

      if (saleError) throw new Error(saleError.message)

      let itemUpdateQuery = supabase
        .from('items')
        .update({
          status: 'processed',
          updated_at: new Date().toISOString(),
        })
        .eq('sku', sku)

      if (companyId) itemUpdateQuery = itemUpdateQuery.eq('company_id', companyId)

      const { error: itemError } = await itemUpdateQuery

      if (itemError) throw new Error(itemError.message)

      results.push({
        ok: true,
        sku,
        linnworks_order_id: sale.linnworks_order_id,
        item_status: 'processed',
        current_status: 'processed',
        processed_at: processedAt,
        tracking_number: trackingNumber || null,
        shipping_vendor: shippingVendor || null,
        shipping_method: shippingMethod || null,
      })
    }

    return NextResponse.json({
      ok: true,
      message: 'Linnworks processed orders checked.',
      company_id: companyId || null,
      started_at: startedAt,
      tracked_sale_count: trackedSales.length,
      processed: results.filter((x: any) => x.ok && !x.skipped && x.current_status === 'processed').length,
      cancelled: results.filter((x: any) => x.ok && x.current_status === 'cancelled').length,
      skipped: results.filter((x: any) => x.skipped).length,
      failed: 0,
      debug,
      results,
    })
  } catch (error: any) {
    console.error('LINNWORKS_PROCESSED_ORDERS_SYNC_ERROR', error)

    return NextResponse.json(
      {
        ok: false,
        message: error.message || 'Unknown Linnworks processed orders sync error.',
      },
      { status: 500 }
    )
  }
}

async function processProcessedOrdersForAllCompanies(request: Request) {
  const startedAt = new Date().toISOString()
  const supabase = getSupabaseAdmin()
  const manual = new URL(request.url).searchParams.get('manual') === 'true'
  const companies = await getEnabledIntegrationCompanies(supabase, 'linnworks', manual)

  if (companies.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      message: 'No active companies have Linnworks processed-order sync enabled.',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      results: [],
    })
  }

  const results: any[] = []

  for (const company of companies) {
    const response = await processProcessedOrders(request.clone(), company.id)
    const payload = await response.json().catch(() => null)
    results.push({
      company_id: company.id,
      company_name: company.name,
      status: response.status,
      payload,
    })
  }

  return NextResponse.json({
    ok: results.every((row) => row.status < 400 && row.payload?.ok !== false),
    message: 'Linnworks processed orders checked for active companies.',
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    company_count: companies.length,
    results,
  })
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, message: 'Unauthorised.' }, { status: 401 })
  }

  return processProcessedOrdersForAllCompanies(request)
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, message: 'Unauthorised.' }, { status: 401 })
  }

  return processProcessedOrdersForAllCompanies(request)
}

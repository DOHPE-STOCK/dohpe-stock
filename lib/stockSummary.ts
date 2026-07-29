export type SupabaseLike = {
  from: (table: string) => any
}

export type StockSummaryItem = {
  id: string
  sku: string | null
  stock_level?: number | string | null
  stock_buffer?: number | string | null
  max_channel_exposed_stock?: number | string | null
  minimum_stock_alert_level?: number | string | null
}

export type StockLocationSummaryRow = {
  id?: string
  location_name: string | null
  bin_code: string | null
  stock_level: number
  is_quarantine: boolean
}

export type CalculatedStockSummary = {
  item_id: string
  sku: string
  physical_stock: number
  available_stock: number
  open_order_stock: number
  inbound_stock: number
  quarantine_stock: number
  stock_buffer: number
  max_channel_exposed_stock: number | null
  minimum_stock_alert_level: number | null
  channel_exposed_stock: number
  current_stock_level: number
  negative_locations: StockLocationSummaryRow[]
  location_rows: StockLocationSummaryRow[]
}

export type StockReservationInput = {
  companyId: string
  itemId: string
  sku: string
  channel: string
  source: string
  externalOrderId: string
  externalOrderReference?: string | null
  quantity: number
  locationName?: string | null
  binCode?: string | null
  stockAlreadyDeducted?: boolean
  metadata?: Record<string, any>
}

function numberValue(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function text(value: unknown) {
  return String(value || '').trim()
}

function canonicalSku(value: unknown) {
  return text(value).toUpperCase()
}

function isQuarantineRow(row: any) {
  const bin = text(row?.bin_code).toUpperCase()
  const binType = text(row?.warehouse_bins?.bin_type).toLowerCase()
  const rowType = text(row?.bin_type).toLowerCase()

  return (
    binType === 'quarantine' ||
    rowType === 'quarantine' ||
    bin.includes('QUARANTINE') ||
    bin.startsWith('QTINE') ||
    bin.startsWith('QT-')
  )
}

async function activeReservationsForItem(
  supabase: SupabaseLike,
  companyId: string,
  itemId: string
) {
  const { data, error } = await supabase
    .from('stock_reservations')
    .select('quantity, stock_already_deducted')
    .eq('company_id', companyId)
    .eq('item_id', itemId)
    .eq('reservation_status', 'active')

  if (error) {
    const message = String(error.message || '')
    const code = String(error.code || '')
    if (code === '42P01' || message.includes('stock_reservations')) return []
    throw new Error(error.message)
  }

  return data || []
}

export async function calculateStockSummaryForItem(
  supabase: SupabaseLike,
  companyId: string,
  item: StockSummaryItem
): Promise<CalculatedStockSummary> {
  const { data: stockRows, error: stockError } = await supabase
    .from('item_stock_locations')
    .select('id, location_name, bin_code, stock_level')
    .eq('company_id', companyId)
    .eq('item_id', item.id)

  if (stockError) throw new Error(stockError.message)

  const locationRows: StockLocationSummaryRow[] = (stockRows || []).map((row: any) => ({
    id: row.id,
    location_name: row.location_name || null,
    bin_code: row.bin_code || null,
    stock_level: numberValue(row.stock_level),
    is_quarantine: isQuarantineRow(row),
  }))

  const reservations = await activeReservationsForItem(supabase, companyId, item.id)
  const physicalStock = locationRows.reduce(
    (sum: number, row: StockLocationSummaryRow) => sum + row.stock_level,
    0
  )
  const openOrderStock = reservations.reduce(
    (sum: number, row: any) => sum + numberValue(row.quantity),
    0
  )
  const reservedAvailableStock = reservations.reduce((sum: number, row: any) => {
    return row.stock_already_deducted === true ? sum : sum + numberValue(row.quantity)
  }, 0)
  const quarantineStock = locationRows
    .filter((row) => row.is_quarantine)
    .reduce((sum: number, row: StockLocationSummaryRow) => sum + Math.max(0, row.stock_level), 0)
  const stockBuffer = numberValue(item.stock_buffer)
  const inboundStock = 0
  const maxChannelExposedStock =
    item.max_channel_exposed_stock === null ||
    item.max_channel_exposed_stock === undefined ||
    item.max_channel_exposed_stock === ''
      ? null
      : Math.max(0, numberValue(item.max_channel_exposed_stock))
  const minimumStockAlertLevel =
    item.minimum_stock_alert_level === null ||
    item.minimum_stock_alert_level === undefined ||
    item.minimum_stock_alert_level === ''
      ? null
      : numberValue(item.minimum_stock_alert_level)
  const availableStock = physicalStock - reservedAvailableStock - quarantineStock - stockBuffer
  const channelExposedStock = Math.max(
    0,
    Math.min(maxChannelExposedStock ?? 999999999, availableStock)
  )

  return {
    item_id: item.id,
    sku: canonicalSku(item.sku),
    physical_stock: physicalStock,
    available_stock: availableStock,
    open_order_stock: openOrderStock,
    inbound_stock: inboundStock,
    quarantine_stock: quarantineStock,
    stock_buffer: stockBuffer,
    max_channel_exposed_stock: maxChannelExposedStock,
    minimum_stock_alert_level: minimumStockAlertLevel,
    channel_exposed_stock: channelExposedStock,
    current_stock_level: numberValue(item.stock_level),
    negative_locations: locationRows.filter((row) => row.stock_level < 0),
    location_rows: locationRows,
  }
}

export async function writeStockSummary(
  supabase: SupabaseLike,
  companyId: string,
  summary: CalculatedStockSummary
) {
  const { error } = await supabase
    .from('items')
    .update({
      physical_stock: summary.physical_stock,
      available_stock: summary.available_stock,
      open_order_stock: summary.open_order_stock,
      inbound_stock: summary.inbound_stock,
      quarantine_stock: summary.quarantine_stock,
      channel_exposed_stock: summary.channel_exposed_stock,
      stock_summary_updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)
    .eq('id', summary.item_id)

  if (error) throw new Error(error.message)
}

export async function recalculateStockSummaryForSku(
  supabase: SupabaseLike,
  companyId: string,
  sku: string
) {
  const cleanSku = canonicalSku(sku)
  if (!cleanSku) return null

  const { data: item, error } = await supabase
    .from('items')
    .select('id, sku, stock_level, stock_buffer, max_channel_exposed_stock, minimum_stock_alert_level')
    .eq('company_id', companyId)
    .eq('sku', cleanSku)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!item?.id) return null

  const summary = await calculateStockSummaryForItem(supabase, companyId, item)
  await writeStockSummary(supabase, companyId, summary)
  await createStockAlertsForSummary(supabase, companyId, summary)
  return summary
}

async function openAlertExists(params: {
  supabase: SupabaseLike
  companyId: string
  alertType: string
  itemId: string
  locationName?: string | null
  binCode?: string | null
}) {
  let query = params.supabase
    .from('stock_alerts')
    .select('id')
    .eq('company_id', params.companyId)
    .eq('alert_type', params.alertType)
    .eq('item_id', params.itemId)
    .in('status', ['open', 'acknowledged'])

  if (params.locationName !== undefined) query = query.eq('location_name', params.locationName)
  if (params.binCode !== undefined) query = query.eq('bin_code', params.binCode)

  const { data, error } = await query.limit(1)
  if (error) throw new Error(error.message)
  return data?.[0] || null
}

export async function upsertStockReservation(
  supabase: SupabaseLike,
  input: StockReservationInput
) {
  const cleanSku = canonicalSku(input.sku)
  const orderId = text(input.externalOrderId)
  if (!input.companyId || !input.itemId || !cleanSku || !orderId) return null

  const now = new Date().toISOString()
  const payload = {
    company_id: input.companyId,
    item_id: input.itemId,
    sku: cleanSku,
    channel: text(input.channel) || 'unknown',
    source: text(input.source) || 'manual',
    external_order_id: orderId,
    external_order_reference: input.externalOrderReference || null,
    reservation_status: 'active',
    quantity: Math.max(0, numberValue(input.quantity)),
    stock_already_deducted: input.stockAlreadyDeducted === true,
    location_name: input.locationName || null,
    bin_code: input.binCode || null,
    metadata: input.metadata || {},
    updated_at: now,
  }

  const { data: existing, error: existingError } = await supabase
    .from('stock_reservations')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('source', payload.source)
    .eq('external_order_id', orderId)
    .eq('sku', cleanSku)
    .limit(1)

  if (existingError) {
    const message = String(existingError.message || '')
    const code = String(existingError.code || '')
    if (code === '42P01' || message.includes('stock_reservations')) return null
    throw new Error(existingError.message)
  }

  if (existing?.[0]?.id) {
    const { data, error } = await supabase
      .from('stock_reservations')
      .update(payload)
      .eq('id', existing[0].id)
      .select('id')
      .maybeSingle()

    if (error) throw new Error(error.message)
    return data
  }

  const { data, error } = await supabase
    .from('stock_reservations')
    .insert({
      ...payload,
      created_at: now,
      reserved_at: now,
    })
    .select('id')
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data
}

export async function updateStockReservationStatus(params: {
  supabase: SupabaseLike
  companyId: string
  source: string
  externalOrderId: string
  sku: string
  status: 'released' | 'deducted' | 'cancelled' | 'expired'
  releaseReason?: string | null
}) {
  const cleanSku = canonicalSku(params.sku)
  const orderId = text(params.externalOrderId)
  if (!params.companyId || !orderId || !cleanSku) return { updated: 0 }

  const now = new Date().toISOString()
  const updatePayload: Record<string, any> = {
    reservation_status: params.status,
    updated_at: now,
  }

  if (params.status === 'released' || params.status === 'cancelled' || params.status === 'expired') {
    updatePayload.released_at = now
    updatePayload.release_reason = params.releaseReason || params.status
  }

  if (params.status === 'deducted') {
    updatePayload.deducted_at = now
  }

  const { data, error } = await params.supabase
    .from('stock_reservations')
    .update(updatePayload)
    .eq('company_id', params.companyId)
    .eq('source', params.source)
    .eq('external_order_id', orderId)
    .eq('sku', cleanSku)
    .eq('reservation_status', 'active')
    .select('id')

  if (error) {
    const message = String(error.message || '')
    const code = String(error.code || '')
    if (code === '42P01' || message.includes('stock_reservations')) return { updated: 0 }
    throw new Error(error.message)
  }

  return { updated: data?.length || 0 }
}

export async function createStockAlertsForSummary(
  supabase: SupabaseLike,
  companyId: string,
  summary: CalculatedStockSummary
) {
  const created: any[] = []

  for (const row of summary.negative_locations) {
    const locationName = row.location_name || null
    const binCode = row.bin_code || null

    const { data: existing, error: existingError } = await supabase
      .from('stock_alerts')
      .select('id')
      .eq('company_id', companyId)
      .eq('alert_type', 'negative_stock')
      .eq('item_id', summary.item_id)
      .eq('location_name', locationName)
      .eq('bin_code', binCode)
      .in('status', ['open', 'acknowledged'])
      .limit(1)

    if (existingError) {
      const message = String(existingError.message || '')
      const code = String(existingError.code || '')
      if (code === '42P01' || message.includes('stock_alerts')) return created
      throw new Error(existingError.message)
    }

    if (existing?.[0]?.id) continue

    const { data, error } = await supabase
      .from('stock_alerts')
      .insert({
        company_id: companyId,
        item_id: summary.item_id,
        sku: summary.sku,
        alert_type: 'negative_stock',
        severity: 'warning',
        status: 'open',
        location_name: locationName,
        bin_code: binCode,
        quantity: row.stock_level,
        title: `Negative stock: ${summary.sku}`,
        message: `${summary.sku} is ${row.stock_level} at ${locationName || 'Unknown'} / ${binCode || 'Unknown'}.`,
        source: 'stock_summary',
        task_required: true,
        task_status: 'recount_required',
      })
      .select('id')
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (data) created.push(data)
  }

  if (summary.minimum_stock_alert_level !== null && summary.minimum_stock_alert_level >= 0) {
    const isLow = summary.available_stock <= summary.minimum_stock_alert_level

    if (isLow) {
      const existing = await openAlertExists({
        supabase,
        companyId,
        alertType: 'low_stock',
        itemId: summary.item_id,
      })

      if (!existing) {
        const { data, error } = await supabase
          .from('stock_alerts')
          .insert({
            company_id: companyId,
            item_id: summary.item_id,
            sku: summary.sku,
            alert_type: 'low_stock',
            severity: summary.available_stock <= 0 ? 'critical' : 'warning',
            status: 'open',
            quantity: summary.available_stock,
            title: `Low stock: ${summary.sku}`,
            message: `${summary.sku} available stock is ${summary.available_stock}. Minimum alert level is ${summary.minimum_stock_alert_level}.`,
            source: 'stock_summary',
            task_required: false,
          })
          .select('id')
          .maybeSingle()

        if (error) throw new Error(error.message)
        if (data) created.push(data)
      }
    } else {
      await supabase
        .from('stock_alerts')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('company_id', companyId)
        .eq('item_id', summary.item_id)
        .eq('alert_type', 'low_stock')
        .in('status', ['open', 'acknowledged'])
    }
  }

  return created
}

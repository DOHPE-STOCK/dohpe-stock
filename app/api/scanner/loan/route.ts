import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type LoanAction = 'loan_out' | 'return'

type ReturnTarget = 'original' | 'shop' | 'warehouse'

type StockRow = {
  id: string
  item_id: string
  sku: string
  location_name: string | null
  bin_code: string | null
  stock_level: number | null
}

const WAREHOUSE_LOCATION = 'WAREHOUSE'
const WAREHOUSE_BIN = 'Default'
const SHOP_LOCATION = 'SHOP-1'
const SHOP_STOCK_BIN = 'STOCK'
const ON_LOAN_LOCATION = 'ON-LOAN'
const ON_LOAN_BIN = 'ON-LOAN'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('Missing Supabase admin environment variables.')
  }

  return createClient(url, serviceKey)
}

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function cleanScan(value: any) {
  return text(value).replace(/\s+/g, '').toUpperCase()
}

function escapePostgrestOrValue(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')
    .replaceAll(',', '\\,')
}

function canonicalLocation(value: any) {
  const clean = text(value)
  const lower = clean.toLowerCase()

  if (!clean) return WAREHOUSE_LOCATION
  if (lower === 'default' || lower === 'warehouse') return WAREHOUSE_LOCATION
  if (clean.toUpperCase().startsWith('SHOP-')) return clean.toUpperCase()

  return clean
}

function canonicalBin(value: any, locationName: string) {
  const clean = text(value)

  if (clean) return clean
  if (canonicalLocation(locationName) === WAREHOUSE_LOCATION) return WAREHOUSE_BIN
  if (canonicalLocation(locationName).startsWith('SHOP-')) return SHOP_STOCK_BIN

  return WAREHOUSE_BIN
}

function parseLoanNotes(value: any) {
  const raw = text(value)

  if (!raw) return {}

  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function makeLoanNotes(value: any) {
  return JSON.stringify(value)
}

async function findItemByScan(supabase: any, scanValue: string) {
  const clean = cleanScan(scanValue)
  const safe = escapePostgrestOrValue(clean)

  const { data, error } = await supabase
    .from('items')
    .select(`
      id,
      sku,
      barcode_number,
      brand,
      reporting_category,
      tagged_size,
      waist_in,
      selling_price,
      stock_level,
      warehouse_stock,
      shop_floor_stock,
      current_location,
      current_bin,
      loan_status,
      loaned_at,
      loan_notes,
      ai_title,
      basic_title
    `)
    .or(`sku.eq.${safe},barcode_number.eq.${safe}`)
    .maybeSingle()

  if (error) throw new Error(error.message)

  return data
}

async function getStockRows(supabase: any, itemId: string) {
  const { data, error } = await supabase
    .from('item_stock_locations')
    .select('id, item_id, sku, location_name, bin_code, stock_level')
    .eq('item_id', itemId)

  if (error) throw new Error(error.message)

  return (data || []) as StockRow[]
}

function chooseLoanOutStockRow(item: any, rows: StockRow[]) {
  const stockedRows = rows.filter((row) => Number(row.stock_level || 0) > 0)

  if (stockedRows.length === 0) return null

  const itemLocation = canonicalLocation(item.current_location)
  const itemBin = text(item.current_bin)

  if (itemLocation && itemBin) {
    const exact = stockedRows.find((row) => {
      return (
        canonicalLocation(row.location_name) === itemLocation &&
        text(row.bin_code).toUpperCase() === itemBin.toUpperCase()
      )
    })

    if (exact) return exact
  }

  if (itemLocation) {
    const locationMatch = stockedRows.find((row) => {
      return canonicalLocation(row.location_name) === itemLocation
    })

    if (locationMatch) return locationMatch
  }

  return [...stockedRows].sort((a, b) => Number(b.stock_level || 0) - Number(a.stock_level || 0))[0]
}

async function upsertStockRow(params: {
  supabase: any
  itemId: string
  sku: string
  locationName: string
  binCode: string
  stockLevelDelta: number
  source: string
}) {
  const locationName = canonicalLocation(params.locationName)
  const binCode = canonicalBin(params.binCode, locationName)
  const now = new Date().toISOString()

  const { data, error } = await params.supabase
    .from('item_stock_locations')
    .select('id, stock_level')
    .eq('item_id', params.itemId)
    .eq('location_name', locationName)
    .eq('bin_code', binCode)
    .limit(1)

  if (error) throw new Error(error.message)

  const existing = data?.[0]

  if (existing) {
    const nextStock = Math.max(0, Number(existing.stock_level || 0) + params.stockLevelDelta)

    const { error: updateError } = await params.supabase
      .from('item_stock_locations')
      .update({
        stock_level: nextStock,
        source: params.source,
        updated_at: now,
      })
      .eq('id', existing.id)

    if (updateError) throw new Error(updateError.message)

    return { id: existing.id, location_name: locationName, bin_code: binCode, stock_level: nextStock }
  }

  const stockLevel = Math.max(0, params.stockLevelDelta)

  const { data: inserted, error: insertError } = await params.supabase
    .from('item_stock_locations')
    .insert({
      item_id: params.itemId,
      sku: params.sku,
      location_name: locationName,
      location_id: null,
      bin_code: binCode,
      stock_level: stockLevel,
      source: params.source,
      synced_at: null,
      updated_at: now,
    })
    .select('id, location_name, bin_code, stock_level')
    .single()

  if (insertError) throw new Error(insertError.message)

  return inserted
}

async function setStockRowLevel(params: {
  supabase: any
  rowId: string
  nextStock: number
  source: string
}) {
  const { error } = await params.supabase
    .from('item_stock_locations')
    .update({
      stock_level: Math.max(0, params.nextStock),
      source: params.source,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.rowId)

  if (error) throw new Error(error.message)
}

async function updateItemSummary(params: {
  supabase: any
  itemId: string
  extra?: Record<string, any>
}) {
  const rows = await getStockRows(params.supabase, params.itemId)
  const stockLevel = rows.reduce((sum, row) => sum + Number(row.stock_level || 0), 0)
  const warehouseStock = rows
    .filter((row) => canonicalLocation(row.location_name) === WAREHOUSE_LOCATION)
    .reduce((sum, row) => sum + Number(row.stock_level || 0), 0)
  const shopFloorStock = rows
    .filter(
      (row) =>
        canonicalLocation(row.location_name).startsWith('SHOP-') &&
        text(row.bin_code).toUpperCase() === 'FLOOR'
    )
    .reduce((sum, row) => sum + Number(row.stock_level || 0), 0)

  const displayRow =
    rows
      .filter((row) => Number(row.stock_level || 0) > 0)
      .sort((a, b) => Number(b.stock_level || 0) - Number(a.stock_level || 0))[0] || null

  const payload = {
    stock_level: stockLevel,
    warehouse_stock: warehouseStock,
    shop_floor_stock: shopFloorStock,
    current_location: displayRow ? canonicalLocation(displayRow.location_name) : null,
    current_bin: displayRow?.bin_code || null,
    updated_at: new Date().toISOString(),
    ...(params.extra || {}),
  }

  const { error } = await params.supabase
    .from('items')
    .update(payload)
    .eq('id', params.itemId)

  if (error) throw new Error(error.message)

  return {
    stock_level: stockLevel,
    warehouse_stock: warehouseStock,
    shop_floor_stock: shopFloorStock,
    current_location: payload.current_location,
    current_bin: payload.current_bin,
  }
}

async function insertQueueRow(params: {
  supabase: any
  itemId: string
  sku: string
  delta: number
  locationName: string
  binCode: string
  reason: string
  staffName: string
  timestampField: string
  timestamp: string
}) {
  const { error } = await params.supabase
    .from('linnworks_sync_queue')
    .insert({
      item_id: params.itemId,
      sku: params.sku,
      action: 'adjust_stock',
      payload: {
        sku: params.sku,
        delta: params.delta,
        quantity: Math.abs(params.delta),
        location: canonicalLocation(params.locationName),
        bin: canonicalBin(params.binCode, params.locationName),
        reason: params.reason,
        source: 'dohpe_app',
        staff: params.staffName,
        [params.timestampField]: params.timestamp,
      },
      status: 'pending',
    })

  if (error) throw new Error(error.message)
}

async function fetchLoans(supabase: any) {
  const { data, error } = await supabase
    .from('items')
    .select(`
      id,
      sku,
      barcode_number,
      brand,
      reporting_category,
      tagged_size,
      waist_in,
      selling_price,
      stock_level,
      current_location,
      current_bin,
      loan_status,
      loaned_at,
      loan_notes,
      ai_title,
      basic_title
    `)
    .eq('loan_status', 'on_loan')
    .order('loaned_at', { ascending: false })

  if (error) throw new Error(error.message)

  return data || []
}

async function loanOut(params: {
  supabase: any
  scanValue: string
  staffId: string
  staffName: string
}) {
  const item = await findItemByScan(params.supabase, params.scanValue)

  if (!item) {
    throw new Error(`Item not found: ${cleanScan(params.scanValue)}`)
  }

  if (text(item.loan_status) === 'on_loan') {
    throw new Error(`${item.sku} is already on loan.`)
  }

  const stockRows = await getStockRows(params.supabase, item.id)
  const sourceRow = chooseLoanOutStockRow(item, stockRows)

  if (!sourceRow) {
    throw new Error(`${item.sku} has no available stock row to loan out.`)
  }

  const sourceLocation = canonicalLocation(sourceRow.location_name)
  const sourceBin = canonicalBin(sourceRow.bin_code, sourceLocation)
  const beforeStock = Number(sourceRow.stock_level || 0)
  const afterStock = Math.max(0, beforeStock - 1)
  const now = new Date().toISOString()

  await setStockRowLevel({
    supabase: params.supabase,
    rowId: sourceRow.id,
    nextStock: afterStock,
    source: 'loan_out',
  })

  const loanNotes = makeLoanNotes({
    source_location: sourceLocation,
    source_bin: sourceBin,
    loaned_out_at: now,
    loaned_out_by: params.staffName,
  })

  const { error: itemUpdateError } = await params.supabase
    .from('items')
    .update({
      loan_status: 'on_loan',
      loaned_at: now,
      loan_returned_at: null,
      loaned_by: params.staffId,
      loan_notes: loanNotes,
      location_status: 'on_loan',
      current_location: ON_LOAN_LOCATION,
      current_bin: ON_LOAN_BIN,
      updated_at: now,
    })
    .eq('id', item.id)

  if (itemUpdateError) throw new Error(itemUpdateError.message)

  const { error: loanInsertError } = await params.supabase
    .from('item_loans')
    .insert({
      item_id: item.id,
      sku: item.sku,
      status: 'on_loan',
      loaned_at: now,
      loaned_by: params.staffId,
    })

  if (loanInsertError) throw new Error(loanInsertError.message)

  await insertQueueRow({
    supabase: params.supabase,
    itemId: item.id,
    sku: item.sku,
    delta: -1,
    locationName: sourceLocation,
    binCode: sourceBin,
    reason: 'loan_out',
    staffName: params.staffName,
    timestampField: 'loaned_at',
    timestamp: now,
  })

  const summary = await updateItemSummary({
    supabase: params.supabase,
    itemId: item.id,
    extra: {
      loan_status: 'on_loan',
      loaned_at: now,
      loaned_by: params.staffId,
      loan_notes: loanNotes,
      location_status: 'on_loan',
      current_location: ON_LOAN_LOCATION,
      current_bin: ON_LOAN_BIN,
      linnworks_location_sync_status: 'pending',
    },
  })

  return {
    item,
    source_location: sourceLocation,
    source_bin: sourceBin,
    before_stock: beforeStock,
    after_stock: afterStock,
    summary,
  }
}

function getReturnDestination(item: any, target: ReturnTarget) {
  const notes = parseLoanNotes(item.loan_notes)

  if (target === 'original') {
    return {
      location: canonicalLocation(notes.source_location || item.current_location || WAREHOUSE_LOCATION),
      bin: canonicalBin(notes.source_bin || item.current_bin || WAREHOUSE_BIN, notes.source_location || WAREHOUSE_LOCATION),
      reason: 'loan_returned_to_original',
    }
  }

  if (target === 'shop') {
    return {
      location: SHOP_LOCATION,
      bin: SHOP_STOCK_BIN,
      reason: 'loan_returned_to_shop',
    }
  }

  return {
    location: WAREHOUSE_LOCATION,
    bin: WAREHOUSE_BIN,
    reason: 'loan_returned_to_warehouse',
  }
}

async function returnLoan(params: {
  supabase: any
  scanValue: string
  staffId: string
  staffName: string
  target: ReturnTarget
}) {
  const item = await findItemByScan(params.supabase, params.scanValue)

  if (!item) {
    throw new Error(`Item not found: ${cleanScan(params.scanValue)}`)
  }

  if (text(item.loan_status) !== 'on_loan') {
    throw new Error(`${item.sku} is not currently on loan.`)
  }

  const destination = getReturnDestination(item, params.target)
  const now = new Date().toISOString()

  const returnedRow = await upsertStockRow({
    supabase: params.supabase,
    itemId: item.id,
    sku: item.sku,
    locationName: destination.location,
    binCode: destination.bin,
    stockLevelDelta: 1,
    source: destination.reason,
  })

  const { error: loanUpdateError } = await params.supabase
    .from('item_loans')
    .update({
      status: 'returned',
      returned_at: now,
      returned_by: params.staffId,
      updated_at: now,
    })
    .eq('item_id', item.id)
    .eq('status', 'on_loan')

  if (loanUpdateError) throw new Error(loanUpdateError.message)

  const { error: itemUpdateError } = await params.supabase
    .from('items')
    .update({
      loan_status: 'not_on_loan',
      loan_returned_at: now,
      returned_by: params.staffId,
      loan_notes: null,
      location_status: 'available',
      linnworks_location_sync_status: 'pending',
      updated_at: now,
    })
    .eq('id', item.id)

  if (itemUpdateError) throw new Error(itemUpdateError.message)

  await insertQueueRow({
    supabase: params.supabase,
    itemId: item.id,
    sku: item.sku,
    delta: 1,
    locationName: destination.location,
    binCode: destination.bin,
    reason: destination.reason,
    staffName: params.staffName,
    timestampField: 'returned_at',
    timestamp: now,
  })

  const summary = await updateItemSummary({
    supabase: params.supabase,
    itemId: item.id,
    extra: {
      loan_status: 'not_on_loan',
      loan_returned_at: now,
      returned_by: params.staffId,
      loan_notes: null,
      location_status: 'available',
      linnworks_location_sync_status: 'pending',
    },
  })

  return {
    item,
    destination_location: destination.location,
    destination_bin: destination.bin,
    returned_row: returnedRow,
    summary,
  }
}

export async function GET() {
  try {
    const supabase = getSupabaseAdmin()
    const loans = await fetchLoans(supabase)

    return NextResponse.json({
      ok: true,
      loans,
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        message: error.message || 'Unknown loan list error.',
      },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json().catch(() => ({}))

    const action = text(body.action) as LoanAction
    const scanValue = cleanScan(body.scan_value || body.sku)
    const staffId = text(body.staff_id)
    const staffName = text(body.staff_name) || 'staff'

    if (!action || !['loan_out', 'return'].includes(action)) {
      return NextResponse.json({ ok: false, message: 'Invalid loan action.' }, { status: 400 })
    }

    if (!scanValue) {
      return NextResponse.json({ ok: false, message: 'Missing scanned SKU/barcode.' }, { status: 400 })
    }

    if (!staffId) {
      return NextResponse.json({ ok: false, message: 'Missing staff id.' }, { status: 400 })
    }

    if (action === 'loan_out') {
      const result = await loanOut({
        supabase,
        scanValue,
        staffId,
        staffName,
      })

      return NextResponse.json({
        ok: true,
        message: `${result.item.sku} marked on loan from ${result.source_location} / ${result.source_bin}.`,
        result,
      })
    }

    const target = text(body.target) as ReturnTarget

    if (!['original', 'shop', 'warehouse'].includes(target)) {
      return NextResponse.json({ ok: false, message: 'Invalid return target.' }, { status: 400 })
    }

    const result = await returnLoan({
      supabase,
      scanValue,
      staffId,
      staffName,
      target,
    })

    return NextResponse.json({
      ok: true,
      message: `${result.item.sku} returned to ${result.destination_location} / ${result.destination_bin}.`,
      result,
    })
  } catch (error: any) {
    console.error('LOAN_ROUTE_ERROR', error)

    return NextResponse.json(
      {
        ok: false,
        message: error.message || 'Unknown loan action error.',
      },
      { status: 500 }
    )
  }
}

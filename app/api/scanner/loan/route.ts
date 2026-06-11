import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type LoanAction = 'lookup' | 'loan_out' | 'return'

type StockRow = {
  id: string
  item_id: string
  sku: string
  location_name: string | null
  bin_code: string | null
  stock_level: number | null
}

const DEFAULT_STORAGE_LOCATION = 'LOCATION-1'
const DEFAULT_BIN = 'Default'
const ON_LOAN_LOCATION = 'ON-LOAN'
const ON_LOAN_BIN = 'ON-LOAN'

const DEFAULT_LOCATION_MAPPINGS: Record<string, string> = {
  'LOCATION-1': 'Default',
  'LOCATION-2': 'SHOP-1',
  'LOCATION-3': 'SHOP-2',
  'LOCATION-4': 'SHOP-3',
  'LOCATION-5': 'SHOP-4',
  WAREHOUSE: 'Default',
  DEFAULT: 'Default',
}

let activeLocationMappings: Record<string, string> = DEFAULT_LOCATION_MAPPINGS

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('Missing Supabase admin environment variables.')
  }

  return createClient(url, serviceKey)
}

function getSupabaseAuth(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error('Missing Supabase auth environment variables.')
  }

  const cookieHeader = request.headers.get('cookie') || ''
  const cookies = cookieHeader
    .split(';')
    .map((cookie) => cookie.trim())
    .filter(Boolean)
    .map((cookie) => {
      const separatorIndex = cookie.indexOf('=')
      return {
        name: separatorIndex === -1 ? cookie : cookie.slice(0, separatorIndex),
        value: separatorIndex === -1 ? '' : cookie.slice(separatorIndex + 1),
      }
    })

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookies
      },
      setAll() {},
    },
  })
}

function getActiveCompanyIdFromRequest(request: Request) {
  const cookie = request.headers.get('cookie') || ''
  const match = cookie.match(/(?:^|;\s*)active_company_id=([^;]+)/)

  if (!match) return null

  try {
    const companyId = decodeURIComponent(match[1])
    return companyId && companyId !== 'single-company-fallback' ? companyId : null
  } catch {
    return null
  }
}

async function getRequestUserId(request: Request) {
  const supabaseAuth = getSupabaseAuth(request)
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser()

  return user?.id || null
}

async function assertLoanFeatureEnabled(supabase: any, companyId?: string | null, userId?: string | null) {
  if (!companyId || !userId) {
    throw new Error('Loan workflow is not enabled for this company.')
  }

  const { data: override, error: overrideError } = await supabase
    .from('user_feature_overrides')
    .select('enabled')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .eq('feature_key', 'loan_page')
    .maybeSingle()

  if (overrideError && overrideError.code !== 'PGRST116') {
    throw new Error(overrideError.message)
  }

  if (override) {
    if (override.enabled === true) return
    throw new Error('Loan workflow is not enabled for this user.')
  }

  const { data: feature, error: featureError } = await supabase
    .from('company_features')
    .select('enabled')
    .eq('company_id', companyId)
    .eq('feature_key', 'loan_page')
    .maybeSingle()

  if (featureError && featureError.code !== 'PGRST116') {
    throw new Error(featureError.message)
  }

  if (feature?.enabled === true) return

  throw new Error('Loan workflow is not enabled for this company.')
}

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function upper(value: any) {
  return text(value).toUpperCase()
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

async function loadLocationMappings(supabase: any, companyId?: string | null) {
  let query = supabase
    .from('integration_settings')
    .select('settings')
    .eq('channel', 'linnworks')

  if (companyId) {
    query = query.eq('company_id', companyId)
  }

  const { data, error } = await query.maybeSingle()

  if (error) return DEFAULT_LOCATION_MAPPINGS

  const saved =
    data?.settings?.location_mapping ||
    data?.settings?.location_mappings ||
    {}

  const mappings: Record<string, string> = { ...DEFAULT_LOCATION_MAPPINGS }

  for (const [appLocation, linnworksLocation] of Object.entries(saved)) {
    const key = upper(appLocation)
    const value = text(linnworksLocation)

    if (key && value) {
      mappings[key] = value
    }
  }

  return mappings
}

function appStorageLocation(value: any) {
  const clean = text(value)
  const key = upper(clean)

  if (!clean) return DEFAULT_STORAGE_LOCATION
  if (/^LOCATION-\d+$/i.test(clean)) return key

  if (key === 'DEFAULT' || key === 'WAREHOUSE') {
    const warehouseEntry = Object.entries(activeLocationMappings).find(([, mapped]) => {
      const mappedKey = upper(mapped)
      return mappedKey === 'DEFAULT' || mappedKey === 'WAREHOUSE'
    })

    return warehouseEntry?.[0] || DEFAULT_STORAGE_LOCATION
  }

  const displayMatch = Object.entries(activeLocationMappings).find(([, mapped]) => {
    return upper(mapped) === key
  })

  if (displayMatch?.[0]) return displayMatch[0]

  const shopMatch = key.match(/^SHOP-(\d+)$/)
  if (shopMatch) return `LOCATION-${Number(shopMatch[1]) + 1}`

  return key
}

function displayLocation(value: any) {
  const storage = appStorageLocation(value)

  if (storage === ON_LOAN_LOCATION) return ON_LOAN_LOCATION

  const mapped = activeLocationMappings[storage]
  if (!mapped) return storage

  if (upper(mapped) === 'DEFAULT') return 'WAREHOUSE'

  return mapped
}

function canonicalBin(value: any, storageLocation: string) {
  const clean = text(value)

  if (clean) return clean

  if (appStorageLocation(storageLocation) === DEFAULT_STORAGE_LOCATION) {
    return DEFAULT_BIN
  }

  if (displayLocation(storageLocation).toUpperCase().startsWith('SHOP-')) {
    return 'STOCK'
  }

  return DEFAULT_BIN
}

function isShopStorageLocation(value: any) {
  const storage = appStorageLocation(value)

  if (/^LOCATION-\d+$/.test(storage)) {
    return storage !== DEFAULT_STORAGE_LOCATION
  }

  return displayLocation(storage).toUpperCase().startsWith('SHOP-')
}

async function findItemByScan(supabase: any, scanValue: string, companyId?: string | null) {
  const clean = cleanScan(scanValue)
  const safe = escapePostgrestOrValue(clean)

  let query = supabase
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
      loan_returned_at,
      loan_notes,
      ai_title,
      basic_title
    `)
    .or(`sku.eq.${safe},barcode_number.eq.${safe}`)

  if (companyId) {
    query = query.eq('company_id', companyId)
  }

  const { data, error } = await query.maybeSingle()

  if (error) throw new Error(error.message)

  return data
}

async function getStockRows(supabase: any, itemId: string, companyId?: string | null) {
  let query = supabase
    .from('item_stock_locations')
    .select('id, item_id, sku, location_name, bin_code, stock_level')
    .eq('item_id', itemId)

  if (companyId) {
    query = query.eq('company_id', companyId)
  }

  const { data, error } = await query

  if (error) throw new Error(error.message)

  return (data || []) as StockRow[]
}

function getAvailableRows(rows: StockRow[]) {
  return rows
    .filter((row) => Number(row.stock_level || 0) > 0)
    .map((row) => {
      const storageLocation = appStorageLocation(row.location_name)
      const binCode = canonicalBin(row.bin_code, storageLocation)

      return {
        id: row.id,
        location_name: storageLocation,
        display_location: displayLocation(storageLocation),
        bin_code: binCode,
        stock_level: Number(row.stock_level || 0),
      }
    })
    .sort((a, b) => {
      const aKey = `${a.location_name}/${a.bin_code}`
      const bKey = `${b.location_name}/${b.bin_code}`
      return aKey.localeCompare(bKey, undefined, { numeric: true, sensitivity: 'base' })
    })
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

async function upsertStockRow(params: {
  supabase: any
  companyId?: string | null
  itemId: string
  sku: string
  locationName: string
  binCode: string
  stockLevelDelta: number
  source: string
}) {
  const locationName = appStorageLocation(params.locationName)
  const binCode = canonicalBin(params.binCode, locationName)
  const now = new Date().toISOString()

  let existingQuery = params.supabase
    .from('item_stock_locations')
    .select('id, stock_level')
    .eq('item_id', params.itemId)
    .eq('location_name', locationName)
    .eq('bin_code', binCode)
    .limit(1)

  if (params.companyId) {
    existingQuery = existingQuery.eq('company_id', params.companyId)
  }

  const { data, error } = await existingQuery

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

    return {
      id: existing.id,
      location_name: locationName,
      display_location: displayLocation(locationName),
      bin_code: binCode,
      stock_level: nextStock,
    }
  }

  const stockLevel = Math.max(0, params.stockLevelDelta)

  const { data: inserted, error: insertError } = await params.supabase
    .from('item_stock_locations')
    .insert({
      ...(params.companyId ? { company_id: params.companyId } : {}),
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

  return {
    ...inserted,
    display_location: displayLocation(inserted.location_name),
  }
}

async function updateItemSummary(params: {
  supabase: any
  companyId?: string | null
  itemId: string
  extra?: Record<string, any>
}) {
  const rows = await getStockRows(params.supabase, params.itemId, params.companyId)
  const stockLevel = rows.reduce((sum, row) => sum + Number(row.stock_level || 0), 0)
  const warehouseStock = rows
    .filter((row) => appStorageLocation(row.location_name) === DEFAULT_STORAGE_LOCATION)
    .reduce((sum, row) => sum + Number(row.stock_level || 0), 0)
  const shopFloorStock = rows
    .filter(
      (row) =>
        isShopStorageLocation(row.location_name) &&
        upper(row.bin_code) === 'FLOOR'
    )
    .reduce((sum, row) => sum + Number(row.stock_level || 0), 0)

  const displayRow =
    rows
      .filter((row) => Number(row.stock_level || 0) > 0)
      .sort((a, b) => Number(b.stock_level || 0) - Number(a.stock_level || 0))[0] || null

  const currentLocation = displayRow ? appStorageLocation(displayRow.location_name) : null

  const payload = {
    stock_level: stockLevel,
    warehouse_stock: warehouseStock,
    shop_floor_stock: shopFloorStock,
    current_location: currentLocation,
    current_bin: displayRow?.bin_code || null,
    updated_at: new Date().toISOString(),
    ...(params.extra || {}),
  }

  let query = params.supabase
    .from('items')
    .update(payload)
    .eq('id', params.itemId)

  if (params.companyId) {
    query = query.eq('company_id', params.companyId)
  }

  const { error } = await query

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
  companyId?: string | null
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
  const locationName = appStorageLocation(params.locationName)
  const binCode = canonicalBin(params.binCode, locationName)

  const { error } = await params.supabase
    .from('linnworks_sync_queue')
    .insert({
      ...(params.companyId ? { company_id: params.companyId } : {}),
      item_id: params.itemId,
      sku: params.sku,
      action: 'adjust_stock',
      payload: {
        sku: params.sku,
        delta: params.delta,
        quantity: Math.abs(params.delta),
        location: locationName,
        bin: binCode,
        reason: params.reason,
        source: 'dohpe_app',
        staff: params.staffName,
        [params.timestampField]: params.timestamp,
      },
      status: 'pending',
    })

  if (error) throw new Error(error.message)
}

async function fetchLoans(supabase: any, companyId?: string | null) {
  let query = supabase
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
      loan_returned_at,
      loan_notes,
      ai_title,
      basic_title
    `)
    .eq('loan_status', 'on_loan')
    .order('loaned_at', { ascending: false })

  if (companyId) {
    query = query.eq('company_id', companyId)
  }

  const { data, error } = await query

  if (error) throw new Error(error.message)

  return data || []
}

async function lookupLoanItem(params: {
  supabase: any
  companyId?: string | null
  scanValue: string
}) {
  const item = await findItemByScan(params.supabase, params.scanValue, params.companyId)

  if (!item) {
    throw new Error(`Item not found: ${cleanScan(params.scanValue)}`)
  }

  const stockRows = await getStockRows(params.supabase, item.id, params.companyId)

  return {
    item,
    available_locations: getAvailableRows(stockRows),
  }
}

async function loanOut(params: {
  supabase: any
  companyId?: string | null
  scanValue: string
  staffId: string
  staffName: string
  sourceLocation: string
  sourceBin: string
}) {
  const item = await findItemByScan(params.supabase, params.scanValue, params.companyId)

  if (!item) {
    throw new Error(`Item not found: ${cleanScan(params.scanValue)}`)
  }

  if (text(item.loan_status) === 'on_loan') {
    throw new Error(`${item.sku} is already on loan.`)
  }

  const sourceLocation = appStorageLocation(params.sourceLocation)
  const sourceBin = canonicalBin(params.sourceBin, sourceLocation)

  const stockRows = await getStockRows(params.supabase, item.id, params.companyId)
  const sourceRow = stockRows.find(
    (row) =>
      appStorageLocation(row.location_name) === sourceLocation &&
      canonicalBin(row.bin_code, sourceLocation).toUpperCase() === sourceBin.toUpperCase()
  )

  if (!sourceRow || Number(sourceRow.stock_level || 0) <= 0) {
    throw new Error(
      `${item.sku} has no available stock in ${displayLocation(sourceLocation)} / ${sourceBin}.`
    )
  }

  const beforeStock = Number(sourceRow.stock_level || 0)
  const afterStock = beforeStock - 1
  const now = new Date().toISOString()

  await setStockRowLevel({
    supabase: params.supabase,
    rowId: sourceRow.id,
    nextStock: afterStock,
    source: 'loan_out',
  })

  const loanNotes = JSON.stringify({
    source_location: sourceLocation,
    source_display_location: displayLocation(sourceLocation),
    source_bin: sourceBin,
    loaned_out_at: now,
    loaned_out_by: params.staffName,
  })

  let itemUpdateQuery = params.supabase
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

  if (params.companyId) {
    itemUpdateQuery = itemUpdateQuery.eq('company_id', params.companyId)
  }

  const { error: itemUpdateError } = await itemUpdateQuery

  if (itemUpdateError) throw new Error(itemUpdateError.message)

  const { error: loanInsertError } = await params.supabase
    .from('item_loans')
    .insert({
      ...(params.companyId ? { company_id: params.companyId } : {}),
      item_id: item.id,
      sku: item.sku,
      status: 'on_loan',
      loaned_at: now,
      loaned_by: params.staffId,
      source_location: sourceLocation,
      source_bin: sourceBin,
    })

  if (loanInsertError) throw new Error(loanInsertError.message)

  await insertQueueRow({
    supabase: params.supabase,
    companyId: params.companyId,
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
    companyId: params.companyId,
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
    source_display_location: displayLocation(sourceLocation),
    source_bin: sourceBin,
    before_stock: beforeStock,
    after_stock: afterStock,
    summary,
  }
}

async function returnLoan(params: {
  supabase: any
  companyId?: string | null
  scanValue: string
  staffId: string
  staffName: string
  returnLocation: string
  returnBin: string
}) {
  const item = await findItemByScan(params.supabase, params.scanValue, params.companyId)

  if (!item) {
    throw new Error(`Item not found: ${cleanScan(params.scanValue)}`)
  }

  if (text(item.loan_status) !== 'on_loan') {
    throw new Error(`${item.sku} is not currently on loan.`)
  }

  const returnLocation = appStorageLocation(params.returnLocation)
  const returnBin = canonicalBin(params.returnBin, returnLocation)
  const now = new Date().toISOString()

  const returnedRow = await upsertStockRow({
    supabase: params.supabase,
    companyId: params.companyId,
    itemId: item.id,
    sku: item.sku,
    locationName: returnLocation,
    binCode: returnBin,
    stockLevelDelta: 1,
    source: 'loan_return',
  })

  let loanUpdateQuery = params.supabase
    .from('item_loans')
    .update({
      status: 'returned',
      returned_at: now,
      returned_by: params.staffId,
      return_location: returnLocation,
      return_bin: returnBin,
      updated_at: now,
    })
    .eq('item_id', item.id)
    .eq('status', 'on_loan')

  if (params.companyId) {
    loanUpdateQuery = loanUpdateQuery.eq('company_id', params.companyId)
  }

  const { error: loanUpdateError } = await loanUpdateQuery

  if (loanUpdateError) throw new Error(loanUpdateError.message)

  let itemUpdateQuery = params.supabase
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

  if (params.companyId) {
    itemUpdateQuery = itemUpdateQuery.eq('company_id', params.companyId)
  }

  const { error: itemUpdateError } = await itemUpdateQuery

  if (itemUpdateError) throw new Error(itemUpdateError.message)

  await insertQueueRow({
    supabase: params.supabase,
    companyId: params.companyId,
    itemId: item.id,
    sku: item.sku,
    delta: 1,
    locationName: returnLocation,
    binCode: returnBin,
    reason: 'loan_return',
    staffName: params.staffName,
    timestampField: 'returned_at',
    timestamp: now,
  })

  const summary = await updateItemSummary({
    supabase: params.supabase,
    companyId: params.companyId,
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
    destination_location: returnLocation,
    destination_display_location: displayLocation(returnLocation),
    destination_bin: returnBin,
    returned_row: returnedRow,
    summary,
  }
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseAdmin()
    const companyId = getActiveCompanyIdFromRequest(request)
    const userId = await getRequestUserId(request)
    await assertLoanFeatureEnabled(supabase, companyId, userId)
    activeLocationMappings = await loadLocationMappings(supabase, companyId)
    const loans = await fetchLoans(supabase, companyId)

    return NextResponse.json({
      ok: true,
      loans,
    })
  } catch (error: any) {
    const status = String(error.message || '').includes('Loan workflow is not enabled') ? 403 : 500

    return NextResponse.json(
      {
        ok: false,
        message: error.message || 'Unknown loan list error.',
      },
      { status }
    )
  }
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseAdmin()
    const companyId = getActiveCompanyIdFromRequest(request)
    const userId = await getRequestUserId(request)
    await assertLoanFeatureEnabled(supabase, companyId, userId)
    activeLocationMappings = await loadLocationMappings(supabase, companyId)

    const body = await request.json().catch(() => ({}))

    const action = text(body.action) as LoanAction
    const scanValue = cleanScan(body.scan_value || body.sku)
    const staffId = text(body.staff_id)
    const staffName = text(body.staff_name) || 'staff'

    if (!action || !['lookup', 'loan_out', 'return'].includes(action)) {
      return NextResponse.json({ ok: false, message: 'Invalid loan action.' }, { status: 400 })
    }

    if (!scanValue) {
      return NextResponse.json({ ok: false, message: 'Missing scanned SKU/barcode.' }, { status: 400 })
    }

    if (action === 'lookup') {
      const result = await lookupLoanItem({ supabase, companyId, scanValue })

      return NextResponse.json({
        ok: true,
        result,
      })
    }

    if (!staffId) {
      return NextResponse.json({ ok: false, message: 'Missing staff id.' }, { status: 400 })
    }

    if (action === 'loan_out') {
      const sourceLocation = text(body.source_location)
      const sourceBin = text(body.source_bin)

      if (!sourceLocation || !sourceBin) {
        return NextResponse.json({ ok: false, message: 'Missing source location/bin.' }, { status: 400 })
      }

      const result = await loanOut({
        supabase,
        companyId,
        scanValue,
        staffId,
        staffName,
        sourceLocation,
        sourceBin,
      })

      return NextResponse.json({
        ok: true,
        message: `${result.item.sku} marked on loan from ${result.source_display_location} / ${result.source_bin}.`,
        result,
      })
    }

    const returnLocation = text(body.return_location)
    const returnBin = text(body.return_bin)

    if (!returnLocation || !returnBin) {
      return NextResponse.json({ ok: false, message: 'Missing return location/bin.' }, { status: 400 })
    }

    const result = await returnLoan({
      supabase,
      companyId,
      scanValue,
      staffId,
      staffName,
      returnLocation,
      returnBin,
    })

    return NextResponse.json({
      ok: true,
      message: `${result.item.sku} returned to ${result.destination_display_location} / ${result.destination_bin}.`,
      result,
    })
  } catch (error: any) {
    console.error('LOAN_ROUTE_ERROR', error)
    const status = String(error.message || '').includes('Loan workflow is not enabled') ? 403 : 500

    return NextResponse.json(
      {
        ok: false,
        message: error.message || 'Unknown loan action error.',
      },
      { status }
    )
  }
}

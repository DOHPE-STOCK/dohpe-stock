import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { requireCompanyAccess } from '@/lib/serverTenant'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type AccessResult =
  | { ok: true; user?: any; staff?: any }
  | { ok: false; status: number; message: string }

type LocationMappings = Record<string, string>

const DEFAULT_LOCATION_MAPPINGS: LocationMappings = {
  'LOCATION-1': 'Default',
  'LOCATION-2': 'SHOP-1',
  'LOCATION-3': 'SHOP-2',
  'LOCATION-4': 'SHOP-3',
  'LOCATION-5': 'SHOP-4',
  WAREHOUSE: 'Default',
  DEFAULT: 'Default',
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('Missing Supabase admin environment variables.')
  }

  return createClient(url, serviceKey)
}

async function requireAppLogin(): Promise<AccessResult> {
  const cookieStore = await cookies()

  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {},
      },
    }
  )

  const {
    data: { user },
    error,
  } = await supabaseAuth.auth.getUser()

  if (error || !user) {
    return { ok: false, status: 401, message: 'Login required.' }
  }

  return { ok: true, user }
}

function getActiveStaffFromRequest(request: Request) {
  const cookie = request.headers.get('cookie') || ''
  const match = cookie.match(/(?:^|;\s*)active_staff_user=([^;]+)/)

  if (!match) return null

  try {
    return JSON.parse(decodeURIComponent(match[1]))
  } catch {
    return null
  }
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

async function requireCheckoutPermission(
  request: Request,
  supabase: any,
  companyId?: string | null
): Promise<AccessResult> {
  const staffCookie = getActiveStaffFromRequest(request)

  if (!staffCookie?.id) {
    return { ok: false, status: 401, message: 'Staff PIN required.' }
  }

  let staffQuery = supabase
    .from('staff_users')
    .select('id, name, role, permissions, is_active')
    .eq('id', staffCookie.id)

  if (companyId) {
    staffQuery = staffQuery.eq('company_id', companyId)
  }

  const { data: staff, error } = await staffQuery.maybeSingle()

  if (error) throw new Error(error.message)

  if (!staff || staff.is_active === false) {
    return { ok: false, status: 403, message: 'Staff access denied.' }
  }

  const permissions = staff.permissions || {}
  const allowed = staff.role === 'admin' || permissions.checkout === true

  if (!allowed) {
    return { ok: false, status: 403, message: 'Checkout permission required.' }
  }

  return { ok: true, staff }
}

async function requirePosAccess(
  request: Request,
  supabase: any,
  companyId?: string | null
): Promise<AccessResult> {
  const login = await requireAppLogin()
  if (!login.ok) return login

  const staffAccess = await requireCheckoutPermission(request, supabase, companyId)
  if (!staffAccess.ok) return staffAccess

  return { ok: true, user: login.user, staff: staffAccess.staff }
}

function accessDeniedResponse(access: AccessResult) {
  if (access.ok) {
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json(
    { ok: false, message: access.message },
    { status: access.status }
  )
}

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function numberValue(value: any) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function canonical(value: any) {
  return text(value).toUpperCase()
}

async function loadLocationMappings(supabase: any, companyId?: string | null): Promise<LocationMappings> {
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

  const mappings: LocationMappings = { ...DEFAULT_LOCATION_MAPPINGS }

  for (const [appLocation, linnworksLocation] of Object.entries(saved)) {
    const appKey = canonical(appLocation)
    const mappedValue = text(linnworksLocation)

    if (appKey && mappedValue) {
      mappings[appKey] = mappedValue
    }
  }

  return mappings
}

function mapIncomingLocationToAppLocation(
  value: any,
  mappings: LocationMappings
) {
  const clean = text(value)
  const key = canonical(clean)

  if (!clean) return 'LOCATION-1'
  if (/^LOCATION-\d+$/i.test(clean)) return key

  if (key === 'DEFAULT' || key === 'WAREHOUSE') {
    const warehouseEntry = Object.entries(mappings).find(([, mapped]) => {
      const mappedKey = canonical(mapped)
      return mappedKey === 'DEFAULT' || mappedKey === 'WAREHOUSE'
    })

    return warehouseEntry?.[0] || 'LOCATION-1'
  }

  const displayMatch = Object.entries(mappings).find(([, mapped]) => {
    return canonical(mapped) === key
  })

  return displayMatch?.[0] || key
}

async function existingSaleCheck(supabase: any, sale: any, companyId?: string | null) {
  const saleId = text(sale?.id)
  const saleNumber = text(sale?.sale_number)

  if (!saleId && !saleNumber) return null

  let query = supabase.from('pos_sales').select('id, sale_number').limit(1)

  if (companyId) {
    query = query.eq('company_id', companyId)
  }

  if (saleId && saleNumber) {
    query = query.or(`id.eq.${saleId},sale_number.eq.${saleNumber}`)
  } else if (saleId) {
    query = query.eq('id', saleId)
  } else {
    query = query.eq('sale_number', saleNumber)
  }

  const { data, error } = await query.maybeSingle()

  if (error) throw new Error(`existing sale check failed: ${error.message}`)

  return data
}

async function recalcItemTotalStock(supabase: any, sku: string, companyId?: string | null) {
  const cleanSku = text(sku).toUpperCase()
  if (!cleanSku) return

  let stockQuery = supabase
    .from('item_stock_locations')
    .select('stock_level')
    .eq('sku', cleanSku)

  if (companyId) {
    stockQuery = stockQuery.eq('company_id', companyId)
  }

  const { data: stockRows, error: stockError } = await stockQuery

  if (stockError) {
    throw new Error(`stock total read failed for ${cleanSku}: ${stockError.message}`)
  }

  const totalStock = (stockRows || []).reduce(
    (sum: number, row: any) => sum + numberValue(row.stock_level),
    0
  )

  let itemQuery = supabase
    .from('items')
    .update({
      stock_level: totalStock,
      updated_at: new Date().toISOString(),
    })
    .eq('sku', cleanSku)

  if (companyId) {
    itemQuery = itemQuery.eq('company_id', companyId)
  }

  const { error: itemError } = await itemQuery

  if (itemError) {
    throw new Error(`item stock total update failed for ${cleanSku}: ${itemError.message}`)
  }
}

async function applyLocalFirstStockAdjustments(
  supabase: any,
  queueRows: any[],
  companyId?: string | null
) {
  const warnings: string[] = []

  const localRows = queueRows.filter((queueRow) => {
    const payload = queueRow?.payload || {}
    const action = text(queueRow?.action)
    const reason = text(payload?.reason)

    return (
      action === 'adjust_stock' &&
      payload?.local_first === true &&
      !reason.startsWith('transfer_')
    )
  })

  if (localRows.length === 0) {
    return { adjusted: 0, warnings }
  }

  const mappings = await loadLocationMappings(supabase, companyId)
  const touchedSkus = new Set<string>()
  let adjusted = 0

  for (const queueRow of localRows) {
    const payload = queueRow?.payload || {}
    const sku = text(queueRow?.sku || payload?.sku).toUpperCase()
    const delta = numberValue(payload?.delta)
    const reason = text(payload?.reason) || 'pos_local_first'
    const requestedLocation = mapIncomingLocationToAppLocation(
      payload?.location,
      mappings
    )

    if (!sku || delta === 0) continue

    if (delta > 0) {
      const targetLocation = requestedLocation || 'LOCATION-1'
      const targetBin = targetLocation === 'LOCATION-1' ? 'Default' : 'FLOOR'

      let readQuery = supabase
        .from('item_stock_locations')
        .select('id, stock_level')
        .eq('sku', sku)
        .eq('location_name', targetLocation)
        .eq('bin_code', targetBin)

      if (companyId) {
        readQuery = readQuery.eq('company_id', companyId)
      }

      const { data: existingRow, error: readError } = await readQuery.maybeSingle()

      if (readError) {
        warnings.push(`${sku}: local positive stock read failed: ${readError.message}`)
        continue
      }

      if (existingRow) {
        const { error: updateError } = await supabase
          .from('item_stock_locations')
          .update({
            stock_level: numberValue(existingRow.stock_level) + delta,
            source: reason,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingRow.id)

        if (updateError) {
          warnings.push(`${sku}: local positive stock update failed: ${updateError.message}`)
          continue
        }
      } else {
        let itemQuery = supabase
          .from('items')
          .select('id')
          .eq('sku', sku)

        if (companyId) {
          itemQuery = itemQuery.eq('company_id', companyId)
        }

        const { data: item, error: itemError } = await itemQuery.maybeSingle()

        if (itemError || !item?.id) {
          warnings.push(`${sku}: item lookup failed for local positive stock.`)
          continue
        }

        const { error: insertError } = await supabase
          .from('item_stock_locations')
          .insert({
            ...(companyId ? { company_id: companyId } : {}),
            item_id: item.id,
            sku,
            location_name: targetLocation,
            bin_code: targetBin,
            stock_level: delta,
            source: reason,
            updated_at: new Date().toISOString(),
          })

        if (insertError) {
          warnings.push(`${sku}: local positive stock insert failed: ${insertError.message}`)
          continue
        }
      }

      touchedSkus.add(sku)
      adjusted += delta
      continue
    }

    const deductionAmount = Math.abs(delta)

    const candidateLocations =
      requestedLocation === 'LOCATION-1'
        ? [{ location_name: 'LOCATION-1', bin_code: 'Default' }]
        : [
            { location_name: requestedLocation, bin_code: 'FLOOR' },
            { location_name: requestedLocation, bin_code: 'STOCK' },
            { location_name: 'LOCATION-1', bin_code: 'Default' },
          ]

    let remainingToDeduct = deductionAmount

    for (const candidate of candidateLocations) {
      if (remainingToDeduct <= 0) break

      let stockQuery = supabase
        .from('item_stock_locations')
        .select('id, stock_level')
        .eq('sku', sku)
        .eq('location_name', candidate.location_name)
        .eq('bin_code', candidate.bin_code)

      if (companyId) {
        stockQuery = stockQuery.eq('company_id', companyId)
      }

      const { data: stockRow, error: readError } = await stockQuery.maybeSingle()

      if (readError) {
        warnings.push(`${sku}: stock read failed at ${candidate.location_name}/${candidate.bin_code}: ${readError.message}`)
        continue
      }

      if (!stockRow) continue

      const currentStock = numberValue(stockRow.stock_level)
      if (currentStock <= 0) continue

      const deductNow = Math.min(currentStock, remainingToDeduct)

      const { error: updateError } = await supabase
        .from('item_stock_locations')
        .update({
          stock_level: currentStock - deductNow,
          source: reason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', stockRow.id)

      if (updateError) {
        warnings.push(`${sku}: stock update failed at ${candidate.location_name}/${candidate.bin_code}: ${updateError.message}`)
        continue
      }

      remainingToDeduct -= deductNow
      adjusted += deductNow
      touchedSkus.add(sku)
    }

    if (remainingToDeduct > 0) {
      warnings.push(
        `${sku}: sale completed but no local stock was available for ${remainingToDeduct} unit(s).`
      )
    }
  }

  for (const sku of touchedSkus) {
    try {
      await recalcItemTotalStock(supabase, sku, companyId)
    } catch (error: any) {
      warnings.push(`${sku}: total stock recalc failed: ${error.message}`)
    }
  }

  return { adjusted, warnings }
}

async function insertQueueRowsIdempotently(
  supabase: any,
  queueRows: any[],
  companyId?: string | null
) {
  let inserted = 0
  let skipped = 0

  for (const queueRow of queueRows) {
    const saleId = text(queueRow?.payload?.sale_id)
    const sku = text(queueRow?.sku || queueRow?.payload?.sku)
    const reason = text(queueRow?.payload?.reason)
    const delta = text(queueRow?.payload?.delta)
    const action = text(queueRow?.action)

    if (!saleId || !sku || !reason || !action) {
      const { error } = await supabase.from('linnworks_sync_queue').insert(queueRow)
      if (error) throw new Error(`queue insert failed: ${error.message}`)
      inserted += 1
      continue
    }

    let existingQuery = supabase
      .from('linnworks_sync_queue')
      .select('id')
      .eq('sku', sku)
      .eq('action', action)
      .eq('payload->>sale_id', saleId)
      .eq('payload->>reason', reason)
      .eq('payload->>delta', delta)
      .limit(1)

    if (companyId) {
      existingQuery = existingQuery.eq('company_id', companyId)
    }

    const { data: existing, error: existingError } = await existingQuery

    if (existingError) {
      throw new Error(`queue duplicate check failed: ${existingError.message}`)
    }

    if (existing && existing.length > 0) {
      skipped += 1
      continue
    }

    const { error: insertError } = await supabase
      .from('linnworks_sync_queue')
      .insert(queueRow)

    if (insertError) {
      throw new Error(`queue insert failed: ${insertError.message}`)
    }

    inserted += 1
  }

  return { inserted, skipped }
}

async function validateRefundLines(supabase: any, lines: any[], companyId?: string | null) {
  const refundLines = lines.filter((line: any) => text(line.original_line_id))
  if (refundLines.length === 0) return

  const refundByOriginalLineId = new Map<string, number>()

  for (const line of refundLines) {
    const originalLineId = text(line.original_line_id)
    const qty = numberValue(line.quantity)

    if (!originalLineId) continue

    if (qty <= 0) {
      throw new Error(`Invalid refund quantity for original line ${originalLineId}.`)
    }

    refundByOriginalLineId.set(
      originalLineId,
      (refundByOriginalLineId.get(originalLineId) || 0) + qty
    )
  }

  const originalLineIds = Array.from(refundByOriginalLineId.keys())
  if (originalLineIds.length === 0) return

  let originalLinesQuery = supabase
    .from('pos_sale_lines')
    .select('id, quantity, refunded_quantity, max_refundable_quantity, sku')
    .in('id', originalLineIds)

  if (companyId) {
    originalLinesQuery = originalLinesQuery.eq('company_id', companyId)
  }

  const { data: originalLines, error } = await originalLinesQuery

  if (error) throw new Error(`refund validation read failed: ${error.message}`)

  const originalById = new Map<string, any>(
    (originalLines || []).map((line: any) => [line.id, line])
  )

  for (const originalLineId of originalLineIds) {
    const originalLine = originalById.get(originalLineId)

    if (!originalLine) {
      throw new Error(`Original sale line not found for refund: ${originalLineId}`)
    }

    const requestedQty = refundByOriginalLineId.get(originalLineId) || 0
    const originalQty = numberValue(originalLine.quantity)
    const currentRefundedQty = numberValue(originalLine.refunded_quantity)
    const maxRefundableQty =
      originalLine.max_refundable_quantity === null ||
      originalLine.max_refundable_quantity === undefined
        ? originalQty
        : numberValue(originalLine.max_refundable_quantity)

    const remainingRefundableQty = Math.max(
      0,
      Math.min(originalQty, maxRefundableQty) - currentRefundedQty
    )

    if (requestedQty > remainingRefundableQty) {
      throw new Error(
        `Refund blocked for ${originalLine.sku || originalLineId}. Requested ${requestedQty}, only ${remainingRefundableQty} refundable.`
      )
    }
  }
}

async function updateRefundQuantitiesSafely(supabase: any, lines: any[], companyId?: string | null) {
  const refundLines = lines.filter((line: any) => text(line.original_line_id))
  if (refundLines.length === 0) return

  const refundByOriginalLineId = new Map<string, number>()

  for (const line of refundLines) {
    const originalLineId = text(line.original_line_id)
    const qty = numberValue(line.quantity)

    if (!originalLineId || qty <= 0) continue

    refundByOriginalLineId.set(
      originalLineId,
      (refundByOriginalLineId.get(originalLineId) || 0) + qty
    )
  }

  for (const [originalLineId, qty] of refundByOriginalLineId.entries()) {
    let originalLineQuery = supabase
      .from('pos_sale_lines')
      .select('id, quantity, refunded_quantity, max_refundable_quantity, sku')
      .eq('id', originalLineId)

    if (companyId) {
      originalLineQuery = originalLineQuery.eq('company_id', companyId)
    }

    const { data: originalLine, error: readError } = await originalLineQuery.maybeSingle()

    if (readError) throw new Error(`refund read failed: ${readError.message}`)

    if (!originalLine) {
      throw new Error(`Original sale line not found for refund: ${originalLineId}`)
    }

    const originalQty = numberValue(originalLine.quantity)
    const currentRefundedQty = numberValue(originalLine.refunded_quantity)
    const maxRefundableQty =
      originalLine.max_refundable_quantity === null ||
      originalLine.max_refundable_quantity === undefined
        ? originalQty
        : numberValue(originalLine.max_refundable_quantity)

    const allowedTotalRefunded = Math.min(originalQty, maxRefundableQty)
    const nextRefundedQty = currentRefundedQty + qty

    if (nextRefundedQty > allowedTotalRefunded) {
      throw new Error(
        `Refund blocked for ${originalLine.sku || originalLineId}. Requested total ${nextRefundedQty}, max refundable ${allowedTotalRefunded}.`
      )
    }

    let updateQuery = supabase
      .from('pos_sale_lines')
      .update({ refunded_quantity: nextRefundedQty })
      .eq('id', originalLineId)
      .lte('refunded_quantity', allowedTotalRefunded - qty)

    if (companyId) {
      updateQuery = updateQuery.eq('company_id', companyId)
    }

    const { error: updateError } = await updateQuery

    if (updateError) {
      throw new Error(`refund quantity update failed: ${updateError.message}`)
    }
  }
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseAdmin()
    const requestCompanyId = getActiveCompanyIdFromRequest(request)

    const companyAccess = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member'])
    if (!companyAccess.ok) {
      return NextResponse.json({ ok: false, message: companyAccess.message }, { status: companyAccess.status })
    }

    if (!requestCompanyId || requestCompanyId !== companyAccess.company.id) {
      return NextResponse.json({ ok: false, message: 'Active company required.' }, { status: 400 })
    }

    const access = await requirePosAccess(request, supabase, requestCompanyId)
    if (!access.ok) return accessDeniedResponse(access)

    const tx = await request.json()
    const { lines, queueRows, ...sale } = tx
    const activeCompanyId = requestCompanyId

    if (sale.company_id && sale.company_id !== activeCompanyId) {
      return NextResponse.json({ ok: false, message: 'Company mismatch.' }, { status: 403 })
    }
    sale.company_id = activeCompanyId

    if (!sale?.id || !sale?.sale_number) {
      return NextResponse.json(
        { ok: false, message: 'Missing sale id or sale_number.' },
        { status: 400 }
      )
    }

    const safeLines = (Array.isArray(lines) ? lines : []).map((line) => ({
      ...line,
      company_id: activeCompanyId,
    }))
    const safeQueueRows = (Array.isArray(queueRows) ? queueRows : []).map((queueRow) => ({
      ...queueRow,
      company_id: activeCompanyId,
    }))

    if (numberValue(sale.total) > 0 && safeLines.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          message:
            'Blocked POS save: sale has a total but no sale lines. This prevents completed sales with missing basket lines.',
        },
        { status: 400 }
      )
    }

    const existingSale = await existingSaleCheck(supabase, sale, activeCompanyId)

    if (existingSale) {
      return NextResponse.json({
        ok: true,
        idempotent: true,
        message: 'Transaction already saved.',
        sale_id: existingSale.id,
        sale_number: existingSale.sale_number,
        queue_rows_inserted: 0,
        queue_rows_skipped: 0,
        local_stock_adjusted: 0,
        local_stock_warnings: [],
        lines: 0,
      })
    }

    await validateRefundLines(supabase, safeLines, activeCompanyId)

    const { error: saleError } = await supabase.from('pos_sales').insert(sale)
    if (saleError) throw new Error(`pos_sales insert failed: ${saleError.message}`)

    if (safeLines.length > 0) {
      const { error: linesError } = await supabase
        .from('pos_sale_lines')
        .insert(safeLines)

      if (linesError) {
        await supabase.from('pos_sales').delete().eq('id', sale.id)
        throw new Error(`pos_sale_lines insert failed: ${linesError.message}`)
      }
    }

    await updateRefundQuantitiesSafely(supabase, safeLines, activeCompanyId)

    const localStockResult = await applyLocalFirstStockAdjustments(
      supabase,
      safeQueueRows,
      activeCompanyId
    )

    const queueResult =
      safeQueueRows.length > 0
        ? await insertQueueRowsIdempotently(supabase, safeQueueRows, activeCompanyId)
        : { inserted: 0, skipped: 0 }

    return NextResponse.json({
      ok: true,
      sale_number: sale.sale_number,
      sale_id: sale.id,
      queue_rows_inserted: queueResult.inserted,
      queue_rows_skipped: queueResult.skipped,
      local_stock_adjusted: localStockResult.adjusted,
      local_stock_warnings: localStockResult.warnings,
      lines: safeLines.length,
    })
  } catch (error: any) {
    console.error('POS_SAVE_TRANSACTION_ERROR', error)

    return NextResponse.json(
      {
        ok: false,
        message: error.message || 'Unknown POS transaction save error.',
      },
      { status: 500 }
    )
  }
}

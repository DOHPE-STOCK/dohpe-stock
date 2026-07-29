import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { updateLoopbaseOrderLineStatus } from '@/lib/orderManagement'
import { recalculateStockSummaryForSku, updateStockReservationStatus } from '@/lib/stockSummary'

export const dynamic = 'force-dynamic'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('Missing Supabase admin environment variables.')
  }

  return createClient(url, serviceKey)
}

function text(value: unknown) {
  return String(value || '').trim()
}

function numberValue(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function reservationStatusForLineStatus(status: string) {
  if (status === 'cancelled') return 'cancelled'
  if (status === 'dispatched') return 'deducted'
  return null
}

async function findItemBySku(supabase: any, companyId: string, sku: string) {
  const { data, error } = await supabase
    .from('items')
    .select('id, company_id, sku, pick_policy')
    .eq('company_id', companyId)
    .eq('sku', sku)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data || null
}

function normalisePickPolicy(value: unknown) {
  const policy = text(value).toLowerCase()
  if (policy === 'require_bin_scan') return 'require_bin_scan'
  if (policy === 'no_scan') return 'no_scan'
  if (policy === 'scan_if_multiple_bins') return 'scan_if_multiple_bins'
  return 'scan_if_multiple_bins'
}

function isQuarantineBin(row: any) {
  const binType = text(row?.warehouse_bins?.bin_type).toLowerCase()
  const binCode = text(row?.bin_code).toUpperCase()
  return binType === 'quarantine' || binCode.includes('QUARANTINE') || binCode.startsWith('QTINE') || binCode.startsWith('QT-')
}

async function getPickableStockRows(supabase: any, companyId: string, itemId: string) {
  const { data, error } = await supabase
    .from('item_stock_locations')
    .select(
      `id, location_name, bin_code, stock_level,
      warehouse_bins:warehouse_bins(bin_type, is_active, is_pickable)`
    )
    .eq('company_id', companyId)
    .eq('item_id', itemId)
    .order('location_name', { ascending: true })
    .order('bin_code', { ascending: true })

  if (error) {
    const retry = await supabase
      .from('item_stock_locations')
      .select('id, location_name, bin_code, stock_level')
      .eq('company_id', companyId)
      .eq('item_id', itemId)
      .order('location_name', { ascending: true })
      .order('bin_code', { ascending: true })

    if (retry.error) throw new Error(retry.error.message)
    return retry.data || []
  }

  return (data || []).filter((row: any) => {
    const bin = Array.isArray(row.warehouse_bins) ? row.warehouse_bins[0] : row.warehouse_bins
    if (bin && bin.is_active === false) return false
    if (bin && bin.is_pickable === false) return false
    return !isQuarantineBin({ ...row, warehouse_bins: bin })
  })
}

function autoAllocationsFromRows(params: {
  rows: any[]
  quantity: number
  policy: string
}) {
  const positiveRows = params.rows
    .filter((row) => numberValue(row.stock_level) > 0)
    .sort((a, b) => {
      const aDefault = text(a.bin_code).toLowerCase() === 'default' ? 0 : 1
      const bDefault = text(b.bin_code).toLowerCase() === 'default' ? 0 : 1
      if (aDefault !== bDefault) return aDefault - bDefault
      return `${text(a.location_name)}:${text(a.bin_code)}`.localeCompare(
        `${text(b.location_name)}:${text(b.bin_code)}`
      )
    })

  if (params.policy === 'require_bin_scan') {
    return {
      ok: false,
      reason: 'pick_allocation_required',
      message: 'Dispatch blocked. This SKU requires bin scan allocation.',
      allocations: [],
    }
  }

  if (positiveRows.length === 1) {
    return {
      ok: true,
      reason: 'single_pickable_row',
      allocations: [
        {
          location_name: positiveRows[0].location_name,
          bin_code: positiveRows[0].bin_code,
          quantity: params.quantity,
        },
      ],
    }
  }

  if (positiveRows.length > 1 && params.policy === 'scan_if_multiple_bins') {
    return {
      ok: false,
      reason: 'multiple_pickable_rows',
      message: 'Dispatch blocked. This SKU has stock in multiple pickable bins, so scan/pick allocation is required.',
      allocations: [],
      pickable_rows: positiveRows,
    }
  }

  if (params.policy !== 'no_scan') {
    return {
      ok: false,
      reason: 'pick_allocation_required',
      message: 'Dispatch blocked. Pick allocation is required for this SKU.',
      allocations: [],
      pickable_rows: positiveRows,
    }
  }

  const allocations: any[] = []
  let remaining = params.quantity

  for (const row of positiveRows) {
    if (remaining <= 0) break
    const quantity = Math.min(numberValue(row.stock_level), remaining)
    if (quantity <= 0) continue
    allocations.push({
      location_name: row.location_name,
      bin_code: row.bin_code,
      quantity,
    })
    remaining -= quantity
  }

  if (remaining > 0) {
    const fallback = positiveRows[0] || params.rows[0]
    if (!fallback?.location_name || !fallback?.bin_code) {
      return {
        ok: false,
        reason: 'no_pickable_rows',
        message: 'Dispatch blocked. No pickable stock rows were found for automatic deduction.',
        allocations: [],
      }
    }

    allocations.push({
      location_name: fallback.location_name,
      bin_code: fallback.bin_code,
      quantity: remaining,
    })
  }

  return {
    ok: true,
    reason: 'no_scan_auto_allocation',
    allocations,
    pickable_rows: positiveRows,
  }
}

async function getActiveReservations(params: {
  supabase: any
  companyId: string
  source: string
  externalOrderId: string
  sku: string
}) {
  const { data, error } = await params.supabase
    .from('stock_reservations')
    .select('id, quantity, stock_already_deducted, reservation_status')
    .eq('company_id', params.companyId)
    .eq('source', params.source)
    .eq('external_order_id', params.externalOrderId)
    .eq('sku', params.sku)
    .eq('reservation_status', 'active')

  if (error) {
    const message = String(error.message || '')
    const code = String(error.code || '')
    if (code === '42P01' || message.includes('stock_reservations')) return []
    throw new Error(error.message)
  }

  return data || []
}

async function deductAllocation(params: {
  supabase: any
  companyId: string
  itemId: string
  sku: string
  locationName: string
  binCode: string
  quantity: number
  source: string
}) {
  const now = new Date().toISOString()
  const { data: existing, error: readError } = await params.supabase
    .from('item_stock_locations')
    .select('id, stock_level')
    .eq('company_id', params.companyId)
    .eq('item_id', params.itemId)
    .eq('location_name', params.locationName)
    .eq('bin_code', params.binCode)
    .limit(1)

  if (readError) throw new Error(readError.message)

  const row = existing?.[0]
  const currentStock = numberValue(row?.stock_level)
  const nextStock = currentStock - params.quantity

  if (row?.id) {
    const { error } = await params.supabase
      .from('item_stock_locations')
      .update({
        sku: params.sku,
        stock_level: nextStock,
        source: params.source,
        updated_at: now,
      })
      .eq('id', row.id)

    if (error) throw new Error(error.message)

    return {
      location_name: params.locationName,
      bin_code: params.binCode,
      current_stock: currentStock,
      next_stock: nextStock,
    }
  }

  const { error } = await params.supabase
    .from('item_stock_locations')
    .insert({
      company_id: params.companyId,
      item_id: params.itemId,
      sku: params.sku,
      location_name: params.locationName,
      location_id: null,
      bin_code: params.binCode,
      stock_level: nextStock,
      source: params.source,
      synced_at: null,
      updated_at: now,
    })

  if (error) throw new Error(error.message)

  return {
    location_name: params.locationName,
    bin_code: params.binCode,
    current_stock: 0,
    next_stock: nextStock,
  }
}

async function syncItemStockTotal(supabase: any, companyId: string, itemId: string) {
  const { data, error } = await supabase
    .from('item_stock_locations')
    .select('stock_level')
    .eq('company_id', companyId)
    .eq('item_id', itemId)

  if (error) throw new Error(error.message)

  const total = (data || []).reduce((sum: number, row: any) => sum + numberValue(row.stock_level), 0)
  const { error: updateError } = await supabase
    .from('items')
    .update({
      stock_level: total,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)
    .eq('id', itemId)

  if (updateError) throw new Error(updateError.message)
  return total
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, message: 'Unauthorised.' }, { status: 401 })
  }

  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json().catch(() => ({}))

    const companyId = text(body.company_id || body.companyId)
    const source = text(body.order_source || body.source)
    const externalOrderId = text(body.external_order_id || body.externalOrderId || body.order_id)
    const status = text(body.status || body.line_status || body.lineStatus).toLowerCase()
    const lines = Array.isArray(body.lines) ? body.lines : []

    if (!companyId || !source || !externalOrderId || !status) {
      return NextResponse.json(
        { ok: false, message: 'company_id, source, external_order_id and status are required.' },
        { status: 400 }
      )
    }

    if (!['open', 'reserved', 'picking', 'picked', 'dispatched', 'cancelled', 'failed', 'on_hold'].includes(status)) {
      return NextResponse.json({ ok: false, message: 'Invalid status.' }, { status: 400 })
    }

    const results = []

    for (const line of lines) {
      const sku = text(line.sku).toUpperCase()
      const quantity = Math.max(0, numberValue(line.quantity, line.cancelled_quantity || line.dispatched_quantity || 0))

      if (!sku) {
        results.push({ sku, ok: false, message: 'Line skipped because SKU is missing.' })
        continue
      }

      const item = await findItemBySku(supabase, companyId, sku)
      const activeReservations = await getActiveReservations({
        supabase,
        companyId,
        source,
        externalOrderId,
        sku,
      })
      const reservationOnlyQuantity = activeReservations
        .filter((reservation: any) => reservation.stock_already_deducted !== true)
        .reduce((total: number, reservation: any) => total + numberValue(reservation.quantity), 0)
      const allocationRows = Array.isArray(line.allocations) ? line.allocations : []
      const requiredDispatchQuantity = Math.max(quantity, reservationOnlyQuantity)
      const allocationResults: any[] = []
      let allocationSource = 'supplied'

      if (status === 'dispatched' && reservationOnlyQuantity > 0) {
        if (!item?.id) {
          results.push({
            sku,
            ok: false,
            message: 'Cannot dispatch reservation-only order because the item was not found.',
          })
          continue
        }

        let effectiveAllocations = allocationRows
        let allocationQuantity = effectiveAllocations.reduce(
          (total: number, allocation: any) => total + Math.max(0, numberValue(allocation.quantity)),
          0
        )

        if (effectiveAllocations.length === 0) {
          const pickableRows = await getPickableStockRows(supabase, companyId, item.id)
          const inferred = autoAllocationsFromRows({
            rows: pickableRows,
            quantity: requiredDispatchQuantity,
            policy: normalisePickPolicy(item.pick_policy),
          })

          if (!inferred.ok) {
            results.push({
              sku,
              ok: false,
              message: inferred.message,
              reason: inferred.reason,
              required_quantity: requiredDispatchQuantity,
              pick_policy: normalisePickPolicy(item.pick_policy),
              pickable_rows: inferred.pickable_rows || [],
            })
            continue
          }

          effectiveAllocations = inferred.allocations
          allocationSource = inferred.reason
          allocationQuantity = effectiveAllocations.reduce(
            (total: number, allocation: any) => total + Math.max(0, numberValue(allocation.quantity)),
            0
          )
        }

        if (effectiveAllocations.length === 0 || allocationQuantity < requiredDispatchQuantity) {
          results.push({
            sku,
            ok: false,
            message:
              'Dispatch blocked. This order is reservation-only, so stock must be physically deducted with pick allocations first.',
            required_quantity: requiredDispatchQuantity,
            allocated_quantity: allocationQuantity,
          })
          continue
        }

        for (const allocation of effectiveAllocations) {
          const locationName = text(allocation.location_name || allocation.locationName)
          const binCode = text(allocation.bin_code || allocation.binCode)
          const allocationQty = Math.max(0, numberValue(allocation.quantity))

          if (!locationName || !binCode || allocationQty <= 0) continue

          allocationResults.push(
            await deductAllocation({
              supabase,
              companyId,
              itemId: item.id,
              sku,
              locationName,
              binCode,
              quantity: allocationQty,
              source: `${source}_order_dispatch`,
            })
          )
        }

        await syncItemStockTotal(supabase, companyId, item.id)
      }

      const orderUpdate = await updateLoopbaseOrderLineStatus({
        supabase,
        companyId,
        source,
        externalOrderId,
        sku,
        status: status as 'open' | 'reserved' | 'picking' | 'picked' | 'dispatched' | 'cancelled' | 'failed' | 'on_hold',
        quantity,
      })

      const reservationStatus = reservationStatusForLineStatus(status)
      const reservationUpdate = reservationStatus
        ? await updateStockReservationStatus({
            supabase,
            companyId,
            source,
            externalOrderId,
            sku,
            status: reservationStatus as 'cancelled' | 'deducted',
            releaseReason: status === 'cancelled' ? 'order_cancelled' : null,
          })
        : { updated: 0 }

      await recalculateStockSummaryForSku(supabase, companyId, sku)

      results.push({
        sku,
        ok: true,
        order_lines_updated: orderUpdate.updated,
        reservations_updated: reservationUpdate.updated,
        allocation_source: allocationSource,
        allocation_deductions: allocationResults,
      })
    }

    return NextResponse.json({
      ok: true,
      company_id: companyId,
      source,
      external_order_id: externalOrderId,
      status,
      lines: results,
    })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'Order status update failed.' },
      { status: 500 }
    )
  }
}

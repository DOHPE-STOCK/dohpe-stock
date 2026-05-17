import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('Missing Supabase admin environment variables.')
  }

  return createClient(url, serviceKey)
}

type AccessResult =
  | { ok: true; user?: any; staff?: any }
  | { ok: false; status: number; message: string }

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
        setAll() {
          // no-op: API auth check only
        },
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

async function requireCheckoutPermission(request: Request, supabase: any): Promise<AccessResult> {
  const staffCookie = getActiveStaffFromRequest(request)

  if (!staffCookie?.id) {
    return { ok: false, status: 401, message: 'Staff PIN required.' }
  }

  const { data: staff, error } = await supabase
    .from('staff_users')
    .select('id, name, role, permissions, is_active')
    .eq('id', staffCookie.id)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

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

async function requirePosAccess(request: Request, supabase: any): Promise<AccessResult> {
  const login = await requireAppLogin()

  if (!login.ok) return login

  const staffAccess = await requireCheckoutPermission(request, supabase)

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

async function existingSaleCheck(supabase: any, sale: any) {
  const saleId = text(sale?.id)
  const saleNumber = text(sale?.sale_number)

  if (!saleId && !saleNumber) return null

  let query = supabase
    .from('pos_sales')
    .select('id, sale_number')
    .limit(1)

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

async function insertQueueRowsIdempotently(supabase: any, queueRows: any[]) {
  let inserted = 0
  let skipped = 0

  for (const queueRow of queueRows) {
    const saleId = text(queueRow?.payload?.sale_id)
    const sku = text(queueRow?.sku || queueRow?.payload?.sku)
    const reason = text(queueRow?.payload?.reason)
    const delta = text(queueRow?.payload?.delta)
    const action = text(queueRow?.action)

    if (!saleId || !sku || !reason || !action) {
      const { error } = await supabase
        .from('linnworks_sync_queue')
        .insert(queueRow)

      if (error) throw new Error(`queue insert failed: ${error.message}`)

      inserted += 1
      continue
    }

    const { data: existing, error: existingError } = await supabase
      .from('linnworks_sync_queue')
      .select('id')
      .eq('sku', sku)
      .eq('action', action)
      .eq('payload->>sale_id', saleId)
      .eq('payload->>reason', reason)
      .eq('payload->>delta', delta)
      .limit(1)

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

async function validateRefundLines(supabase: any, lines: any[]) {
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

  const { data: originalLines, error } = await supabase
    .from('pos_sale_lines')
    .select('id, quantity, refunded_quantity, max_refundable_quantity, sku')
    .in('id', originalLineIds)

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

async function updateRefundQuantitiesSafely(supabase: any, lines: any[]) {
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
    const { data: originalLine, error: readError } = await supabase
      .from('pos_sale_lines')
      .select('id, quantity, refunded_quantity, max_refundable_quantity, sku')
      .eq('id', originalLineId)
      .maybeSingle()

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

    const { error: updateError } = await supabase
      .from('pos_sale_lines')
      .update({
        refunded_quantity: nextRefundedQty,
      })
      .eq('id', originalLineId)
      .lte('refunded_quantity', allowedTotalRefunded - qty)

    if (updateError) {
      throw new Error(`refund quantity update failed: ${updateError.message}`)
    }
  }
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseAdmin()

    const access = await requirePosAccess(request, supabase)

    if (!access.ok) {
      return accessDeniedResponse(access)
    }

    const tx = await request.json()

    const { lines, queueRows, ...sale } = tx

    if (!sale?.id || !sale?.sale_number) {
      return NextResponse.json(
        { ok: false, message: 'Missing sale id or sale_number.' },
        { status: 400 }
      )
    }

    const safeLines = Array.isArray(lines) ? lines : []
    const safeQueueRows = Array.isArray(queueRows) ? queueRows : []

    const existingSale = await existingSaleCheck(supabase, sale)

    if (existingSale) {
      return NextResponse.json({
        ok: true,
        idempotent: true,
        message: 'Transaction already saved.',
        sale_id: existingSale.id,
        sale_number: existingSale.sale_number,
        queue_rows_inserted: 0,
        queue_rows_skipped: 0,
        lines: 0,
      })
    }

    await validateRefundLines(supabase, safeLines)

    const { error: saleError } = await supabase
      .from('pos_sales')
      .insert(sale)

    if (saleError) throw new Error(`pos_sales insert failed: ${saleError.message}`)

    if (safeLines.length > 0) {
      const { error: linesError } = await supabase
        .from('pos_sale_lines')
        .insert(safeLines)

      if (linesError) throw new Error(`pos_sale_lines insert failed: ${linesError.message}`)
    }

    await updateRefundQuantitiesSafely(supabase, safeLines)

    const queueResult =
      safeQueueRows.length > 0
        ? await insertQueueRowsIdempotently(supabase, safeQueueRows)
        : { inserted: 0, skipped: 0 }

    return NextResponse.json({
      ok: true,
      sale_number: sale.sale_number,
      sale_id: sale.id,
      queue_rows_inserted: queueResult.inserted,
      queue_rows_skipped: queueResult.skipped,
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

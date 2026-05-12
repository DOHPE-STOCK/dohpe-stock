import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

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

async function existingSaleCheck(supabase: any, sale: any) {
  const saleId = text(sale?.id)
  const saleNumber = text(sale?.sale_number)

  if (!saleId && !saleNumber) return null

  let query = supabase.from('pos_sales').select('id, sale_number').limit(1)

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
    const saleNumber = text(queueRow?.payload?.sale_number)
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

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseAdmin()
    const tx = await request.json()

    const { lines, queueRows, ...sale } = tx

    if (!sale?.id || !sale?.sale_number) {
      return NextResponse.json(
        { ok: false, message: 'Missing sale id or sale_number.' },
        { status: 400 }
      )
    }

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

    const { error: saleError } = await supabase
      .from('pos_sales')
      .insert(sale)

    if (saleError) throw new Error(`pos_sales insert failed: ${saleError.message}`)

    if (Array.isArray(lines) && lines.length > 0) {
      const { error: linesError } = await supabase
        .from('pos_sale_lines')
        .insert(lines)

      if (linesError) throw new Error(`pos_sale_lines insert failed: ${linesError.message}`)
    }

    const queueResult = Array.isArray(queueRows) && queueRows.length > 0
      ? await insertQueueRowsIdempotently(supabase, queueRows)
      : { inserted: 0, skipped: 0 }

    if (Array.isArray(lines)) {
      for (const line of lines.filter((line: any) => line.original_line_id)) {
        const { data: originalLine, error: readError } = await supabase
          .from('pos_sale_lines')
          .select('refunded_quantity')
          .eq('id', line.original_line_id)
          .maybeSingle()

        if (readError) throw new Error(`refund read failed: ${readError.message}`)

        const currentRefunded = Number(originalLine?.refunded_quantity || 0)

        const { error: updateError } = await supabase
          .from('pos_sale_lines')
          .update({
            refunded_quantity: currentRefunded + Number(line.quantity || 0),
          })
          .eq('id', line.original_line_id)

        if (updateError) throw new Error(`refund quantity update failed: ${updateError.message}`)
      }
    }

    return NextResponse.json({
      ok: true,
      sale_number: sale.sale_number,
      sale_id: sale.id,
      queue_rows_inserted: queueResult.inserted,
      queue_rows_skipped: queueResult.skipped,
      lines: Array.isArray(lines) ? lines.length : 0,
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
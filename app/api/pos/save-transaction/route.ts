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

    if (Array.isArray(queueRows) && queueRows.length > 0) {
      const { error: queueError } = await supabase
        .from('linnworks_sync_queue')
        .insert(queueRows)

      if (queueError) throw new Error(`queue insert failed: ${queueError.message}`)
    }

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
      queue_rows: Array.isArray(queueRows) ? queueRows.length : 0,
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
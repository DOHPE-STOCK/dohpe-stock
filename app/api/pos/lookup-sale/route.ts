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

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseAdmin()
    const url = new URL(request.url)
    const saleNumber = String(url.searchParams.get('sale_number') || '').trim().toUpperCase()

    if (!saleNumber) {
      return NextResponse.json({ ok: false, message: 'Missing sale_number.' }, { status: 400 })
    }

    const { data: sale, error: saleError } = await supabase
      .from('pos_sales')
      .select('*')
      .eq('sale_number', saleNumber)
      .maybeSingle()

    if (saleError) throw new Error(saleError.message)

    if (!sale) {
      return NextResponse.json(
        { ok: false, message: `Receipt not found: ${saleNumber}` },
        { status: 404 }
      )
    }

    const { data: lines, error: linesError } = await supabase
      .from('pos_sale_lines')
      .select('*')
      .eq('sale_id', sale.id)
      .order('created_at', { ascending: true })

    if (linesError) throw new Error(linesError.message)

    return NextResponse.json({
      ok: true,
      sale,
      lines: lines || [],
    })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'Unknown lookup sale error.' },
      { status: 500 }
    )
  }
}
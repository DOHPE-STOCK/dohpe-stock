import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

function cleanText(value: string | null) {
  return String(value || '').trim()
}

function cleanDate(value: string | null) {
  const clean = cleanText(value)
  if (!clean) return ''

  // Accept YYYY-MM-DD only. Keeps the route predictable.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return ''

  return clean
}

function startOfDayIso(date: string) {
  return `${date}T00:00:00.000Z`
}

function endOfDayIso(date: string) {
  return `${date}T23:59:59.999Z`
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  )
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseAdmin()
    const url = new URL(request.url)

    const query = cleanText(url.searchParams.get('query'))
    const dateFrom = cleanDate(url.searchParams.get('date_from'))
    const dateTo = cleanDate(url.searchParams.get('date_to'))
    const paymentMethod = cleanText(url.searchParams.get('payment_method')).toLowerCase()
    const mode = cleanText(url.searchParams.get('mode')).toLowerCase()
    const limitRaw = Number(url.searchParams.get('limit') || 30)
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 30, 1), 100)

    let saleIdsFromLines: string[] | null = null

    if (query) {
      const { data: matchingLines, error: lineError } = await supabase
        .from('pos_sale_lines')
        .select('sale_id')
        .or(
          [
            `sku.ilike.%${query}%`,
            `title.ilike.%${query}%`,
            `brand.ilike.%${query}%`,
            `reporting_category.ilike.%${query}%`,
            `sub_type.ilike.%${query}%`,
            `colour.ilike.%${query}%`,
          ].join(',')
        )
        .limit(200)

      if (lineError) throw new Error(lineError.message)

      saleIdsFromLines = Array.from(
        new Set((matchingLines || []).map((row: any) => row.sale_id).filter(Boolean))
      )
    }

    let salesQuery = supabase
      .from('pos_sales')
      .select(
        `
          id,
          sale_number,
          mode,
          payment_method,
          subtotal,
          discount_amount,
          total,
          vat_amount,
          net_amount,
          cash_tendered,
          change_due,
          square_status,
          square_checkout_id,
          square_payment_id,
          square_payment_status,
          square_receipt_url,
          square_terminal_device_id,
          payment_provider,
          payment_reference,
          payment_confirmed_at,
          manual_payment_reason,
          status,
          original_sale_id,
          exchange_credit,
          refund_method,
          checkout_location,
          created_at,
          updated_at,
          pos_sale_lines (
            id,
            sale_id,
            sku,
            title,
            brand,
            reporting_category,
            sub_type,
            colour,
            quantity,
            unit_price,
            line_total,
            discount_percent,
            discount_amount,
            original_line_id,
            refunded_quantity,
            max_refundable_quantity,
            created_at
          )
        `
      )
      .order('created_at', { ascending: false })
      .limit(limit)

    if (dateFrom) {
      salesQuery = salesQuery.gte('created_at', startOfDayIso(dateFrom))
    }

    if (dateTo) {
      salesQuery = salesQuery.lte('created_at', endOfDayIso(dateTo))
    }

    if (paymentMethod && ['cash', 'card'].includes(paymentMethod)) {
      salesQuery = salesQuery.eq('payment_method', paymentMethod)
    }

    if (mode && ['sale', 'refund', 'exchange'].includes(mode)) {
      salesQuery = salesQuery.eq('mode', mode)
    }

    if (query) {
      const saleNumberOrFilters = [
        `sale_number.ilike.%${query}%`,
        `square_payment_id.ilike.%${query}%`,
        `square_checkout_id.ilike.%${query}%`,
        `payment_reference.ilike.%${query}%`,
      ]

      if (isUuid(query)) {
        saleNumberOrFilters.push(`id.eq.${query}`)
      }

      if (saleIdsFromLines && saleIdsFromLines.length > 0) {
        saleNumberOrFilters.push(`id.in.(${saleIdsFromLines.join(',')})`)
      }

      salesQuery = salesQuery.or(saleNumberOrFilters.join(','))
    }

    const { data: sales, error: salesError } = await salesQuery

    if (salesError) throw new Error(salesError.message)

    const normalisedSales = (sales || []).map((sale: any) => ({
      ...sale,
      lines: Array.isArray(sale.pos_sale_lines)
        ? sale.pos_sale_lines.sort((a: any, b: any) =>
            String(a.created_at || '').localeCompare(String(b.created_at || ''))
          )
        : [],
      pos_sale_lines: undefined,
    }))

    return NextResponse.json({
      ok: true,
      sales: normalisedSales,
      count: normalisedSales.length,
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        message: error.message || 'Could not load POS history.',
      },
      { status: 500 }
    )
  }
}
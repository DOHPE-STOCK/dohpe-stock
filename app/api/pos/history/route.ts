import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type AccessResult =
  | { ok: true; user?: any; staff?: any }
  | { ok: false; status: number; message: string }

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

function cleanText(value: string | null) {
  return String(value || '').trim()
}

function cleanDate(value: string | null) {
  const clean = cleanText(value)
  if (!clean) return ''
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

function escapePostgrestOrValue(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')
    .replaceAll(',', '\\,')
}

const saleSelect = `
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
  square_refund_id,
  square_refund_status,
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

function normaliseSale(sale: any) {
  return {
    ...sale,
    lines: Array.isArray(sale.pos_sale_lines)
      ? sale.pos_sale_lines.sort((a: any, b: any) =>
          String(a.created_at || '').localeCompare(String(b.created_at || ''))
        )
      : [],
    pos_sale_lines: undefined,
  }
}

function getLatestActivityIso(sale: any, relatedSales: any[]) {
  const activityDates = [
    sale.created_at,
    sale.updated_at,
    ...relatedSales.map((related: any) => related.created_at),
    ...relatedSales.map((related: any) => related.updated_at),
  ]
    .filter(Boolean)
    .map((value: string) => new Date(value).getTime())
    .filter((value: number) => Number.isFinite(value))

  const fallback = new Date(sale.created_at || Date.now()).getTime()
  const latestActivityMs = activityDates.length > 0 ? Math.max(...activityDates) : fallback

  return new Date(latestActivityMs).toISOString()
}

export async function GET(request: Request) {
  try {
    const login = await requireAppLogin()

    if (!login.ok) {
      return NextResponse.json(
        { ok: false, message: login.message },
        { status: login.status }
      )
    }

    const supabase = getSupabaseAdmin()

    const access = await requireCheckoutPermission(request, supabase)

    if (!access.ok) {
      return NextResponse.json(
        { ok: false, message: access.message },
        { status: access.status }
      )
    }

    const url = new URL(request.url)

    const query = cleanText(url.searchParams.get('query'))
    const receipt = cleanText(url.searchParams.get('receipt'))
    const finalQuery = receipt || query
    const safeFinalQuery = escapePostgrestOrValue(finalQuery)

    const dateFrom = cleanDate(url.searchParams.get('date_from'))
    const dateTo = cleanDate(url.searchParams.get('date_to'))
    const paymentMethod = cleanText(url.searchParams.get('payment_method')).toLowerCase()
    const mode = cleanText(url.searchParams.get('mode')).toLowerCase()
    const limitRaw = Number(url.searchParams.get('limit') || 30)
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 30, 1), 100)

    let saleIdsFromLines: string[] | null = null

    if (finalQuery) {
      const { data: matchingLines, error: lineError } = await supabase
        .from('pos_sale_lines')
        .select('sale_id')
        .or(
          [
            `sku.ilike.%${safeFinalQuery}%`,
            `title.ilike.%${safeFinalQuery}%`,
            `brand.ilike.%${safeFinalQuery}%`,
            `reporting_category.ilike.%${safeFinalQuery}%`,
            `sub_type.ilike.%${safeFinalQuery}%`,
            `colour.ilike.%${safeFinalQuery}%`,
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
      .select(saleSelect)
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

    if (finalQuery) {
      const saleFilters = [
        `sale_number.ilike.%${safeFinalQuery}%`,
        `square_payment_id.ilike.%${safeFinalQuery}%`,
        `square_checkout_id.ilike.%${safeFinalQuery}%`,
        `square_refund_id.ilike.%${safeFinalQuery}%`,
        `payment_reference.ilike.%${safeFinalQuery}%`,
      ]

      if (isUuid(finalQuery)) {
        saleFilters.push(`id.eq.${finalQuery}`)
        saleFilters.push(`original_sale_id.eq.${finalQuery}`)
      }

      if (saleIdsFromLines && saleIdsFromLines.length > 0) {
        saleFilters.push(`id.in.(${saleIdsFromLines.join(',')})`)
      }

      salesQuery = salesQuery.or(saleFilters.join(','))
    }

    const { data: sales, error: salesError } = await salesQuery

    if (salesError) throw new Error(salesError.message)

    const normalisedSales = (sales || []).map(normaliseSale)

    const visibleSaleIds = normalisedSales.map((sale: any) => sale.id).filter(Boolean)
    const originalSaleIds = normalisedSales
      .map((sale: any) => sale.original_sale_id)
      .filter(Boolean)

    const idsForRelatedLookup = Array.from(new Set([...visibleSaleIds, ...originalSaleIds]))

    const relatedSalesByOriginalId: Record<string, any[]> = {}
    const originalSalesById: Record<string, any> = {}

    if (idsForRelatedLookup.length > 0) {
      const relatedFilters = [`original_sale_id.in.(${idsForRelatedLookup.join(',')})`]

      if (originalSaleIds.length > 0) {
        relatedFilters.push(`id.in.(${originalSaleIds.join(',')})`)
      }

      const { data: relatedSales, error: relatedError } = await supabase
        .from('pos_sales')
        .select(saleSelect)
        .or(relatedFilters.join(','))
        .order('created_at', { ascending: true })

      if (relatedError) throw new Error(relatedError.message)

      const normalisedRelated = (relatedSales || []).map(normaliseSale)

      for (const related of normalisedRelated) {
        if (related.original_sale_id) {
          if (!relatedSalesByOriginalId[related.original_sale_id]) {
            relatedSalesByOriginalId[related.original_sale_id] = []
          }

          relatedSalesByOriginalId[related.original_sale_id].push(related)
        }

        originalSalesById[related.id] = related
      }
    }

    const enrichedSales = normalisedSales
      .map((sale: any) => {
        const originalSale =
          sale.original_sale_id && originalSalesById[sale.original_sale_id]
            ? originalSalesById[sale.original_sale_id]
            : null

        const relatedSales =
          sale.mode === 'sale'
            ? relatedSalesByOriginalId[sale.id] || []
            : sale.original_sale_id
              ? relatedSalesByOriginalId[sale.original_sale_id] || []
              : []

        const returnedQtyByOriginalLineId: Record<string, number> = {}

        for (const relatedSale of relatedSales) {
          for (const line of relatedSale.lines || []) {
            const originalLineId = line.original_line_id
            if (!originalLineId) continue

            returnedQtyByOriginalLineId[originalLineId] =
              (returnedQtyByOriginalLineId[originalLineId] || 0) + Number(line.quantity || 0)
          }
        }

        return {
          ...sale,
          activity_at: getLatestActivityIso(sale, relatedSales),
          original_sale: originalSale,
          related_sales: relatedSales.filter((related: any) => related.id !== sale.id),
          returned_qty_by_original_line_id: returnedQtyByOriginalLineId,
          receipt_lookup_url: `/checkout?receipt=${encodeURIComponent(
            originalSale?.sale_number || sale.sale_number
          )}`,
        }
      })
      .sort((a: any, b: any) =>
        String(b.activity_at || b.created_at || '').localeCompare(
          String(a.activity_at || a.created_at || '')
        )
      )

    return NextResponse.json({
      ok: true,
      sales: enrichedSales,
      count: enrichedSales.length,
      query: finalQuery,
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

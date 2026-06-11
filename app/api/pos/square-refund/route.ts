import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { requireCompanyAccess } from '@/lib/serverTenant'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SQUARE_VERSION = '2026-01-22'

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

  let query = supabase
    .from('staff_users')
    .select('id, name, role, permissions, is_active')
    .eq('id', staffCookie.id)

  if (companyId) {
    query = query.eq('company_id', companyId)
  }

  const { data: staff, error } = await query.maybeSingle()

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

function getSquareBaseUrl() {
  return (process.env.SQUARE_ENVIRONMENT || 'sandbox').toLowerCase() === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com'
}

function getAccessToken() {
  const token = process.env.SQUARE_ACCESS_TOKEN

  if (!token) throw new Error('Missing SQUARE_ACCESS_TOKEN.')

  return token
}

function poundsToMinorUnits(amount: any) {
  const value = Number(amount)

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Invalid refund amount.')
  }

  return Math.round(value * 100)
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseAdmin()
    const activeCompanyId = getActiveCompanyIdFromRequest(request)

    const companyAccess = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member'])
    if (!companyAccess.ok) {
      return NextResponse.json({ ok: false, message: companyAccess.message }, { status: companyAccess.status })
    }

    if (!activeCompanyId || activeCompanyId !== companyAccess.company.id) {
      return NextResponse.json({ ok: false, message: 'Active company required.' }, { status: 400 })
    }

    const access = await requirePosAccess(request, supabase, activeCompanyId)

    if (!access.ok) {
      return accessDeniedResponse(access)
    }

    const body = await request.json().catch(() => ({}))

    const paymentId = String(body.payment_id || '').trim()
    const amount = poundsToMinorUnits(body.amount)
    const currency = String(body.currency || 'GBP').toUpperCase()
    const saleNumber = String(body.sale_number || '').trim()
    const refundSaleId = String(body.refund_sale_id || '').trim()
    const reason = String(body.reason || 'POS refund').slice(0, 192)

    if (!paymentId) {
      throw new Error('Missing original Square payment_id.')
    }

    if (saleNumber) {
      const { data: sale, error: saleError } = await supabase
        .from('pos_sales')
        .select('id')
        .eq('sale_number', saleNumber)
        .eq('company_id', activeCompanyId)
        .maybeSingle()

      if (saleError) throw new Error(saleError.message)
      if (!sale) throw new Error('Sale not found for this company.')
    }

    const idempotencyKey = String(
      body.idempotency_key ||
        `refund-${refundSaleId || saleNumber || paymentId}-${amount}`
    ).slice(0, 45)

    const response = await fetch(`${getSquareBaseUrl()}/v2/refunds`, {
      method: 'POST',
      headers: {
        'Square-Version': SQUARE_VERSION,
        Authorization: `Bearer ${getAccessToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        payment_id: paymentId,
        amount_money: {
          amount,
          currency,
        },
        reason,
      }),
      cache: 'no-store',
    })

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const detail =
        data?.errors?.[0]?.detail ||
        data?.errors?.[0]?.code ||
        `Square refund failed with status ${response.status}`

      throw new Error(detail)
    }

    return NextResponse.json({
      ok: true,
      refund_id: data?.refund?.id || null,
      status: data?.refund?.status || null,
      refund: data?.refund || null,
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        message: error.message || 'Square refund failed.',
      },
      { status: 500 }
    )
  }
}

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
    const activeCompanyId = getActiveCompanyIdFromRequest(request)

    const access = await requireCheckoutPermission(request, supabase, activeCompanyId)

    if (!access.ok) {
      return NextResponse.json(
        { ok: false, message: access.message },
        { status: access.status }
      )
    }

    const url = new URL(request.url)
    const saleNumber = String(url.searchParams.get('sale_number') || '').trim().toUpperCase()

    if (!saleNumber) {
      return NextResponse.json({ ok: false, message: 'Missing sale_number.' }, { status: 400 })
    }

    let saleQuery = supabase
      .from('pos_sales')
      .select('*')
      .eq('sale_number', saleNumber)

    if (activeCompanyId) {
      saleQuery = saleQuery.eq('company_id', activeCompanyId)
    }

    const { data: sale, error: saleError } = await saleQuery.maybeSingle()

    if (saleError) throw new Error(saleError.message)

    if (!sale) {
      return NextResponse.json(
        { ok: false, message: `Receipt not found: ${saleNumber}` },
        { status: 404 }
      )
    }

    let linesQuery = supabase
      .from('pos_sale_lines')
      .select('*')
      .eq('sale_id', sale.id)
      .order('created_at', { ascending: true })

    if (activeCompanyId) {
      linesQuery = linesQuery.eq('company_id', activeCompanyId)
    }

    const { data: lines, error: linesError } = await linesQuery

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

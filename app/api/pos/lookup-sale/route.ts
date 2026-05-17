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

async function requireCheckoutPermission(request: Request, supabase: any) {
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

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseAdmin()

    const access = await requireCheckoutPermission(request, supabase)

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

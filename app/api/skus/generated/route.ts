import { NextResponse } from 'next/server'
import { getSupabaseAdmin, requireCompanyAccess } from '@/lib/serverTenant'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const quantity = Math.max(1, Math.min(100, Number(body.quantity || body.count || 1)))
    const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member'])

    if (!access.ok) {
      return NextResponse.json({ ok: false, message: access.message }, { status: access.status })
    }

    const companyId = access.company.id
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase.rpc('loopbase_reserve_generated_skus', {
      target_company_id: companyId,
      requested_quantity: quantity,
    })

    if (error) throw new Error(`Generated SKU allocator failed: ${error.message}`)

    const skus = Array.isArray(data)
      ? data.map((row: any) => String(row?.sku || row)).filter(Boolean)
      : []

    if (skus.length !== quantity) {
      return NextResponse.json(
        { ok: false, message: 'Could not generate enough unique SKU numbers.' },
        { status: 409 }
      )
    }

    return NextResponse.json({ ok: true, skus })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error?.message || 'Generated SKU reservation failed.' },
      { status: 500 }
    )
  }
}

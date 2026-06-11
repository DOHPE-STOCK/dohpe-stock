import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getEbayIntegrationConfig } from '@/lib/ebayIntegrationSettings'
import { ebayRequest } from '@/lib/ebayApi'
import { requireCompanyAccess } from '@/lib/serverTenant'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) throw new Error('Missing Supabase admin environment variables.')
  return createClient(url, serviceKey)
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

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseAdmin()
    const companyId = getActiveCompanyIdFromRequest(request)
    const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member'])
    if (!access.ok) {
      return NextResponse.json({ ok: false, message: access.message }, { status: access.status })
    }
    if (!companyId || companyId !== access.company.id) {
      return NextResponse.json({ ok: false, message: 'Active company required.' }, { status: 400 })
    }

    const config = await getEbayIntegrationConfig(supabase, companyId)
    const marketplace = encodeURIComponent(config.settings.marketplace_id)

    const [payment, fulfillment, returns] = await Promise.all([
      ebayRequest(config.settings, `/sell/account/v1/payment_policy?marketplace_id=${marketplace}`),
      ebayRequest(config.settings, `/sell/account/v1/fulfillment_policy?marketplace_id=${marketplace}`),
      ebayRequest(config.settings, `/sell/account/v1/return_policy?marketplace_id=${marketplace}`),
    ])

    return NextResponse.json({
      ok: true,
      marketplace_id: config.settings.marketplace_id,
      paymentPolicies: payment?.paymentPolicies || [],
      fulfillmentPolicies: fulfillment?.fulfillmentPolicies || [],
      returnPolicies: returns?.returnPolicies || [],
    })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'Could not load eBay policies.' },
      { status: 500 }
    )
  }
}

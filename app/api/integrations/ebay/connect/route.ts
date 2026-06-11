import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getEbayIntegrationConfig } from '@/lib/ebayIntegrationSettings'
import { getEbayAuthorizeUrl } from '@/lib/ebayApi'

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
    const config = await getEbayIntegrationConfig(supabase, companyId)
    const state = `ebay_${Date.now()}`
    const url = getEbayAuthorizeUrl(config.settings, state)

    return NextResponse.redirect(url)
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'Could not start eBay OAuth.' },
      { status: 500 }
    )
  }
}

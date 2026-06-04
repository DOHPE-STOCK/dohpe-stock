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

export async function GET() {
  try {
    const supabase = getSupabaseAdmin()
    const config = await getEbayIntegrationConfig(supabase)
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

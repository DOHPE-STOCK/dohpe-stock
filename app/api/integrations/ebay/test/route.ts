import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getEbayIntegrationConfig } from '@/lib/ebayIntegrationSettings'
import { ebayRequest, getDefaultCategoryTreeId, getEbayUserProfile } from '@/lib/ebayApi'

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
    const categoryTreeId = await getDefaultCategoryTreeId(config.settings)

    let fulfillmentPolicyCount = 0
    let policyWarning: string | null = null
    const profile = await getEbayUserProfile(config.settings).catch(() => null)
    const accountName =
      profile?.businessAccount?.doingBusinessAs ||
      profile?.businessAccount?.name ||
      profile?.username ||
      profile?.userId ||
      config.settings.ebay_account_name ||
      null

    try {
      const fulfillmentPolicies = await ebayRequest(
        config.settings,
        `/sell/account/v1/fulfillment_policy?marketplace_id=${encodeURIComponent(config.settings.marketplace_id)}`
      )

      fulfillmentPolicyCount = fulfillmentPolicies?.fulfillmentPolicies?.length || 0
    } catch (policyError: any) {
      policyWarning = policyError?.message || 'Could not pull eBay business policies.'
    }

    let updateQuery = supabase
      .from('integration_settings')
      .update({
        connection_status: 'connected',
        last_synced_at: new Date().toISOString(),
        last_error: policyWarning,
        settings: {
          ...config.settings,
          ebay_user_id: profile?.userId || config.settings.ebay_user_id || null,
          ebay_username: profile?.username || config.settings.ebay_username || null,
          ebay_account_name: accountName,
          ebay_account_type: profile?.accountType || config.settings.ebay_account_type || null,
        },
      })
      .eq('channel', 'ebay')

    if (companyId) {
      updateQuery = updateQuery.eq('company_id', companyId)
    }

    await updateQuery

    return NextResponse.json({
      ok: true,
      marketplace_id: config.settings.marketplace_id,
      category_tree_id: categoryTreeId,
      fulfillment_policy_count: fulfillmentPolicyCount,
      policy_warning: policyWarning,
      ebay_account_name: accountName,
      ebay_username: profile?.username || config.settings.ebay_username || null,
      ebay_account_type: profile?.accountType || config.settings.ebay_account_type || null,
    })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'eBay connection failed.' },
      { status: 500 }
    )
  }
}

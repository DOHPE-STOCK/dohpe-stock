import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getEbayIntegrationConfig } from '@/lib/ebayIntegrationSettings'
import { ebayRequest, getDefaultCategoryTreeId } from '@/lib/ebayApi'

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
    const categoryTreeId = await getDefaultCategoryTreeId(config.settings)

    let fulfillmentPolicyCount = 0
    let policyWarning: string | null = null

    try {
      const fulfillmentPolicies = await ebayRequest(
        config.settings,
        `/sell/account/v1/fulfillment_policy?marketplace_id=${encodeURIComponent(config.settings.marketplace_id)}`
      )

      fulfillmentPolicyCount = fulfillmentPolicies?.fulfillmentPolicies?.length || 0
    } catch (policyError: any) {
      policyWarning = policyError?.message || 'Could not pull eBay business policies.'
    }

    await supabase
      .from('integration_settings')
      .update({
        connection_status: 'connected',
        last_synced_at: new Date().toISOString(),
        last_error: policyWarning,
      })
      .eq('channel', 'ebay')

    return NextResponse.json({
      ok: true,
      marketplace_id: config.settings.marketplace_id,
      category_tree_id: categoryTreeId,
      fulfillment_policy_count: fulfillmentPolicyCount,
      policy_warning: policyWarning,
    })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'eBay connection failed.' },
      { status: 500 }
    )
  }
}

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
    const categoryId = new URL(request.url).searchParams.get('category_id')?.trim()
    if (!categoryId) {
      return NextResponse.json({ ok: false, message: 'category_id is required.' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const companyId = getActiveCompanyIdFromRequest(request)
    const config = await getEbayIntegrationConfig(supabase, companyId)
    const categoryTreeId = await getDefaultCategoryTreeId(config.settings)

    const [aspects, conditions] = await Promise.all([
      ebayRequest(
        config.settings,
        `/commerce/taxonomy/v1/category_tree/${encodeURIComponent(
          categoryTreeId
        )}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`
      ),
      ebayRequest(
        config.settings,
        `/sell/metadata/v1/marketplace/${encodeURIComponent(
          config.settings.marketplace_id
        )}/get_item_condition_policies?filter=categoryIds:{${encodeURIComponent(categoryId)}}`
      ),
    ])

    return NextResponse.json({
      ok: true,
      marketplace_id: config.settings.marketplace_id,
      category_tree_id: categoryTreeId,
      category_id: categoryId,
      aspects: aspects?.aspects || [],
      conditionPolicies: conditions?.itemConditionPolicies || [],
    })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'Could not load eBay category metadata.' },
      { status: 500 }
    )
  }
}

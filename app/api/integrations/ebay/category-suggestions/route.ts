import { NextRequest, NextResponse } from 'next/server'
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

export async function GET(request: NextRequest) {
  try {
    const q = String(request.nextUrl.searchParams.get('q') || '').trim()

    if (!q) {
      return NextResponse.json({ ok: false, message: 'Missing q search term.' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const config = await getEbayIntegrationConfig(supabase)
    const categoryTreeId = await getDefaultCategoryTreeId(config.settings)
    const data = await ebayRequest(
      config.settings,
      `/commerce/taxonomy/v1/category_tree/${encodeURIComponent(
        categoryTreeId
      )}/get_category_suggestions?q=${encodeURIComponent(q)}`
    )

    return NextResponse.json({
      ok: true,
      q,
      category_tree_id: categoryTreeId,
      suggestions: data?.categorySuggestions || [],
    })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'Could not pull eBay category suggestions.' },
      { status: 500 }
    )
  }
}

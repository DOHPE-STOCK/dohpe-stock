import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getEbayIntegrationConfig } from '@/lib/ebayIntegrationSettings'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) throw new Error('Missing Supabase admin environment variables.')
  return createClient(url, serviceKey)
}

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const readiness = body?.readiness

    if (!readiness?.item?.id || !readiness?.sku || !readiness?.listing_draft) {
      return NextResponse.json(
        { ok: false, message: 'Missing readiness result. Run listing readiness first.' },
        { status: 400 }
      )
    }

    const supabase = getSupabaseAdmin()
    const config = await getEbayIntegrationConfig(supabase)
    const draft = readiness.listing_draft
    const policies = {
      payment_policy_id: draft.policies?.payment_policy_id || config.settings.payment_policy_id || null,
      fulfillment_policy_id:
        draft.policies?.fulfillment_policy_id || config.settings.fulfillment_policy_id || null,
      return_policy_id: draft.policies?.return_policy_id || config.settings.return_policy_id || null,
    }

    const payload = {
      item_id: readiness.item.id,
      sku: readiness.sku,
      marketplace_id: config.settings.marketplace_id,
      listing_mode: config.settings.listing_mode,
      status: readiness.ready ? 'shadow_ready' : 'shadow_blocked',
      ready: Boolean(readiness.ready),
      category_id: text(readiness.category_id) || null,
      category_name:
        text(readiness.mapping?.ebay_category_name) ||
        text(readiness.item?.ebay_category_name) ||
        null,
      title: text(draft.title),
      description: text(draft.description),
      price: Number(draft.price || 0),
      quantity: Number(draft.quantity || 0),
      condition_id:
        text(draft.ebay_condition) ||
        text(readiness.mapping?.default_condition) ||
        text(draft.condition) ||
        null,
      aspects: draft.aspects || {},
      image_urls: draft.image_urls || [],
      policies,
      readiness,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('ebay_listing_drafts')
      .upsert(payload, { onConflict: 'item_id,marketplace_id' })
      .select('id, sku, status, ready, category_id, title, updated_at')
      .single()

    if (error) {
      const missingTable =
        error.code === '42P01' ||
        error.code === 'PGRST205' ||
        String(error.message || '').includes('ebay_listing_drafts')

      if (missingTable) {
        return NextResponse.json(
          {
            ok: false,
            message:
              'Missing ebay_listing_drafts table. Run sql/2026-06-02_ebay_shadow_listing_drafts.sql in Supabase first.',
          },
          { status: 409 }
        )
      }

      throw new Error(error.message)
    }

    return NextResponse.json({ ok: true, draft: data })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'Could not save eBay shadow draft.' },
      { status: 500 }
    )
  }
}

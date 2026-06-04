import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getEbayIntegrationConfig } from '@/lib/ebayIntegrationSettings'
import { ebayRequest } from '@/lib/ebayApi'
import { buildEbayDescriptionHtml } from '@/lib/ebayListingTemplate'

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

function number(value: any) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function toAspectArrays(aspects: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(aspects || {})
      .map(([key, value]) => {
        const values = Array.isArray(value)
          ? value.map(text).filter(Boolean)
          : text(value)
              .split(',')
              .map((part) => part.trim())
              .filter(Boolean)

        return [key, values]
      })
      .filter(([, values]) => Array.isArray(values) && values.length > 0)
  )
}

function toEbayConditionEnum(condition: string) {
  const clean = text(condition).toUpperCase()

  const byId: Record<string, string> = {
    '1000': 'NEW',
    '1500': 'NEW_OTHER',
    '1750': 'NEW_WITH_DEFECTS',
    '2750': 'LIKE_NEW',
    '2990': 'PRE_OWNED_EXCELLENT',
    '3000': 'PRE_OWNED_GOOD',
    '3010': 'PRE_OWNED_FAIR',
    '4000': 'USED_VERY_GOOD',
    '5000': 'USED_GOOD',
    '6000': 'USED_ACCEPTABLE',
    '7000': 'FOR_PARTS_OR_NOT_WORKING',
  }
  const allowed = new Set([
    'NEW',
    'LIKE_NEW',
    'NEW_OTHER',
    'NEW_WITH_DEFECTS',
    'CERTIFIED_REFURBISHED',
    'EXCELLENT_REFURBISHED',
    'VERY_GOOD_REFURBISHED',
    'GOOD_REFURBISHED',
    'SELLER_REFURBISHED',
    'USED_EXCELLENT',
    'USED_VERY_GOOD',
    'USED_GOOD',
    'USED_ACCEPTABLE',
    'FOR_PARTS_OR_NOT_WORKING',
    'PRE_OWNED_EXCELLENT',
    'PRE_OWNED_GOOD',
    'PRE_OWNED_FAIR',
  ])

  if (byId[clean]) return byId[clean]
  if (allowed.has(clean)) return clean

  throw new Error(`No eBay condition mapping found for "${condition}". Update eBay condition mappings in Settings.`)
}

function ebayContentLanguage(locale: string) {
  return text(locale) || 'en-GB'
}

function extractOfferIdFromError(message: string) {
  const match = String(message || '').match(/"name":"offerId","value":"([^"]+)"/)
  return match?.[1] || ''
}

async function ensureSandboxInventoryLocation(settings: any, merchantLocationKey: string) {
  try {
    await ebayRequest(settings, `/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey)}`)
    return { ok: true, created: false }
  } catch {
    await ebayRequest(settings, `/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey)}`, {
      method: 'POST',
      body: JSON.stringify({
        location: {
          address: {
            country: 'GB',
            postalCode: 'SW1A 1AA',
          },
        },
        locationTypes: ['WAREHOUSE'],
        merchantLocationStatus: 'ENABLED',
        name: 'DOHPE Sandbox Warehouse',
      }),
    })

    return { ok: true, created: true }
  }
}

async function saveDraftError(supabase: any, draftId: string, error: string) {
  await supabase
    .from('ebay_listing_drafts')
    .update({
      status: 'sandbox_publish_failed',
      last_error: error,
      updated_at: new Date().toISOString(),
    })
    .eq('id', draftId)
}

function withSandboxPublishResult(readiness: any, publish: any, offerId: string) {
  return {
    ...(readiness || {}),
    sandbox_publish: {
      offer_id: offerId,
      listing_id: text(publish?.listingId) || null,
      warnings: Array.isArray(publish?.warnings) ? publish.warnings : [],
      raw: publish || null,
      published_at: new Date().toISOString(),
    },
  }
}

export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdmin()
  let draftId = ''

  try {
    const body = await request.json().catch(() => ({}))
    const sku = text(body?.sku)

    if (!sku) {
      return NextResponse.json({ ok: false, message: 'Missing sku.' }, { status: 400 })
    }

    const config = await getEbayIntegrationConfig(supabase)

    if (config.settings.environment !== 'sandbox') {
      return NextResponse.json(
        { ok: false, message: 'Sandbox publish is blocked unless eBay environment is sandbox.' },
        { status: 403 }
      )
    }

    const { data: draft, error } = await supabase
      .from('ebay_listing_drafts')
      .select('*')
      .eq('sku', sku)
      .eq('marketplace_id', config.settings.marketplace_id)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (!draft) {
      return NextResponse.json(
        { ok: false, message: `No saved eBay shadow draft found for ${sku}.` },
        { status: 404 }
      )
    }

    draftId = draft.id

    if (!draft.ready) {
      return NextResponse.json(
        { ok: false, message: `Draft for ${sku} is not ready. Fix readiness blockers first.` },
        { status: 400 }
      )
    }

    const merchantLocationKey = text(config.settings.merchant_location_key) || 'default'
    const quantity = Math.max(1, number(draft.quantity))
    const price = number(draft.price)
    const imageUrls = Array.isArray(draft.image_urls) ? draft.image_urls.map(text).filter(Boolean) : []
    const listingDescription =
      text(draft.readiness?.listing_draft?.description_html) ||
      buildEbayDescriptionHtml({
        title: draft.title,
        description: draft.description,
        aspects: draft.aspects || {},
      })
    const policies = draft.policies || {}
    const listingPolicies: Record<string, string> = {}

    if (policies.payment_policy_id) listingPolicies.paymentPolicyId = policies.payment_policy_id
    if (policies.fulfillment_policy_id) listingPolicies.fulfillmentPolicyId = policies.fulfillment_policy_id
    if (policies.return_policy_id) listingPolicies.returnPolicyId = policies.return_policy_id

    await ensureSandboxInventoryLocation(config.settings, merchantLocationKey)

    await ebayRequest(config.settings, `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
      method: 'PUT',
      headers: {
        'content-language': ebayContentLanguage(config.settings.locale),
      },
      body: JSON.stringify({
        availability: {
          shipToLocationAvailability: {
            quantity,
          },
        },
        condition: toEbayConditionEnum(draft.condition_id),
        product: {
          title: draft.title,
          description: draft.description,
          aspects: toAspectArrays(draft.aspects || {}),
          imageUrls,
        },
      }),
    })

    const offerPayload: Record<string, any> = {
      sku,
      marketplaceId: config.settings.marketplace_id,
      format: config.settings.listing_format || 'FIXED_PRICE',
      availableQuantity: quantity,
      categoryId: draft.category_id,
      listingDescription,
      merchantLocationKey,
      pricingSummary: {
        price: {
          currency: 'GBP',
          value: price.toFixed(2),
        },
      },
    }

    if (Object.keys(listingPolicies).length > 0) {
      offerPayload.listingPolicies = listingPolicies
    }

    let offerId = text(draft.ebay_offer_id)

    if (!offerId) {
      try {
        const offer = await ebayRequest(config.settings, '/sell/inventory/v1/offer', {
          method: 'POST',
          headers: {
            'content-language': ebayContentLanguage(config.settings.locale),
          },
          body: JSON.stringify(offerPayload),
        })

        offerId = text(offer?.offerId)
      } catch (offerError: any) {
        offerId = extractOfferIdFromError(offerError?.message)
        if (!offerId) throw offerError
      }
    } else {
      await ebayRequest(config.settings, `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, {
        method: 'PUT',
        headers: {
          'content-language': ebayContentLanguage(config.settings.locale),
        },
        body: JSON.stringify(offerPayload),
      })
    }

    if (!offerId) throw new Error('eBay did not return an offerId.')

    await supabase
      .from('ebay_listing_drafts')
      .update({
        status: 'sandbox_offer_created',
        ebay_offer_id: offerId,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', draft.id)

    const publish = await ebayRequest(
      config.settings,
      `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
      { method: 'POST' }
    )

    await supabase
      .from('ebay_listing_drafts')
      .update({
        status: 'sandbox_published',
        ebay_offer_id: offerId,
        ebay_listing_id: text(publish?.listingId) || null,
        readiness: withSandboxPublishResult(draft.readiness, publish, offerId),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', draft.id)

    return NextResponse.json({
      ok: true,
      sku,
      offer_id: offerId,
      listing_id: text(publish?.listingId) || null,
      publish,
    })
  } catch (error: any) {
    const message = error.message || 'Could not publish eBay Sandbox listing.'
    if (draftId) await saveDraftError(supabase, draftId, message)

    return NextResponse.json({ ok: false, message }, { status: 500 })
  }
}

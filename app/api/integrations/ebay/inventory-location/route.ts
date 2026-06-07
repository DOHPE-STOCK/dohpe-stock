import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getEbayIntegrationConfig } from '@/lib/ebayIntegrationSettings'
import { ebayRequest } from '@/lib/ebayApi'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) throw new Error('Missing Supabase admin environment variables.')
  return createClient(url, serviceKey)
}

function locationPayload(settings: any) {
  const country = text(settings.merchant_location_country) || 'GB'
  const postalCode = text(settings.merchant_location_postal_code)

  if (!postalCode) {
    throw new Error('Add Merchant location postcode in eBay settings before creating the eBay inventory location.')
  }

  return {
    location: {
      address: {
        country,
        postalCode,
      },
    },
    locationTypes: ['WAREHOUSE'],
    merchantLocationStatus: 'ENABLED',
    name: text(settings.merchant_location_name) || 'Dispatch Location',
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const config = await getEbayIntegrationConfig(supabase)
    const listLocations = request.nextUrl.searchParams.get('list') === '1'
    const merchantLocationKey = text(config.settings.merchant_location_key)

    if (listLocations || !merchantLocationKey) {
      const data = await ebayRequest(config.settings, '/sell/inventory/v1/location?limit=100&offset=0')
      return NextResponse.json({
        ok: true,
        locations: Array.isArray(data?.locations) ? data.locations : [],
        total: data?.total,
      })
    }

    const location = await ebayRequest(
      config.settings,
      `/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey)}`
    )

    return NextResponse.json({
      ok: true,
      merchant_location_key: merchantLocationKey,
      location,
    })
  } catch (error: any) {
    const message = String(error.message || '')
    if (message.includes('merchantLocationKey not found')) {
      return NextResponse.json(
        {
          ok: false,
          not_found: true,
          message: 'That eBay location key does not exist yet. Pull existing eBay locations or create this dispatch location.',
        },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { ok: false, message: error.message || 'Could not check eBay inventory location.' },
      { status: 500 }
    )
  }
}

export async function POST() {
  try {
    const supabase = getSupabaseAdmin()
    const config = await getEbayIntegrationConfig(supabase)
    const merchantLocationKey = text(config.settings.merchant_location_key)
    if (!merchantLocationKey) {
      return NextResponse.json(
        { ok: false, message: 'Enter or pull an eBay location key before creating the dispatch location.' },
        { status: 400 }
      )
    }
    const payload = locationPayload(config.settings)

    let existed = true
    try {
      await ebayRequest(
        config.settings,
        `/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey)}`
      )
    } catch {
      existed = false
    }

    const locationPath = existed
      ? `/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey)}/update_location_details`
      : `/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey)}`

    await ebayRequest(config.settings, locationPath, {
      method: 'POST',
      body: JSON.stringify(payload),
    })

    return NextResponse.json({
      ok: true,
      existed,
      merchant_location_key: merchantLocationKey,
      message: existed
        ? `eBay inventory location "${merchantLocationKey}" was updated.`
        : `eBay inventory location "${merchantLocationKey}" was created.`,
    })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'Could not create eBay inventory location.' },
      { status: 500 }
    )
  }
}

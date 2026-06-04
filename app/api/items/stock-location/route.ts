import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('Missing Supabase admin environment variables.')
  }

  return createClient(url, serviceKey)
}

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function canonicalLocationKey(value: any) {
  const key = text(value).toUpperCase().replace(/[\s_]+/g, '-')
  return key
}

function canonicalBinCode(value: any) {
  return text(value) || 'Default'
}

async function resolveLocation(supabase: any, rawLocation: any) {
  const raw = text(rawLocation)
  const key = canonicalLocationKey(raw)
  const { data, error } = await supabase
    .from('locations')
    .select('name, label')

  if (error) throw new Error(error.message)

  const locations = data || []
  const matches = locations.filter((location: any) => (
    canonicalLocationKey(location.name) === key ||
    canonicalLocationKey(location.label) === key
  ))
  const match =
    matches.find((location: any) => text(location.label)) ||
    matches.find((location: any) => /^LOCATION-\d+$/i.test(text(location.name))) ||
    matches[0]

  const name = canonicalLocationKey(text(match?.name) || raw || 'LOCATION-1')
  const aliases = locations
    .filter((location: any) => canonicalLocationKey(location.name) === canonicalLocationKey(name))
    .flatMap((location: any) => [text(location.name), text(location.label)])
    .filter(Boolean)

  return {
    name,
    aliases: Array.from(new Set([name, raw, ...aliases].filter(Boolean))),
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const itemId = text(body.item_id || body.itemId)
    const sku = text(body.sku).toUpperCase()
    const rawLocationName = body.location_name || body.locationName
    const binCode = canonicalBinCode(body.bin_code || body.binCode)
    const stockLevel = Number(body.stock_level ?? body.stockLevel ?? 0)
    const source = text(body.source) || 'app_stock_location_upsert'
    const now = new Date().toISOString()

    if (!itemId) {
      return NextResponse.json({ ok: false, error: 'Missing item_id.' }, { status: 400 })
    }

    if (!sku) {
      return NextResponse.json({ ok: false, error: 'Missing sku.' }, { status: 400 })
    }

    if (!Number.isFinite(stockLevel) || stockLevel < 0) {
      return NextResponse.json({ ok: false, error: 'Invalid stock level.' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const resolvedLocation = await resolveLocation(supabase, rawLocationName)
    const locationName = resolvedLocation.name
    const aliases = resolvedLocation.aliases

    const { data: existingRows, error: existingError } = await supabase
      .from('item_stock_locations')
      .select('id, location_name')
      .eq('item_id', itemId)
      .in('location_name', aliases)
      .ilike('bin_code', binCode)
      .limit(20)

    if (existingError) throw new Error(existingError.message)

    const existing =
      existingRows?.find((row: any) => canonicalLocationKey(row.location_name) === locationName) ||
      existingRows?.[0]

    if (existing) {
      const { data, error } = await supabase
        .from('item_stock_locations')
        .update({
          sku,
          location_name: locationName,
          bin_code: binCode,
          stock_level: stockLevel,
          source,
          updated_at: now,
        })
        .eq('id', existing.id)
        .select('id, item_id, sku, location_name, bin_code, stock_level')
        .single()

      if (error) throw new Error(error.message)

      return NextResponse.json({ ok: true, row: data })
    }

    const { data, error } = await supabase
      .from('item_stock_locations')
      .upsert({
        item_id: itemId,
        sku,
        location_name: locationName,
        location_id: null,
        bin_code: binCode,
        stock_level: stockLevel,
        source,
        updated_at: now,
      }, {
        onConflict: 'item_id,location_name,bin_code',
      })
      .select('id, item_id, sku, location_name, bin_code, stock_level')
      .single()

    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true, row: data })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error.message || 'Stock location update failed.' },
      { status: 500 }
    )
  }
}

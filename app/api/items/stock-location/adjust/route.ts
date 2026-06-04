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
  return text(value).toUpperCase().replace(/[\s_]+/g, '-')
}

async function syncItemStockTotal(supabase: any, itemId: string) {
  const { data, error } = await supabase
    .from('item_stock_locations')
    .select('stock_level')
    .eq('item_id', itemId)

  if (error) throw new Error(error.message)

  const totalStock = (data || []).reduce(
    (sum: number, row: any) => sum + Math.max(0, Number(row.stock_level || 0)),
    0
  )

  const { error: updateError } = await supabase
    .from('items')
    .update({
      stock_level: totalStock,
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)

  if (updateError) throw new Error(updateError.message)
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
  const defaultLocation = locations.find((location: any) => canonicalLocationKey(location.name) === 'LOCATION-1')
  const name = text(match?.name) || text(defaultLocation?.name) || raw || 'LOCATION-1'
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
    const binCode = text(body.bin_code || body.binCode) || 'Default'
    const delta = Number(body.delta ?? 0)
    const source = text(body.source) || 'app_transfer'
    const allowMissingSource = Boolean(body.allow_missing_source || body.allowMissingSource)
    const now = new Date().toISOString()

    if (!itemId) {
      return NextResponse.json({ ok: false, error: 'Missing item_id.' }, { status: 400 })
    }

    if (!sku) {
      return NextResponse.json({ ok: false, error: 'Missing sku.' }, { status: 400 })
    }

    if (!Number.isFinite(delta) || delta === 0) {
      return NextResponse.json({ ok: false, error: 'Invalid stock adjustment.' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const resolvedLocation = await resolveLocation(supabase, rawLocationName)
    const locationName = resolvedLocation.name
    const aliases = resolvedLocation.aliases

    const { data: rows, error: readError } = await supabase
      .from('item_stock_locations')
      .select('id, item_id, sku, location_name, stock_level')
      .or(`item_id.eq.${itemId},sku.eq.${sku}`)
      .ilike('bin_code', binCode)
      .in('location_name', aliases)

    if (readError) throw new Error(readError.message)

    const existingRows = rows || []
    const locationKey = canonicalLocationKey(locationName)
    const canonicalRow = existingRows.find((row: any) => canonicalLocationKey(row.location_name) === locationKey)
    const positiveRows = existingRows
      .filter((row: any) => Number(row.stock_level || 0) > 0)
      .sort((a: any, b: any) => {
        const aCanonical = canonicalLocationKey(a.location_name) === locationKey ? 0 : 1
        const bCanonical = canonicalLocationKey(b.location_name) === locationKey ? 0 : 1
        return aCanonical - bCanonical
      })

    if (delta < 0) {
      const availableStock = positiveRows.reduce(
        (total: number, row: any) => total + Number(row.stock_level || 0),
        0
      )
      const nextStock = availableStock + delta

      if (availableStock <= 0 && allowMissingSource) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          reason: 'missing_source_stock_row',
          sku,
          location_name: locationName,
          bin_code: binCode,
          current_stock: 0,
          next_stock: 0,
        })
      }

      if (nextStock < 0) {
        return NextResponse.json(
          {
            ok: false,
            error: 'insufficient_stock',
            sku,
            location_name: locationName,
            bin_code: binCode,
            current_stock: availableStock,
            attempted_delta: delta,
          },
          { status: 409 }
        )
      }

      let remaining = Math.abs(delta)

      for (const row of positiveRows) {
        if (remaining <= 0) break

        const rowStock = Number(row.stock_level || 0)
        const deduction = Math.min(rowStock, remaining)
        remaining -= deduction

        const { error } = await supabase
          .from('item_stock_locations')
          .update({
            sku,
            location_name: locationName,
            stock_level: rowStock - deduction,
            source,
            updated_at: now,
          })
          .eq('id', row.id)

        if (error) throw new Error(error.message)
      }

      await syncItemStockTotal(supabase, itemId)

      return NextResponse.json({
        ok: true,
        row: positiveRows[0] || null,
        current_stock: availableStock,
        next_stock: nextStock,
      })
    }

    const existing = canonicalRow
    const currentStock = Number(existing?.stock_level || 0)
    const nextStock = currentStock + delta

    if (nextStock < 0) {
      return NextResponse.json(
        {
          ok: false,
          error: 'insufficient_stock',
          sku,
          location_name: locationName,
          bin_code: binCode,
          current_stock: currentStock,
          attempted_delta: delta,
        },
        { status: 409 }
      )
    }

    if (existing) {
      const { data, error } = await supabase
        .from('item_stock_locations')
        .update({
          sku,
          stock_level: nextStock,
          source,
          updated_at: now,
        })
        .eq('id', existing.id)
        .select('id, item_id, sku, location_name, bin_code, stock_level')
        .single()

      if (error) throw new Error(error.message)

      await syncItemStockTotal(supabase, itemId)

      return NextResponse.json({
        ok: true,
        row: data,
        current_stock: currentStock,
        next_stock: nextStock,
      })
    }

    const { data, error } = await supabase
      .from('item_stock_locations')
      .insert({
        item_id: itemId,
        sku,
        location_name: locationName,
        location_id: null,
        bin_code: binCode,
        stock_level: nextStock,
        source,
        synced_at: null,
        updated_at: now,
      })
      .select('id, item_id, sku, location_name, bin_code, stock_level')
      .single()

    if (error) throw new Error(error.message)

    await syncItemStockTotal(supabase, itemId)

    return NextResponse.json({
      ok: true,
      row: data,
      current_stock: currentStock,
      next_stock: nextStock,
    })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error.message || 'Stock adjustment failed.' },
      { status: 500 }
    )
  }
}

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireCompanyAccess } from '@/lib/serverTenant'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const WAREHOUSE_LOCATION = 'LOCATION-1'
const DEFAULT_BIN = 'Default'

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

function normalizeIdentifier(value: any) {
  return text(value).replace(/\s+/g, '').toUpperCase()
}

function getYearPrefix() {
  return new Date().getFullYear().toString().slice(-2)
}

function luhnCheckDigit(input: string) {
  let sum = 0
  let shouldDouble = true

  for (let i = input.length - 1; i >= 0; i--) {
    let digit = Number(input[i])

    if (shouldDouble) {
      digit *= 2
      if (digit > 9) digit -= 9
    }

    sum += digit
    shouldDouble = !shouldDouble
  }

  return String((10 - (sum % 10)) % 10)
}

function randomSequenceNumber() {
  return Math.floor(Math.random() * 10000000)
}

async function generateSkus(supabase: any, quantity: number, companyId?: string | null) {
  const yearPrefix = getYearPrefix()
  const skus: string[] = []
  const rowsToInsert: Array<{
    company_id?: string
    sku: string
    year_prefix: string
    sequence_number: number
    check_digit: string
  }> = []

  let attempts = 0

  while (skus.length < quantity && attempts < quantity * 150) {
    attempts++
    const sequenceNumber = randomSequenceNumber()
    const body = `${yearPrefix}${String(sequenceNumber).padStart(7, '0')}`
    const checkDigit = luhnCheckDigit(body)
    const sku = `${body}${checkDigit}`

    if (skus.includes(sku)) continue

    let itemCheckQuery = supabase
      .from('items')
      .select('sku')
      .eq('sku', sku)

    if (companyId) itemCheckQuery = itemCheckQuery.eq('company_id', companyId)

    const { data: existingItem, error: itemCheckError } = await itemCheckQuery.maybeSingle()

    if (itemCheckError) throw new Error(`Item SKU check failed: ${itemCheckError.message}`)
    if (existingItem) continue

    let generatedCheckQuery = supabase
      .from('generated_skus')
      .select('sku')
      .eq('sku', sku)

    if (companyId) generatedCheckQuery = generatedCheckQuery.eq('company_id', companyId)

    const { data: existingGenerated, error: generatedCheckError } = await generatedCheckQuery.maybeSingle()

    if (generatedCheckError) {
      throw new Error(`Generated SKU check failed: ${generatedCheckError.message}`)
    }

    if (existingGenerated) continue

    skus.push(sku)
    rowsToInsert.push({
      ...(companyId ? { company_id: companyId } : {}),
      sku,
      year_prefix: yearPrefix,
      sequence_number: sequenceNumber,
      check_digit: checkDigit,
    })
  }

  if (skus.length !== quantity) {
    throw new Error('Could not generate enough unique SKUs.')
  }

  const { error: insertError } = await supabase.from('generated_skus').insert(rowsToInsert)
  if (insertError) throw new Error(`Saving generated SKUs failed: ${insertError.message}`)

  return skus
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const batchId = text(body.batch_id || body.batchId)
    const staffId = text(body.staff_id || body.staffId)
    const requestCompanyId = text(body.company_id || body.companyId)
    const actualQuantity = Number(body.actual_quantity ?? body.actualQuantity ?? 0)
    const useRfid = Boolean(body.use_rfid ?? body.useRfid ?? true)
    const tids = Array.from(
      new Set(
        (Array.isArray(body.tids) ? body.tids : [])
          .map((tid: any) => normalizeIdentifier(tid))
          .filter(Boolean)
      )
    )
    const now = new Date().toISOString()

    if (!batchId) {
      return NextResponse.json({ ok: false, message: 'Missing batch_id.' }, { status: 400 })
    }

    if (!Number.isInteger(actualQuantity) || actualQuantity <= 0) {
      return NextResponse.json({ ok: false, message: 'Actual quantity must be greater than 0.' }, { status: 400 })
    }

    if (useRfid && tids.length !== actualQuantity) {
      return NextResponse.json(
        { ok: false, message: `RFID TID count (${tids.length}) must match actual quantity (${actualQuantity}).` },
        { status: 400 }
      )
    }

    const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member'])
    if (!access.ok) {
      return NextResponse.json({ ok: false, message: access.message }, { status: access.status })
    }

    const companyId = access.company.id
    if (requestCompanyId && requestCompanyId !== companyId) {
      return NextResponse.json({ ok: false, message: 'Company mismatch.' }, { status: 403 })
    }

    const supabase = getSupabaseAdmin()
    let batchQuery = supabase
      .from('inbound_batches')
      .select('*')
      .eq('id', batchId)
      .eq('company_id', companyId)

    const { data: batch, error: batchError } = await batchQuery.maybeSingle()

    if (batchError) throw new Error(batchError.message)
    if (!batch) {
      return NextResponse.json({ ok: false, message: 'Inbound batch not found.' }, { status: 404 })
    }

    if (['working', 'completed', 'cancelled'].includes(text(batch.status))) {
      return NextResponse.json(
        { ok: false, message: `Batch ${batch.batch_code} is already ${batch.status}.` },
        { status: 409 }
      )
    }

    if (useRfid) {
      const { data: existingTids, error: tidCheckError } = await supabase
        .from('item_identifiers')
        .select('identifier_value')
        .eq('identifier_type', 'rfid')
        .in('identifier_value_normalized', tids)
        .eq('is_active', true)

      if (tidCheckError) throw new Error(tidCheckError.message)

      if ((existingTids || []).length > 0) {
        return NextResponse.json(
          {
            ok: false,
            message: `RFID TID already assigned: ${(existingTids || [])
              .map((row: any) => row.identifier_value)
              .join(', ')}`,
          },
          { status: 409 }
        )
      }
    }

    const skus = await generateSkus(supabase, actualQuantity, companyId)
    const itemRows = skus.map((sku, index) => ({
      ...(companyId ? { company_id: companyId } : {}),
      sku,
      status: 'working',
      stock_level: 1,
      sku_type: 'single_use',
      location_status: 'stored',
      current_location: WAREHOUSE_LOCATION,
      current_bin: DEFAULT_BIN,
      loan_status: 'not_on_loan',
      ebay_status: 'not_listed',
      linnworks_status: 'not_synced',
      shopify_status: 'not_listed',
      square_status: 'not_listed',
      grailed_status: 'not_listed',
      vestiaire_collective_status: 'not_listed',
      whatnot_status: 'not_listed',
      vinted_status: 'not_listed',
      depop_status: 'not_listed',
      tiktok_shop_status: 'not_listed',
      brand: text(batch.default_brand) || null,
      reporting_category: text(batch.default_reporting_category) || null,
      sub_category: text(batch.default_sub_category) || null,
      item_type: text(batch.default_item_type) || null,
      cost_price: batch.cost_price === null || batch.cost_price === undefined ? null : Number(batch.cost_price),
      inbound_batch_id: batch.id,
      inbound_batch_code: batch.batch_code,
      rfid_tid: useRfid ? tids[index] : null,
      last_saved_by: staffId || null,
      updated_at: now,
    }))

    const { data: createdItems, error: itemInsertError } = await supabase
      .from('items')
      .insert(itemRows)
      .select('id, sku, rfid_tid')

    if (itemInsertError) throw new Error(itemInsertError.message)

    const stockRows = (createdItems || []).map((item: any) => ({
      ...(companyId ? { company_id: companyId } : {}),
      item_id: item.id,
      sku: item.sku,
      location_name: WAREHOUSE_LOCATION,
      location_id: null,
      bin_code: DEFAULT_BIN,
      stock_level: 1,
      source: 'inbound_receiving',
      updated_at: now,
    }))

    const { error: stockError } = await supabase
      .from('item_stock_locations')
      .upsert(stockRows, { onConflict: 'company_id,item_id,location_name,bin_code' })

    if (stockError) throw new Error(stockError.message)

    const identifierRows = (createdItems || []).flatMap((item: any) => {
      const rows = [{
        ...(companyId ? { company_id: companyId } : {}),
        item_id: item.id,
        sku: item.sku,
        identifier_type: 'sku',
        identifier_value: item.sku,
        identifier_value_normalized: normalizeIdentifier(item.sku),
        is_active: true,
        assigned_by: staffId || null,
      }]

      if (useRfid && item.rfid_tid) {
        rows.push({
        ...(companyId ? { company_id: companyId } : {}),
        item_id: item.id,
        sku: item.sku,
        identifier_type: 'rfid',
        identifier_value: item.rfid_tid,
        identifier_value_normalized: normalizeIdentifier(item.rfid_tid),
        is_active: true,
        assigned_by: staffId || null,
        })
      }

      return rows
    })

    const { error: identifierError } = await supabase
      .from('item_identifiers')
      .insert(identifierRows)

    if (identifierError) throw new Error(identifierError.message)

    if (useRfid) {
      const rfidRows = (createdItems || []).map((item: any) => ({
        ...(companyId ? { company_id: companyId } : {}),
        batch_id: batch.id,
        tid: item.rfid_tid,
        tid_normalized: normalizeIdentifier(item.rfid_tid),
        item_id: item.id,
        status: 'assigned',
        assigned_at: now,
        updated_at: now,
      }))

      const { error: rfidError } = await supabase
        .from('inbound_batch_rfids')
        .upsert(rfidRows, { onConflict: 'tid_normalized' })

      if (rfidError) throw new Error(rfidError.message)
    }

    const { error: batchUpdateError } = await supabase
      .from('inbound_batches')
      .update({
        actual_quantity: actualQuantity,
        status: 'working',
        received_by: staffId || null,
        received_at: now,
        updated_at: now,
      })
      .eq('id', batch.id)
      .eq('company_id', companyId)

    if (batchUpdateError) throw new Error(batchUpdateError.message)

    return NextResponse.json({
      ok: true,
      batch_id: batch.id,
      batch_code: batch.batch_code,
      created_count: createdItems?.length || 0,
      items: createdItems || [],
    })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'Could not generate working items.' },
      { status: 500 }
    )
  }
}

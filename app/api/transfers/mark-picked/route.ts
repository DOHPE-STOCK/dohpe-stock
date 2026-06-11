import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const DEFAULT_LOCATION_MAPPINGS: Record<string, string> = {
  'LOCATION-1': 'Default',
  'LOCATION-2': 'SHOP-1',
  'LOCATION-3': 'SHOP-2',
  'LOCATION-4': 'SHOP-3',
  'LOCATION-5': 'SHOP-4',
  WAREHOUSE: 'Default',
  DEFAULT: 'Default',
}

let activeLocationMappings = DEFAULT_LOCATION_MAPPINGS

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

function canonical(value: any) {
  return text(value).toUpperCase()
}

async function loadLocationMappings(supabase: any, companyId?: string) {
  let query = supabase
    .from('integration_settings')
    .select('settings')
    .eq('channel', 'linnworks')

  if (companyId) query = query.eq('company_id', companyId)

  const { data, error } = await query
    .maybeSingle()

  if (error) return DEFAULT_LOCATION_MAPPINGS

  const saved =
    data?.settings?.location_mapping ||
    data?.settings?.location_mappings ||
    {}

  const mappings: Record<string, string> = { ...DEFAULT_LOCATION_MAPPINGS }

  for (const [appLocation, linnworksLocation] of Object.entries(saved)) {
    const key = canonical(appLocation)
    const value = text(linnworksLocation)

    if (key && value) {
      mappings[key] = value
    }
  }

  return mappings
}

function appStorageLocation(value: any) {
  const clean = text(value)
  const key = canonical(clean)

  if (!clean) return 'LOCATION-1'
  if (/^LOCATION-\d+$/i.test(clean)) return key

  if (key === 'DEFAULT' || key === 'WAREHOUSE') {
    const warehouseEntry = Object.entries(activeLocationMappings).find(([, mapped]) => {
      const mappedKey = canonical(mapped)
      return mappedKey === 'DEFAULT' || mappedKey === 'WAREHOUSE'
    })

    return warehouseEntry?.[0] || 'LOCATION-1'
  }

  const displayMatch = Object.entries(activeLocationMappings).find(([, mapped]) => {
    return canonical(mapped) === key
  })

  if (displayMatch?.[0]) return displayMatch[0]

  const shopMatch = key.match(/^SHOP-(\d+)$/)
  if (shopMatch) return `LOCATION-${Number(shopMatch[1]) + 1}`

  return key
}

function displayLocation(value: any) {
  const storage = appStorageLocation(value)
  const mapped = activeLocationMappings[storage]

  if (!mapped) return storage

  if (canonical(mapped) === 'DEFAULT') return 'WAREHOUSE'

  return mapped
}

function sameLocation(a: any, b: any) {
  return appStorageLocation(a) === appStorageLocation(b)
}

function itemDescription(item: any, sku: string) {
  const parts = [
    sku,
    text(item?.brand),
    text(item?.reporting_category),
  ].filter(Boolean)

  return parts.join(' ')
}

async function sendTelegramReply(params: {
  chatId: string
  messageId: string | number
  text: string
}) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  if (!botToken || !params.chatId || !params.messageId) {
    return { skipped: true }
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: params.chatId,
      reply_to_message_id: params.messageId,
      text: params.text,
    }),
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(`Telegram reply failed: ${JSON.stringify(data)}`)
  }

  return { ok: true }
}

async function getTransferPickProgress(supabase: any, transferId: string, companyId?: string | null) {
  let query = supabase
    .from('stock_transfer_items')
    .select('id, status')
    .eq('transfer_id', transferId)

  if (companyId) query = query.eq('company_id', companyId)

  const { data, error } = await query

  if (error) throw new Error(error.message)

  const rows = data || []

  const pickedCount = rows.filter((row: any) =>
    ['picked', 'in_transfer', 'in_transit', 'received'].includes(text(row.status))
  ).length

  return {
    total: rows.length,
    picked: pickedCount,
    all_picked: rows.length > 0 && pickedCount === rows.length,
    transfer_status_changed: false,
    note: 'Transfer remains pending_pick until you manually send/print/dispatch it.',
  }
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseAdmin()
    activeLocationMappings = DEFAULT_LOCATION_MAPPINGS

    const body = await request.json().catch(() => ({}))

    const sku = text(body.sku).toUpperCase()
    const fromLocation = appStorageLocation(body.from_location)
    const sourceBin = text(body.source_bin).toUpperCase()
    const pickedBy = text(body.picked_by)
    const pickedById = text(body.picked_by_id)

    if (!sku || !fromLocation || !sourceBin) {
      return NextResponse.json(
        { ok: false, message: 'Missing sku, from_location or source_bin.' },
        { status: 400 }
      )
    }

    const { data: rows, error } = await supabase
      .from('stock_transfer_items')
      .select(`
        id,
        company_id,
        transfer_id,
        sku,
        status,
        source_bin,
        source_order_id,
        telegram_chat_id,
        telegram_message_id,
        items (
          brand,
          reporting_category
        ),
        stock_transfers (
          id,
          transfer_number,
          from_location,
          to_location,
          status,
          reason
        )
      `)
      .eq('sku', sku)
      .eq('status', 'pending_pick')
      .eq('source_bin', sourceBin)
      .order('created_at', { ascending: true })
      .limit(20)

    if (error) throw new Error(error.message)

    const match = (rows || []).find((row: any) => {
      const transfer = Array.isArray(row.stock_transfers)
        ? row.stock_transfers[0]
        : row.stock_transfers

      return (
        sameLocation(transfer?.from_location, fromLocation) &&
        sameLocation(transfer?.to_location, 'LOCATION-1') &&
        text(transfer?.status) === 'pending_pick' &&
        text(transfer?.reason) === 'online_order_pick'
      )
    })

    if (!match) {
      return NextResponse.json(
        {
          ok: false,
          message: `No pending ${displayLocation(fromLocation)} / ${sourceBin} pick found for ${sku}.`,
        },
        { status: 404 }
      )
    }

    activeLocationMappings = await loadLocationMappings(supabase, match.company_id || undefined)

    const now = new Date().toISOString()

    let updateQuery = supabase
      .from('stock_transfer_items')
      .update({
        status: 'picked',
        picked_at: now,
        picked_by: pickedById || null,
      })
      .eq('id', match.id)

    if (match.company_id) updateQuery = updateQuery.eq('company_id', match.company_id)

    const { error: updateError } = await updateQuery

    if (updateError) throw new Error(updateError.message)

    const transfer = Array.isArray(match.stock_transfers)
      ? match.stock_transfers[0]
      : match.stock_transfers

    const transferStatus = await getTransferPickProgress(supabase, match.transfer_id, match.company_id)

    let telegramReply: any = { skipped: true }

    if (match.telegram_chat_id && match.telegram_message_id) {
      telegramReply = await sendTelegramReply({
        chatId: match.telegram_chat_id,
        messageId: match.telegram_message_id,
        text: `✅ ${itemDescription(match.items, sku)} picked by ${pickedBy || 'staff'} from ${displayLocation(fromLocation)} / ${sourceBin}`,
      })
    }

    return NextResponse.json({
      ok: true,
      message: `${sku} marked as picked.`,
      company_id: match.company_id || null,
      transfer_id: match.transfer_id,
      transfer_number: transfer?.transfer_number || null,
      from_location: appStorageLocation(transfer?.from_location),
      to_location: appStorageLocation(transfer?.to_location),
      display_from_location: displayLocation(transfer?.from_location),
      display_to_location: displayLocation(transfer?.to_location),
      transfer_status: transferStatus,
      telegram_reply: telegramReply,
    })
  } catch (error: any) {
    console.error('MARK_TRANSFER_PICKED_ERROR', error)

    return NextResponse.json(
      {
        ok: false,
        message: error.message || 'Unknown mark picked error.',
      },
      { status: 500 }
    )
  }
}

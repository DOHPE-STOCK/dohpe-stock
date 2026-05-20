import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

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

async function getTransferPickProgress(supabase: any, transferId: string) {
  const { data, error } = await supabase
    .from('stock_transfer_items')
    .select('id, status')
    .eq('transfer_id', transferId)

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
    const body = await request.json().catch(() => ({}))

    const sku = text(body.sku).toUpperCase()
    const fromLocation = text(body.from_location).toUpperCase()
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
        transfer_id,
        sku,
        status,
        source_bin,
        source_order_id,
        telegram_chat_id,
        telegram_message_id,
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
        text(transfer?.from_location).toUpperCase() === fromLocation &&
        text(transfer?.to_location).toUpperCase() === 'WAREHOUSE' &&
        text(transfer?.status) === 'pending_pick' &&
        text(transfer?.reason) === 'online_order_pick'
      )
    })

    if (!match) {
      return NextResponse.json(
        {
          ok: false,
          message: `No pending ${fromLocation} / ${sourceBin} pick found for ${sku}.`,
        },
        { status: 404 }
      )
    }

    const now = new Date().toISOString()

    const { error: updateError } = await supabase
      .from('stock_transfer_items')
      .update({
        status: 'picked',
        picked_at: now,
        picked_by: pickedById || null,
      })
      .eq('id', match.id)

    if (updateError) throw new Error(updateError.message)

    const transfer = Array.isArray(match.stock_transfers)
      ? match.stock_transfers[0]
      : match.stock_transfers

    const transferStatus = await getTransferPickProgress(supabase, match.transfer_id)

    let telegramReply: any = { skipped: true }

    if (match.telegram_chat_id && match.telegram_message_id) {
      telegramReply = await sendTelegramReply({
        chatId: match.telegram_chat_id,
        messageId: match.telegram_message_id,
        text: `✅ ${sku} picked by ${pickedBy || 'staff'} from ${fromLocation} / ${sourceBin}`,
      })
    }

    return NextResponse.json({
      ok: true,
      message: `${sku} marked as picked.`,
      transfer_id: match.transfer_id,
      transfer_number: transfer?.transfer_number || null,
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

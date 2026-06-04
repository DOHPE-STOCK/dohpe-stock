import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

async function sendTelegram(message: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID

  if (!token || !chatId) {
    return {
      ok: false,
      error: 'Missing TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID',
    }
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
        }),
      }
    )

    const data = await response.json()

    return data
  } catch (error: any) {
    return {
      ok: false,
      error: error.message,
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')

    if (
      !process.env.CRON_SECRET ||
      authHeader !== `Bearer ${process.env.CRON_SECRET}`
    ) {
      return NextResponse.json(
        {
          ok: false,
          message: 'Unauthorised.',
        },
        {
          status: 401,
        }
      )
    }

    const issues: any[] = []

    /*
      DUPLICATE STOCK ROWS
    */

    const { data: stockRows, error: stockError } = await supabase
      .from('item_stock_locations')
      .select(`
        id,
        item_id,
        sku,
        location_name,
        bin_code,
        stock_level
      `)

    if (stockError) {
      throw new Error(stockError.message)
    }

    const duplicateMap = new Map<string, any[]>()

    for (const row of stockRows || []) {
      const key = [
        row.item_id,
        text(row.location_name).toUpperCase(),
        text(row.bin_code).toUpperCase(),
      ].join('::')

      const existing = duplicateMap.get(key) || []
      existing.push(row)
      duplicateMap.set(key, existing)
    }

    for (const rows of duplicateMap.values()) {
      if (rows.length <= 1) continue

      issues.push({
        severity: 'critical',
        category: 'duplicate_stock_rows',
        reference_id: rows[0].sku,
        message: `Duplicate stock rows found for ${rows[0].sku}`,
        payload: rows,
      })
    }

    /*
      NEGATIVE STOCK
    */

    for (const row of stockRows || []) {
      if (Number(row.stock_level || 0) < 0) {
        issues.push({
          severity: 'warning',
          category: 'negative_stock',
          reference_id: row.sku,
          message: `${row.sku} has negative stock in ${row.location_name} / ${row.bin_code}`,
          payload: row,
        })
      }
    }

    /*
      FAILED QUEUE ROWS
    */

    const { data: failedQueueRows } = await supabase
      .from('linnworks_sync_queue')
      .select('*')
      .in('status', ['failed'])

    for (const row of failedQueueRows || []) {
      issues.push({
        severity: 'critical',
        category: 'failed_queue_row',
        reference_id: row.sku,
        message: `Failed Linnworks queue row for ${row.sku}`,
        payload: row,
      })
    }

    /*
      STALE PENDING QUEUE ROWS
    */

    const staleCutoff = new Date(
      Date.now() - 1000 * 60 * 30
    ).toISOString()

    const { data: stalePendingRows } = await supabase
      .from('linnworks_sync_queue')
      .select('*')
      .eq('status', 'pending')
      .lt('created_at', staleCutoff)

    for (const row of stalePendingRows || []) {
      issues.push({
        severity: 'warning',
        category: 'stale_pending_queue',
        reference_id: row.sku,
        message: `Pending queue row older than 30 mins for ${row.sku}`,
        payload: row,
      })
    }

    /*
      STUCK TRANSFERS
    */

    const stuckTransferCutoff = new Date(
      Date.now() - 1000 * 60 * 60 * 24
    ).toISOString()

    const { data: stuckTransfers } = await supabase
      .from('stock_transfer_items')
      .select('*')
      .eq('status', 'in_transfer')
      .lt('created_at', stuckTransferCutoff)

    for (const row of stuckTransfers || []) {
      issues.push({
        severity: 'warning',
        category: 'stuck_transfer',
        reference_id: row.sku,
        message: `Transfer item stuck in_transfer for >24h`,
        payload: row,
      })
    }

    /*
      LEGACY LOCATIONS
    */

    const legacyRows =
      (stockRows || []).filter((row) => {
        const location = text(row.location_name).toUpperCase()

        return (
          location === 'WAREHOUSE' ||
          location === 'SHOP-1' ||
          location === 'SHOP-2' ||
          location === 'SHOP-3'
        )
      })

    for (const row of legacyRows) {
      issues.push({
        severity: 'critical',
        category: 'legacy_location',
        reference_id: row.sku,
        message: `Legacy location row found for ${row.sku}`,
        payload: row,
      })
    }

    /*
      MISSING STOCK DEDUCTIONS
    */

    const { data: processedSales } = await supabase
      .from('linnworks_processed_sales')
      .select('*')
      .eq('stock_deducted', true)

    for (const row of processedSales || []) {
      const deductions = row.stock_deductions || []

      if (!Array.isArray(deductions) || deductions.length === 0) {
        issues.push({
          severity: 'critical',
          category: 'missing_stock_deductions',
          reference_id: row.sku,
          message: `Missing stock deductions for ${row.sku}`,
          payload: row,
        })
      }
    }

    /*
      SAVE LOGS
    */

    if (issues.length > 0) {
      await supabase
        .from('system_integrity_logs')
        .insert(
          issues.map((issue) => ({
            severity: issue.severity,
            category: issue.category,
            reference_id: issue.reference_id,
            message: issue.message,
            payload: issue.payload,
          }))
        )
    }

    /*
      TELEGRAM REPORT
    */

    let telegramMessage = ''

    if (issues.length === 0) {
      telegramMessage =
`✅ Dohpe Integrity Check Passed

No integrity issues found.

Checked:
- Stock rows
- Queue rows
- Transfers
- Legacy locations
- Stock deductions
`
    } else {
      telegramMessage =
`🚨 Dohpe Integrity Issues Found

Total issues: ${issues.length}

${issues
  .slice(0, 15)
  .map((issue, index) => {
    return `${index + 1}. [${issue.severity.toUpperCase()}] ${issue.category}

${issue.message}

Reference: ${issue.reference_id || '-'}
`
  })
  .join('\n')}
`
    }

    const telegramResult = await sendTelegram(telegramMessage)

    return NextResponse.json({
      ok: true,
      checked_at: new Date().toISOString(),
      issue_count: issues.length,
      issues,
      telegram_sent: telegramResult?.ok || false,
      telegram_result: telegramResult,
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        message: error.message || 'Integrity check failed.',
      },
      {
        status: 500,
      }
    )
  }
}
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SQUARE_VERSION = '2026-01-22'

function getSquareBaseUrl() {
  return (process.env.SQUARE_ENVIRONMENT || 'sandbox').toLowerCase() === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com'
}

function poundsToMinorUnits(amount: any) {
  const value = Number(amount)

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Invalid refund amount.')
  }

  return Math.round(value * 100)
}

function getAccessToken() {
  const token = process.env.SQUARE_ACCESS_TOKEN

  if (!token) {
    throw new Error('Missing SQUARE_ACCESS_TOKEN.')
  }

  return token
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))

    const paymentId = String(body.payment_id || '').trim()
    const amount = poundsToMinorUnits(body.amount)
    const currency = String(body.currency || 'GBP').toUpperCase()
    const reason = String(body.reason || 'POS refund').slice(0, 192)

    if (!paymentId) {
      throw new Error('Missing original Square payment_id.')
    }

    const idempotencyKey = String(
      body.idempotency_key ||
        `refund-${paymentId}-${amount}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    ).slice(0, 45)

    const response = await fetch(`${getSquareBaseUrl()}/v2/refunds`, {
      method: 'POST',
      headers: {
        'Square-Version': SQUARE_VERSION,
        Authorization: `Bearer ${getAccessToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        payment_id: paymentId,
        amount_money: {
          amount,
          currency,
        },
        reason,
      }),
      cache: 'no-store',
    })

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const detail =
        data?.errors?.[0]?.detail ||
        data?.errors?.[0]?.code ||
        `Square refund failed with status ${response.status}`

      throw new Error(detail)
    }

    return NextResponse.json({
      ok: true,
      refund_id: data?.refund?.id || null,
      status: data?.refund?.status || null,
      refund: data?.refund || null,
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        message: error.message || 'Square refund failed.',
      },
      { status: 500 }
    )
  }
}
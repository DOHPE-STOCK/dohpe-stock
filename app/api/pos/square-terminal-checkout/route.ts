import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SQUARE_VERSION = '2026-01-22'

type SquareCheckoutStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'CANCEL_REQUESTED'
  | 'CANCELED'
  | 'COMPLETED'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('Missing Supabase admin environment variables.')
  }

  return createClient(url, serviceKey)
}

type AccessResult =
  | { ok: true; user?: any; staff?: any }
  | { ok: false; status: number; message: string }

async function requireAppLogin(): Promise<AccessResult> {
  const cookieStore = await cookies()

  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {
          // no-op: API auth check only
        },
      },
    }
  )

  const {
    data: { user },
    error,
  } = await supabaseAuth.auth.getUser()

  if (error || !user) {
    return { ok: false, status: 401, message: 'Login required.' }
  }

  return { ok: true, user }
}

function getActiveStaffFromRequest(request: Request) {
  const cookie = request.headers.get('cookie') || ''
  const match = cookie.match(/(?:^|;\s*)active_staff_user=([^;]+)/)

  if (!match) return null

  try {
    return JSON.parse(decodeURIComponent(match[1]))
  } catch {
    return null
  }
}

async function requireCheckoutPermission(request: Request, supabase: any): Promise<AccessResult> {
  const staffCookie = getActiveStaffFromRequest(request)

  if (!staffCookie?.id) {
    return { ok: false, status: 401, message: 'Staff PIN required.' }
  }

  const { data: staff, error } = await supabase
    .from('staff_users')
    .select('id, name, role, permissions, is_active')
    .eq('id', staffCookie.id)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (!staff || staff.is_active === false) {
    return { ok: false, status: 403, message: 'Staff access denied.' }
  }

  const permissions = staff.permissions || {}
  const allowed = staff.role === 'admin' || permissions.checkout === true

  if (!allowed) {
    return { ok: false, status: 403, message: 'Checkout permission required.' }
  }

  return { ok: true, staff }
}

async function requirePosAccess(request: Request, supabase: any): Promise<AccessResult> {
  const login = await requireAppLogin()

  if (!login.ok) return login

  const staffAccess = await requireCheckoutPermission(request, supabase)

  if (!staffAccess.ok) return staffAccess

  return { ok: true, user: login.user, staff: staffAccess.staff }
}

function accessDeniedResponse(access: AccessResult) {
  if (access.ok) {
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json(
    { ok: false, message: access.message },
    { status: access.status }
  )
}

function getSquareBaseUrl() {
  const environment = (process.env.SQUARE_ENVIRONMENT || 'sandbox').toLowerCase()

  return environment === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com'
}

function getSquareConfig() {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN
  const locationId = process.env.SQUARE_LOCATION_ID
  const deviceId = process.env.SQUARE_TERMINAL_DEVICE_ID

  if (!accessToken) throw new Error('Missing SQUARE_ACCESS_TOKEN')
  if (!locationId) throw new Error('Missing SQUARE_LOCATION_ID')
  if (!deviceId) throw new Error('Missing SQUARE_TERMINAL_DEVICE_ID')

  return {
    accessToken,
    locationId,
    deviceId,
    baseUrl: getSquareBaseUrl(),
  }
}

function squareHeaders(accessToken: string) {
  return {
    'Square-Version': SQUARE_VERSION,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
}

function poundsToMinorUnits(amount: any) {
  const numberAmount = Number(amount)

  if (!Number.isFinite(numberAmount) || numberAmount <= 0) {
    throw new Error('Invalid payment amount')
  }

  return Math.round(numberAmount * 100)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function squareFetch(
  path: string,
  options: {
    method?: string
    body?: any
    accessToken: string
    baseUrl: string
  }
) {
  const response = await fetch(`${options.baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: squareHeaders(options.accessToken),
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const detail =
      data?.errors?.[0]?.detail ||
      data?.errors?.[0]?.code ||
      data?.message ||
      `Square API error ${response.status}`

    throw new Error(detail)
  }

  return data
}

async function getTerminalCheckout(checkoutId: string) {
  const config = getSquareConfig()

  const data = await squareFetch(`/v2/terminals/checkouts/${checkoutId}`, {
    accessToken: config.accessToken,
    baseUrl: config.baseUrl,
  })

  return data.checkout
}

async function getPayment(paymentId: string) {
  const config = getSquareConfig()

  const data = await squareFetch(`/v2/payments/${paymentId}`, {
    accessToken: config.accessToken,
    baseUrl: config.baseUrl,
  })

  return data.payment
}

async function verifyCompletedPayment({
  checkout,
  expectedAmount,
  currency,
}: {
  checkout: any
  expectedAmount: number
  currency: string
}) {
  const paymentId = checkout?.payment_ids?.[0]

  if (!paymentId) {
    return {
      ok: false,
      message: 'Square checkout completed but no payment ID was returned.',
      payment: null,
    }
  }

  const payment = await getPayment(paymentId)

  const paidAmount = Number(payment?.amount_money?.amount || 0)
  const paidCurrency = String(payment?.amount_money?.currency || '')
  const paymentStatus = String(payment?.status || '')

  if (paymentStatus !== 'COMPLETED') {
    return {
      ok: false,
      message: `Square payment status is ${paymentStatus || 'unknown'}.`,
      payment,
    }
  }

  if (paidAmount !== expectedAmount || paidCurrency !== currency) {
    return {
      ok: false,
      message: `Square payment amount mismatch. Expected ${expectedAmount} ${currency}, got ${paidAmount} ${paidCurrency}.`,
      payment,
    }
  }

  return {
    ok: true,
    message: 'Square payment completed and verified.',
    payment,
  }
}

async function waitForFinalCheckoutStatus({
  checkoutId,
  expectedAmount,
  currency,
}: {
  checkoutId: string
  expectedAmount: number
  currency: string
}) {
  const startedAt = Date.now()
  const maxWaitMs = Number(process.env.SQUARE_TERMINAL_POLL_MS || 55000)
  const pollEveryMs = 2000

  let latestCheckout: any = null

  while (Date.now() - startedAt < maxWaitMs) {
    latestCheckout = await getTerminalCheckout(checkoutId)

    const status = String(latestCheckout?.status || '') as SquareCheckoutStatus

    if (status === 'COMPLETED') {
      const verification = await verifyCompletedPayment({
        checkout: latestCheckout,
        expectedAmount,
        currency,
      })

      if (!verification.ok) {
        return {
          ok: false,
          status,
          checkout: latestCheckout,
          payment: verification.payment,
          message: verification.message,
        }
      }

      return {
        ok: true,
        status,
        checkout: latestCheckout,
        payment: verification.payment,
        message: verification.message,
      }
    }

    if (status === 'CANCELED') {
      return {
        ok: false,
        status,
        checkout: latestCheckout,
        payment: null,
        message: 'Square checkout was cancelled.',
      }
    }

    await sleep(pollEveryMs)
  }

  return {
    ok: false,
    status: latestCheckout?.status || 'PENDING',
    checkout: latestCheckout,
    payment: null,
    message:
      'Square checkout is still pending or no clear response was received. Check the terminal before recording manually.',
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()

    const access = await requirePosAccess(request, supabase)

    if (!access.ok) {
      return accessDeniedResponse(access)
    }

    const body = await request.json().catch(() => ({}))
    const action = body.action || 'create_and_wait'

    if (action === 'status') {
      const checkoutId = String(body.checkout_id || '')

      if (!checkoutId) throw new Error('Missing checkout_id')

      const checkout = await getTerminalCheckout(checkoutId)

      return NextResponse.json({
        ok: true,
        status: checkout.status,
        square_status: checkout.status,
        checkout_id: checkout.id,
        checkout,
      })
    }

    if (action === 'cancel') {
      const checkoutId = String(body.checkout_id || '')

      if (!checkoutId) throw new Error('Missing checkout_id')

      const config = getSquareConfig()

      const data = await squareFetch(
        `/v2/terminals/checkouts/${checkoutId}/cancel`,
        {
          method: 'POST',
          body: {},
          accessToken: config.accessToken,
          baseUrl: config.baseUrl,
        }
      )

      return NextResponse.json({
        ok: true,
        status: data.checkout?.status,
        square_status: data.checkout?.status,
        checkout_id: data.checkout?.id,
        checkout: data.checkout,
      })
    }

    const config = getSquareConfig()
    const amount = poundsToMinorUnits(body.amount)
    const currency = String(body.currency || 'GBP').toUpperCase()

    const referenceId = String(
      body.sale_number ||
        body.sale_id ||
        `POS-${Date.now().toString(36).toUpperCase()}`
    ).slice(0, 40)

    const idempotencyKey =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`

    const createData = await squareFetch('/v2/terminals/checkouts', {
      method: 'POST',
      accessToken: config.accessToken,
      baseUrl: config.baseUrl,
      body: {
        idempotency_key: idempotencyKey,
        checkout: {
          amount_money: {
            amount,
            currency,
          },
          reference_id: referenceId,
          note: `Dohpe checkout ${referenceId}`,
          location_id: config.locationId,
          deadline_duration: 'PT5M',
          device_options: {
            device_id: config.deviceId,
            skip_receipt_screen: true,
            tip_settings: {
              allow_tipping: false,
            },
          },
        },
      },
    })

    const checkout = createData.checkout

    if (!checkout?.id) {
      throw new Error('Square did not return a checkout ID.')
    }

    const result = await waitForFinalCheckoutStatus({
      checkoutId: checkout.id,
      expectedAmount: amount,
      currency,
    })

    return NextResponse.json({
      ok: result.ok,
      status: result.status,
      square_status: result.status,
      checkout_id: checkout.id,
      payment_id: result.payment?.id || null,
      checkout: result.checkout || checkout,
      payment: result.payment,
      message: result.message,
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        status: 'ERROR',
        square_status: 'ERROR',
        message: error.message || 'Square Terminal checkout failed.',
      },
      { status: 500 }
    )
  }
}

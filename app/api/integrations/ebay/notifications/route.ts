import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

function verificationToken() {
  return (
    text(process.env.EBAY_PLATFORM_NOTIFICATION_VERIFICATION_TOKEN) ||
    text(process.env.EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN)
  )
}

function endpointUrl(request: NextRequest) {
  const configured = text(process.env.EBAY_PLATFORM_NOTIFICATION_ENDPOINT_URL)
  if (configured) return configured

  const url = new URL(request.url)
  url.search = ''
  return url.toString()
}

function challengeResponse(challengeCode: string, endpoint: string) {
  const token = verificationToken()
  if (!token) throw new Error('Missing eBay platform notification verification token.')

  return crypto
    .createHash('sha256')
    .update(challengeCode + token + endpoint)
    .digest('hex')
}

function findFirst(payload: any, keys: string[]) {
  const stack = [payload]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || typeof current !== 'object') continue

    for (const key of keys) {
      const value = current[key]
      if (text(value)) return text(value)
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') stack.push(value)
    }
  }

  return ''
}

function requestHeaders(request: NextRequest) {
  return Object.fromEntries(
    Array.from(request.headers.entries()).filter(([key]) =>
      [
        'content-type',
        'user-agent',
        'x-ebay-signature',
        'x-ebay-enp-public-key-id',
        'x-ebay-notification-id',
        'x-ebay-topic',
      ].includes(key.toLowerCase())
    )
  )
}

async function logNotification(request: NextRequest, payload: any) {
  const supabase = getSupabaseAdmin()
  const notificationId =
    text(request.headers.get('x-ebay-notification-id')) ||
    findFirst(payload, ['notificationId', 'notification_id', 'eventId', 'id'])
  const topic =
    text(request.headers.get('x-ebay-topic')) ||
    findFirst(payload, ['topic', 'notificationTopic', 'eventType'])
  const eventType = findFirst(payload, ['eventType', 'event_type', 'type'])
  const resource = findFirst(payload, ['resource', 'resourceId', 'resourceHref', 'href'])

  const { error } = await supabase
    .from('ebay_platform_notification_events')
    .insert({
      notification_id: notificationId || null,
      event_type: eventType || null,
      topic: topic || null,
      resource: resource || null,
      raw_payload: payload || {},
      headers: requestHeaders(request),
      action_taken: 'logged_only_no_business_mutation',
    })

  if (error) {
    const missingTable =
      error.code === '42P01' ||
      error.code === 'PGRST205' ||
      String(error.message || '').includes('ebay_platform_notification_events')

    if (!missingTable) throw new Error(error.message)
  }
}

export async function GET(request: NextRequest) {
  try {
    const challengeCode = text(request.nextUrl.searchParams.get('challenge_code'))

    if (!challengeCode) {
      return NextResponse.json({ ok: true, endpoint: 'ebay-platform-notifications' })
    }

    return NextResponse.json({
      challengeResponse: challengeResponse(challengeCode, endpointUrl(request)),
    })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'Could not verify eBay platform notification endpoint.' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const contentType = text(request.headers.get('content-type')).toLowerCase()
    const payload = contentType.includes('json')
      ? await request.json().catch(() => ({}))
      : { raw: await request.text().catch(() => '') }

    await logNotification(request, payload)
    return new NextResponse(null, { status: 204 })
  } catch {
    // Keep the endpoint available to eBay even if logging fails temporarily.
    return new NextResponse(null, { status: 202 })
  }
}

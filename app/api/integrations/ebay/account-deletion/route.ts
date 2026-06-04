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
  const token = text(process.env.EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN)
  if (!token) {
    throw new Error('Missing EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN.')
  }
  return token
}

function endpointUrl(request: NextRequest) {
  const configured = text(process.env.EBAY_MARKETPLACE_DELETION_ENDPOINT_URL)
  if (configured) return configured

  const url = new URL(request.url)
  url.search = ''
  return url.toString()
}

function challengeResponse(challengeCode: string, endpoint: string) {
  return crypto
    .createHash('sha256')
    .update(challengeCode + verificationToken() + endpoint)
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

function obfuscate(value: string) {
  const clean = text(value)
  if (!clean) return ''
  if (clean.length <= 4) return '****'
  return `${clean.slice(0, 2)}***${clean.slice(-2)}`
}

function sameIdentifier(a: string, b: string) {
  const first = text(a).toLowerCase()
  const second = text(b).toLowerCase()
  return Boolean(first && second && first === second)
}

function deletionPayloadMatchesConnectedAccount(settings: any, payload: any) {
  const ebayUserId = findFirst(payload, ['userId', 'user_id', 'ebayUserId'])
  const ebayUsername = findFirst(payload, ['username', 'userName', 'ebayUsername'])

  return (
    sameIdentifier(ebayUserId, settings?.ebay_user_id) ||
    sameIdentifier(ebayUserId, settings?.ebay_account_id) ||
    sameIdentifier(ebayUserId, settings?.seller_account_id) ||
    sameIdentifier(ebayUsername, settings?.ebay_username) ||
    sameIdentifier(ebayUsername, settings?.seller_username)
  )
}

async function logDeletionEvent(params: {
  payload: any
  actionTaken: string
  processed?: boolean
}) {
  const supabase = getSupabaseAdmin()
  const payload = params.payload || {}
  const notificationId = findFirst(payload, ['notificationId', 'notification_id', 'eventId', 'id'])
  const eventType = findFirst(payload, ['eventType', 'topic', 'notificationTopic'])
  const ebayUserId = findFirst(payload, ['userId', 'user_id', 'eiasToken', 'ebayUserId'])
  const ebayUsername = findFirst(payload, ['username', 'userName', 'ebayUsername'])

  const { error } = await supabase
    .from('ebay_account_deletion_events')
    .insert({
      notification_id: notificationId || null,
      event_type: eventType || null,
      ebay_user_id: obfuscate(ebayUserId) || null,
      ebay_username: obfuscate(ebayUsername) || null,
      raw_payload: payload,
      action_taken: params.actionTaken,
      processed_at: params.processed ? new Date().toISOString() : null,
    })

  if (error) {
    const missingTable =
      error.code === '42P01' ||
      error.code === 'PGRST205' ||
      String(error.message || '').includes('ebay_account_deletion_events')

    if (!missingTable) throw new Error(error.message)
  }
}

async function disconnectEbayIntegration() {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('integration_settings')
    .select('id, settings')
    .eq('channel', 'ebay')
    .maybeSingle()

  if (error) throw new Error(error.message)

  const settings = data?.settings || {}
  const nextSettings = {
    ...settings,
    oauth_refresh_token: null,
    oauth_refresh_token_saved_at: null,
    ebay_user_id: null,
    ebay_username: null,
    ebay_account_id: null,
    seller_username: null,
    seller_account_id: null,
    payment_policy_id: '',
    fulfillment_policy_id: '',
    return_policy_id: '',
    disconnected_reason: 'ebay_marketplace_account_deletion',
    disconnected_at: new Date().toISOString(),
  }

  await supabase
    .from('integration_settings')
    .update({
      enabled: false,
      auto_sync: false,
      connection_status: 'account_deleted',
      last_error: 'Disconnected after eBay marketplace account deletion notification.',
      settings: nextSettings,
      updated_at: new Date().toISOString(),
    })
    .eq('channel', 'ebay')
}

export async function GET(request: NextRequest) {
  try {
    const challengeCode = text(request.nextUrl.searchParams.get('challenge_code'))

    if (!challengeCode) {
      return NextResponse.json({ ok: false, message: 'Missing challenge_code.' }, { status: 400 })
    }

    return NextResponse.json({
      challengeResponse: challengeResponse(challengeCode, endpointUrl(request)),
    })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'Could not verify eBay account deletion endpoint.' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  let payload: any = {}

  try {
    payload = await request.json().catch(() => ({}))
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('integration_settings')
      .select('settings')
      .eq('channel', 'ebay')
      .maybeSingle()

    if (error) throw new Error(error.message)

    if (!deletionPayloadMatchesConnectedAccount(data?.settings || {}, payload)) {
      await logDeletionEvent({
        payload,
        actionTaken: 'ignored_notification_did_not_match_connected_ebay_account',
        processed: true,
      })

      return new NextResponse(null, { status: 204 })
    }

    await disconnectEbayIntegration()
    await logDeletionEvent({
      payload,
      actionTaken: 'ebay_integration_disconnected_token_and_account_metadata_removed',
      processed: true,
    })

    return new NextResponse(null, { status: 204 })
  } catch (error: any) {
    try {
      await logDeletionEvent({
        payload,
        actionTaken: `processing_error:${error.message || 'unknown_error'}`,
        processed: false,
      })
    } catch {
      // eBay requires fast acknowledgement; avoid cascading logging errors.
    }

    return new NextResponse(null, { status: 202 })
  }
}

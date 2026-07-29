import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/serverTenant'
import { mergedRfidZoneRules } from '@/lib/rfidZoneRules'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function failure(status: number, message: string) {
  return NextResponse.json({ ok: false, message }, { status })
}

function text(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function normaliseIdentifier(value: string) {
  return text(value).replace(/\s+/g, '').toUpperCase()
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function tokenHash(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function bearerToken(request: Request) {
  const header = request.headers.get('authorization') || ''
  return header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || ''
}

async function loadZoneByToken(token: string) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('rfid_zones')
    .select('id, company_id, name, code, zone_type, status, rules, token_revoked_at')
    .eq('token_hash', tokenHash(token))
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data || data.status !== 'active' || data.token_revoked_at) return null
  return data as any
}

async function resolveItem(companyId: string, tagKey: string, epc: string, tid: string) {
  const supabase = getSupabaseAdmin()
  const candidates = [tid, tagKey, epc].map(normaliseIdentifier).filter(Boolean)
  if (candidates.length === 0) return null

  const { data: identifierRows, error: identifierError } = await supabase
    .from('item_identifiers')
    .select('item_id, identifier_type, identifier_value_normalized')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .in('identifier_value_normalized', candidates)
    .limit(1)

  if (identifierError) throw new Error(identifierError.message)

  const itemId = identifierRows?.[0]?.item_id
  if (!itemId) {
    const { data: itemByTid, error: tidError } = await supabase
      .from('items')
      .select('id, sku, status, final_title, basic_title, ai_title, brand, reporting_category, sub_category, rfid_tid_normalized')
      .eq('company_id', companyId)
      .in('rfid_tid_normalized', candidates)
      .limit(1)

    if (tidError) {
      if (tidError.code === '42703') return null
      throw new Error(tidError.message)
    }
    return itemByTid?.[0] || null
  }

  const { data: item, error } = await supabase
    .from('items')
    .select('id, sku, status, final_title, basic_title, ai_title, brand, reporting_category, sub_category, rfid_tid_normalized')
    .eq('company_id', companyId)
    .eq('id', itemId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return item || null
}

async function itemHasPosSale(companyId: string, itemId: string) {
  const supabase = getSupabaseAdmin()
  const { count, error } = await supabase
    .from('pos_sale_lines')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('item_id', itemId)

  if (error) return false
  return (count || 0) > 0
}

async function recentAlarmExists(companyId: string, zoneId: string, tagKey: string, cooldownSeconds: number) {
  if (cooldownSeconds <= 0) return false
  const supabase = getSupabaseAdmin()
  const since = new Date(Date.now() - cooldownSeconds * 1000).toISOString()
  const { count, error } = await supabase
    .from('rfid_zone_events')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('zone_id', zoneId)
    .eq('tag_key', tagKey)
    .eq('alarm_triggered', true)
    .gte('event_at', since)

  if (error) return false
  return (count || 0) > 0
}

export async function POST(request: Request) {
  const token = bearerToken(request)
  if (!token) return failure(401, 'RFID zone token required.')

  const zone = await loadZoneByToken(token)
  if (!zone) return failure(403, 'RFID zone token is invalid or revoked.')

  const body = await request.json().catch(() => ({}))
  const events = Array.isArray(body.events) ? body.events : [body]
  const rules = mergedRfidZoneRules(zone.zone_type, zone.rules)
  const supabase = getSupabaseAdmin()
  const saved: any[] = []
  const alarms: any[] = []

  for (const rawEvent of events) {
    const tagKey = normaliseIdentifier(rawEvent.tag_key || rawEvent.tagKey || rawEvent.tid || rawEvent.epc)
    const epc = normaliseIdentifier(rawEvent.epc)
    const tid = normaliseIdentifier(rawEvent.tid)
    if (!tagKey) continue

    const item = await resolveItem(zone.company_id, tagKey, epc, tid)
    const knownItem = Boolean(item?.id)
    if (!knownItem && rules.ignore_unknown_tags && !rules.create_events_for_unknown_tags) continue

    const status = text(item?.status).toLowerCase()
    const soldByStatus = ['sold', 'processed', 'dispatched', 'completed', 'complete'].includes(status)
    const soldByPos = item?.id ? await itemHasPosSale(zone.company_id, item.id) : false
    const paidOrSold = soldByStatus || soldByPos
    const eventType = text(rawEvent.event_type || rawEvent.eventType || 'read').toLowerCase()
    const maxRssi = rawEvent.max_rssi ?? rawEvent.maxRssi ?? rawEvent.rssi
    const readCount = Math.max(0, Math.round(numberValue(rawEvent.read_count ?? rawEvent.readCount, 0)))
    const dwellSeconds = Math.max(0, numberValue(rawEvent.dwell_seconds ?? rawEvent.dwellSeconds, 0))
    const direction = text(rawEvent.direction || eventType)
    const isExitEvent = ['exited', 'outside', 'exit', 'alarm'].includes(eventType) || ['exited', 'outside', 'exit'].includes(direction)
    const atThreshold = eventType === 'read' || eventType === 'inside' || eventType === 'entered'
    const strongEnough = maxRssi === undefined || maxRssi === null || numberValue(maxRssi, -999) >= rules.min_alarm_rssi
    const repeatedEnough = readCount === 0 || readCount >= rules.min_alarm_read_count
    const dwelledEnough = dwellSeconds === 0 || dwellSeconds >= rules.min_alarm_dwell_seconds
    const staleInside = eventType === 'stale_inside'

    let shouldAlarm =
      knownItem &&
      !paidOrSold &&
      strongEnough &&
      repeatedEnough &&
      dwelledEnough &&
      ((rules.alarm_on_unpaid_exit && isExitEvent) ||
        (rules.alarm_on_unpaid_threshold && atThreshold) ||
        (rules.alarm_on_stale_inside && staleInside))

    if (shouldAlarm && (await recentAlarmExists(zone.company_id, zone.id, tagKey, rules.alarm_cooldown_seconds))) {
      shouldAlarm = false
    }

    const eventPayload = {
      company_id: zone.company_id,
      zone_id: zone.id,
      item_id: item?.id || null,
      tag_key: tagKey,
      epc: epc || null,
      tid: tid || null,
      event_type: shouldAlarm ? 'alarm' : eventType,
      direction,
      first_side: text(rawEvent.first_side || rawEvent.firstSide) || null,
      last_side: text(rawEvent.last_side || rawEvent.lastSide) || null,
      last_antenna: rawEvent.last_antenna ?? rawEvent.lastAntenna ?? null,
      max_rssi: maxRssi ?? null,
      read_count: readCount,
      known_item: knownItem,
      paid_or_sold: paidOrSold,
      alarm_triggered: shouldAlarm,
      alarm_status: shouldAlarm ? 'triggered' : 'none',
      metadata: {
        source: body.source || 'rfid_zone_monitor',
        zone_code: zone.code,
        raw_event: rawEvent,
        item_sku: item?.sku || null,
        item_title: item?.final_title || item?.basic_title || item?.ai_title || null,
      },
      event_at: text(rawEvent.event_at || rawEvent.eventAt) || new Date().toISOString(),
    }

    const { data, error } = await supabase.from('rfid_zone_events').insert(eventPayload).select('id, alarm_triggered').single()
    if (error) throw new Error(error.message)
    saved.push(data)

    if (shouldAlarm) {
      alarms.push({ item, tagKey, zoneName: zone.name, eventId: data.id })
      const sourceKey = `rfid-zone:${zone.id}:${tagKey}`
      const notificationPayload = {
        company_id: zone.company_id,
        user_id: null,
        source_key: sourceKey,
        notification_type: 'stock',
        severity: 'critical',
        title: 'Unpaid RFID item at exit',
        body: `${item?.sku || tagKey} was detected at ${zone.name} and is not marked paid/sold.`,
        href: `/inventory?search=${encodeURIComponent(item?.sku || tagKey)}`,
        metadata: { zone_id: zone.id, event_id: data.id, item_id: item?.id || null, tag_key: tagKey },
        read_at: null,
        dismissed_at: null,
        updated_at: new Date().toISOString(),
      }
      const { data: existingNotification } = await supabase
        .from('app_notifications')
        .select('id')
        .eq('company_id', zone.company_id)
        .eq('source_key', sourceKey)
        .is('user_id', null)
        .maybeSingle()

      if (existingNotification?.id) {
        await supabase.from('app_notifications').update(notificationPayload).eq('id', existingNotification.id)
      } else {
        await supabase.from('app_notifications').insert(notificationPayload)
      }
    }
  }

  await supabase.from('rfid_zones').update({ last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', zone.id)

  return NextResponse.json({ ok: true, saved_count: saved.length, alarm_count: alarms.length, alarms })
}

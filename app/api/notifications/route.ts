import { NextResponse } from 'next/server'
import { getSupabaseAdmin, requireCompanyAccess } from '@/lib/serverTenant'

type NotificationRow = {
  id: string
  company_id: string
  user_id?: string | null
  source_key?: string | null
  notification_type: string
  severity: 'info' | 'success' | 'warning' | 'critical'
  title: string
  body?: string | null
  href?: string | null
  read_at?: string | null
  dismissed_at?: string | null
  created_at: string
}

type AppNotification = {
  id: string
  sourceKey: string | null
  type: string
  severity: 'info' | 'success' | 'warning' | 'critical'
  title: string
  body: string
  href: string | null
  unread: boolean
  generated: boolean
  createdAt: string
}

const LIMIT_LABELS: Record<string, string> = {
  staff_limit: 'staff users',
  device_limit: 'devices',
  location_limit: 'locations',
  channel_limit: 'channels',
  department_limit: 'departments',
  sku_limit: 'SKUs',
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

function limitValue(limits: Record<string, any>, key: string) {
  if (!(key in limits)) return null
  const value = limits[key]
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function countRows(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  table: string,
  companyId: string,
  extra?: (query: any) => any
) {
  let query = supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)

  if (extra) query = extra(query)

  const { count, error } = await query
  if (error) return 0
  return count || 0
}

function normaliseStored(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    sourceKey: row.source_key || null,
    type: row.notification_type || 'system',
    severity: row.severity || 'info',
    title: row.title,
    body: row.body || '',
    href: row.href || null,
    unread: !row.read_at,
    generated: false,
    createdAt: row.created_at,
  }
}

export async function GET(request: Request) {
  const access = await requireCompanyAccess(request)
  if (!access.ok) return jsonError(access.message, access.status)

  const supabase = getSupabaseAdmin()
  const companyId = access.company.id
  const now = new Date()

  const [
    storedResult,
    dismissalsResult,
    subscriptionResult,
    staffCount,
    deviceCount,
    locationCount,
    channelCount,
    departmentCount,
    skuCount,
  ] = await Promise.all([
    supabase
      .from('app_notifications')
      .select('id, company_id, user_id, source_key, notification_type, severity, title, body, href, read_at, dismissed_at, created_at')
      .eq('company_id', companyId)
      .is('dismissed_at', null)
      .or(`user_id.is.null,user_id.eq.${access.user.id}`)
      .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('app_notification_dismissals')
      .select('source_key')
      .eq('company_id', companyId)
      .eq('user_id', access.user.id),
    supabase
      .from('company_subscriptions')
      .select('plan_key, status, payment_status, trial_ends_at, current_period_end, limits')
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    countRows(supabase, 'staff_users', companyId, (query) => query.eq('is_active', true)),
    countRows(supabase, 'company_devices', companyId, (query) => query.eq('is_active', true)),
    countRows(supabase, 'locations', companyId, (query) => query.eq('is_active', true)),
    countRows(supabase, 'integration_settings', companyId, (query) => query.eq('enabled', true)),
    countRows(supabase, 'company_departments', companyId, (query) => query.eq('is_active', true)),
    countRows(supabase, 'items', companyId),
  ])

  if (storedResult.error) return jsonError(storedResult.error.message, 500)

  const dismissedSourceKeys = new Set(
    (dismissalsResult.data || []).map((row: any) => String(row.source_key || '')).filter(Boolean)
  )
  const stored = ((storedResult.data || []) as NotificationRow[]).map(normaliseStored)
  const generated: AppNotification[] = []
  const subscription = subscriptionResult.data as any
  const limits = (subscription?.limits || {}) as Record<string, any>
  const usage: Record<string, number> = {
    staff_limit: staffCount,
    device_limit: deviceCount,
    location_limit: locationCount,
    channel_limit: channelCount,
    department_limit: departmentCount,
    sku_limit: skuCount,
  }

  if (!access.company.billing_exempt) {
    if (!['active', 'trial'].includes(access.company.access_state)) {
      const sourceKey = `billing:access:${access.company.access_state}`
      if (!dismissedSourceKeys.has(sourceKey)) {
        generated.push({
          id: `generated:${sourceKey}`,
          sourceKey,
          type: 'billing',
          severity: 'critical',
          title: 'Billing attention needed',
          body: `${access.company.name} is ${access.company.access_state.replaceAll('_', ' ')}.`,
          href: '/settings/company/billing',
          unread: true,
          generated: true,
          createdAt: now.toISOString(),
        })
      }
    }

    if (subscription?.trial_ends_at) {
      const trialEndsAt = new Date(subscription.trial_ends_at)
      const daysLeft = Math.ceil((trialEndsAt.getTime() - now.getTime()) / 86_400_000)
      if (daysLeft >= 0 && daysLeft <= 14) {
        const sourceKey = `billing:trial-ending:${trialEndsAt.toISOString().slice(0, 10)}`
        if (!dismissedSourceKeys.has(sourceKey)) {
          generated.push({
            id: `generated:${sourceKey}`,
            sourceKey,
            type: 'billing',
            severity: daysLeft <= 3 ? 'critical' : 'warning',
            title: 'Trial ending soon',
            body: daysLeft === 0 ? 'Your trial ends today.' : `Your trial ends in ${daysLeft} days.`,
            href: '/settings/company/billing',
            unread: true,
            generated: true,
            createdAt: now.toISOString(),
          })
        }
      }
    }

    for (const [key, used] of Object.entries(usage)) {
      const limit = limitValue(limits, key)
      if (!limit || limit <= 0) continue

      const ratio = used / limit
      if (ratio < 0.8) continue

      const severity = ratio >= 1 ? 'critical' : 'warning'
      const sourceKey = `limit:${key}:${severity}`
      if (dismissedSourceKeys.has(sourceKey)) continue

      generated.push({
        id: `generated:${sourceKey}`,
        sourceKey,
        type: 'limit',
        severity,
        title: `${LIMIT_LABELS[key] || key} limit ${ratio >= 1 ? 'reached' : 'approaching'}`,
        body: `${used} of ${limit} ${LIMIT_LABELS[key] || key} are currently used.`,
        href: '/settings/company/billing',
        unread: true,
        generated: true,
        createdAt: now.toISOString(),
      })
    }
  }

  const notifications = [...generated, ...stored].slice(0, 20)
  const unreadCount = notifications.filter((notification) => notification.unread).length

  return NextResponse.json({
    ok: true,
    notifications,
    unreadCount,
  })
}

export async function POST(request: Request) {
  const access = await requireCompanyAccess(request)
  if (!access.ok) return jsonError(access.message, access.status)

  const body = await request.json().catch(() => ({}))
  const action = String(body.action || '')
  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : []
  const sourceKeys: string[] = Array.isArray(body.sourceKeys)
    ? body.sourceKeys.map(String).filter(Boolean)
    : []
  const supabase = getSupabaseAdmin()
  const now = new Date().toISOString()

  if (action === 'mark_read') {
    if (ids.length > 0) {
      const { error } = await supabase
        .from('app_notifications')
        .update({ read_at: now, updated_at: now })
        .eq('company_id', access.company.id)
        .in('id', ids)
        .or(`user_id.is.null,user_id.eq.${access.user.id}`)

      if (error) return jsonError(error.message, 500)
    }

    return NextResponse.json({ ok: true })
  }

  if (action === 'dismiss') {
    if (ids.length > 0) {
      const { error } = await supabase
        .from('app_notifications')
        .update({ dismissed_at: now, read_at: now, updated_at: now })
        .eq('company_id', access.company.id)
        .in('id', ids)
        .or(`user_id.is.null,user_id.eq.${access.user.id}`)

      if (error) return jsonError(error.message, 500)
    }

    if (sourceKeys.length > 0) {
      const rows = sourceKeys.map((sourceKey) => ({
        company_id: access.company.id,
        user_id: access.user.id,
        source_key: sourceKey,
        dismissed_at: now,
      }))

      const { error } = await supabase
        .from('app_notification_dismissals')
        .upsert(rows, { onConflict: 'company_id,user_id,source_key' })

      if (error) return jsonError(error.message, 500)
    }

    return NextResponse.json({ ok: true })
  }

  return jsonError('Unknown notification action.')
}

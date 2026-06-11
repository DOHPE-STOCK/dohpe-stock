import { NextResponse } from 'next/server'
import { getServerUser, getSupabaseAdmin } from '@/lib/serverTenant'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status })
}

async function requirePlatformAdmin() {
  const user = await getServerUser()
  if (!user) return { ok: false as const, status: 401, message: 'Login required.' }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('platform_admin_users')
    .select('id, role')
    .or(`auth_user_id.eq.${user.id},user_id.eq.${user.id}`)
    .eq('is_active', true)
    .maybeSingle()

  if (error) return { ok: false as const, status: 500, message: error.message }
  if (!data) return { ok: false as const, status: 403, message: 'Platform admin access required.' }

  return { ok: true as const, user, supabase, admin: data }
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function cleanJsonObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export async function GET() {
  const access = await requirePlatformAdmin()
  if (!access.ok) return jsonError(access.message, access.status)

  const { data, error } = await access.supabase
    .from('billing_plans')
    .select('id, plan_key, name, description, is_public, is_custom, is_active, billing_plan_versions(id, version, currency, monthly_price, yearly_price, limits, features, provider, provider_price_id_monthly, provider_price_id_yearly, created_at)')
    .order('plan_key', { ascending: true })

  if (error) return jsonError(error.message, 500)

  return NextResponse.json({ ok: true, plans: data || [] })
}

export async function POST(request: Request) {
  const access = await requirePlatformAdmin()
  if (!access.ok) return jsonError(access.message, access.status)

  const body = await request.json().catch(() => ({}))
  const planId = String(body.plan_id || '')
  const planKey = String(body.plan_key || '')
  const description = String(body.description || '').trim()
  const monthlyPrice = toNullableNumber(body.monthly_price) ?? 0
  const yearlyPrice = toNullableNumber(body.yearly_price)
  const limits = cleanJsonObject(body.limits)
  const features = cleanJsonObject(body.features)
  const applyExisting = body.apply_existing === true

  if (!planId || !planKey) return jsonError('Missing billing plan.')

  const { data: plan, error: planError } = await access.supabase
    .from('billing_plans')
    .select('id, plan_key')
    .eq('id', planId)
    .eq('plan_key', planKey)
    .maybeSingle()

  if (planError) return jsonError(planError.message, 500)
  if (!plan) return jsonError('Billing plan not found.', 404)

  const { data: currentVersions, error: versionError } = await access.supabase
    .from('billing_plan_versions')
    .select('version, currency, provider')
    .eq('plan_id', planId)
    .order('version', { ascending: false })
    .limit(1)

  if (versionError) return jsonError(versionError.message, 500)

  const latestVersion = Number(currentVersions?.[0]?.version || 0)
  const nextVersion = latestVersion + 1

  const { error: planUpdateError } = await access.supabase
    .from('billing_plans')
    .update({
      description,
      updated_at: new Date().toISOString(),
    })
    .eq('id', planId)

  if (planUpdateError) return jsonError(planUpdateError.message, 500)

  const { data: insertedVersion, error: insertError } = await access.supabase
    .from('billing_plan_versions')
    .insert({
      plan_id: planId,
      version: nextVersion,
      currency: 'GBP',
      monthly_price: monthlyPrice,
      yearly_price: yearlyPrice,
      limits,
      features,
      provider: currentVersions?.[0]?.provider || 'stripe',
    })
    .select('id, version, monthly_price, yearly_price, limits, features')
    .single()

  if (insertError) return jsonError(insertError.message, 500)

  if (applyExisting) {
    const { error: subscriptionError } = await access.supabase
      .from('company_subscriptions')
      .update({
        limits,
      })
      .eq('plan_key', planKey)
      .neq('status', 'manual_active')

    if (subscriptionError) return jsonError(subscriptionError.message, 500)
  }

  return NextResponse.json({ ok: true, version: insertedVersion })
}

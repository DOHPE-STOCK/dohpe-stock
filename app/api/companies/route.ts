import { NextResponse } from 'next/server'
import { getServerUser, getSupabaseAdmin } from '@/lib/serverTenant'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const INTEGRATION_CHANNELS = [
  'linnworks',
  'ebay',
  'shopify',
  'vinted',
  'grailed',
  'vestiaire_collective',
  'whatnot',
  'square',
  'depop',
  'tiktok_shop',
]

const DEFAULT_LOCATIONS = [
  { code: 'LOCATION-1', name: 'LOCATION-1', label: 'Default', type: 'warehouse', bin_mode: 'range', basic_bins: ['Default'] },
  { code: 'LOCATION-2', name: 'LOCATION-2', label: 'Default', type: 'shop', bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
  { code: 'LOCATION-3', name: 'LOCATION-3', label: 'Default', type: 'shop', bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
  { code: 'LOCATION-4', name: 'LOCATION-4', label: 'Default', type: 'shop', bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
  { code: 'LOCATION-5', name: 'LOCATION-5', label: 'Default', type: 'shop', bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
]

const STARTER_LIMITS = {
  company_limit: 1,
  sku_limit: 2500,
  user_limit: 5,
  staff_limit: 10,
  device_limit: 2,
  location_limit: 2,
  channel_limit: 2,
  department_limit: 1,
  monthly_pos_transactions: 1000,
  monthly_ai_generations: 250,
}

const INTERNAL_LIMITS = {
  company_limit: null,
  sku_limit: null,
  user_limit: null,
  staff_limit: null,
  device_limit: null,
  location_limit: null,
  channel_limit: null,
  department_limit: null,
  monthly_pos_transactions: null,
  monthly_ai_generations: null,
  storage_gb: null,
  rfid_workflows: true,
  advanced_reports: true,
  cron_interval_minutes: 1,
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 54)

  return slug || `company-${Date.now()}`
}

async function makeUniqueSlug(supabase: any, name: string) {
  const base = slugify(name)

  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`
    const { data, error } = await supabase
      .from('companies')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (!data?.id) return candidate
  }

  return `${base}-${Date.now()}`
}

async function getUserCompanyCreationAccess(supabase: any, userId: string) {
  const { data: memberships, error } = await supabase
    .from('company_memberships')
    .select(
      `company_id, role, status,
      company:companies(id, name, slug, billing_exempt, internal_account, plan_key, access_state),
      subscription:company_subscriptions(
        provider,
        provider_customer_id,
        provider_subscription_id,
        provider_price_id,
        plan_key,
        status,
        payment_status,
        current_period_start,
        current_period_end,
        trial_started_at,
        trial_ends_at,
        limits
      )`
    )
    .eq('user_id', userId)
    .eq('status', 'active')

  if (error) throw new Error(error.message)

  const rows = memberships || []
  const ownedRows = rows.filter((row: any) => ['owner', 'admin'].includes(String(row.role || '')))

  if (rows.length > 0 && ownedRows.length === 0) {
    return {
      ok: false,
      ownedCompanyCount: 0,
      limit: 0,
      reason: 'owner_or_admin_required',
    }
  }

  const hasInternalOverride = rows.some((row: any) => {
    const company = Array.isArray(row.company) ? row.company[0] : row.company
    return company?.billing_exempt === true || company?.internal_account === true
  })

  if (hasInternalOverride) {
    return {
      ok: true,
      ownedCompanyCount: ownedRows.length,
      limit: null,
      reason: 'internal_override',
      templateSubscription: null,
    }
  }

  for (const row of ownedRows) {
    const subscription = Array.isArray(row.subscription) ? row.subscription[0] : row.subscription
    const limits = subscription?.limits || {}
    const subscriptionLimit = limits.company_limit

    if (subscriptionLimit === null) {
      return {
        ok: true,
        ownedCompanyCount: ownedRows.length,
        limit: null,
        reason: 'unlimited_plan',
        templateSubscription: subscription || null,
      }
    }
  }

  if (ownedRows.length > 0) {
    return {
      ok: false,
      ownedCompanyCount: ownedRows.length,
      limit: 1,
      reason: 'company_limit_reached',
    }
  }

  return {
    ok: true,
    ownedCompanyCount: ownedRows.length,
    limit: 1,
    reason: 'first_company_trial',
    templateSubscription: null,
  }
}

function accessStateFromSubscriptionStatus(status: string) {
  if (status === 'active' || status === 'manual_active') return 'active'
  if (status === 'trialing') return 'trial'
  if (status === 'past_due') return 'past_due'
  if (status === 'cancelled') return 'cancelled'
  return 'payment_required'
}

export async function POST(request: Request) {
  try {
    const user = await getServerUser()
    if (!user) {
      return NextResponse.json({ ok: false, message: 'Login required.' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const name = String(body.name || '').trim()

    if (!name) {
      return NextResponse.json({ ok: false, message: 'Company name is required.' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const creationAccess = await getUserCompanyCreationAccess(supabase, user.id)

    if (!creationAccess.ok) {
      return NextResponse.json(
        {
          ok: false,
          code: creationAccess.reason,
          message:
            creationAccess.reason === 'owner_or_admin_required'
              ? 'Only company owners or admins can create another company.'
              : 'Your current plan has reached its company limit. Additional companies require Enterprise.',
          owned_company_count: creationAccess.ownedCompanyCount,
          company_limit: creationAccess.limit,
        },
        { status: 402 }
      )
    }

    const slug = await makeUniqueSlug(supabase, name)
    const now = new Date().toISOString()
    const trialEndsAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString()
    const isInternalCompanyCreate = creationAccess.reason === 'internal_override'
    const isEnterpriseCompanyCreate = creationAccess.reason === 'unlimited_plan'
    const templateSubscription = creationAccess.templateSubscription || {}
    const planKey = isInternalCompanyCreate
      ? 'internal_lifetime'
      : isEnterpriseCompanyCreate
        ? String(templateSubscription.plan_key || 'enterprise')
        : 'starter'
    const subscriptionStatus = isInternalCompanyCreate
      ? 'manual_active'
      : isEnterpriseCompanyCreate
        ? String(templateSubscription.status || 'active')
        : 'trialing'
    const accessState = isInternalCompanyCreate
      ? 'active'
      : isEnterpriseCompanyCreate
        ? accessStateFromSubscriptionStatus(subscriptionStatus)
        : 'trial'
    const billingProvider = isInternalCompanyCreate
      ? 'manual'
      : isEnterpriseCompanyCreate
        ? String(templateSubscription.provider || 'stripe')
        : 'stripe'
    const paymentStatus = isInternalCompanyCreate
      ? 'paid'
      : isEnterpriseCompanyCreate
        ? String(templateSubscription.payment_status || 'paid')
        : 'trial'
    const subscriptionLimits = isInternalCompanyCreate
      ? INTERNAL_LIMITS
      : isEnterpriseCompanyCreate
        ? templateSubscription.limits || INTERNAL_LIMITS
        : STARTER_LIMITS

    const { data: company, error: companyError } = await supabase
      .from('companies')
      .insert({
        name,
        slug,
        trading_name: name,
        access_state: accessState,
        billing_exempt: isInternalCompanyCreate,
        billing_exempt_reason: isInternalCompanyCreate ? 'founder_lifetime' : null,
        internal_account: isInternalCompanyCreate,
        plan_key: planKey,
        billing_provider: billingProvider,
        subscription_status: subscriptionStatus,
        trial_started_at:
          isInternalCompanyCreate || isEnterpriseCompanyCreate
            ? templateSubscription.trial_started_at || null
            : now,
        trial_ends_at:
          isInternalCompanyCreate || isEnterpriseCompanyCreate
            ? templateSubscription.trial_ends_at || null
            : trialEndsAt,
        created_by_user_id: user.id,
      })
      .select('id, name, slug')
      .single()

    if (companyError) throw new Error(companyError.message)

    const companyId = company.id

    const { error: membershipError } = await supabase.from('company_memberships').insert({
      company_id: companyId,
      user_id: user.id,
      role: 'owner',
      status: 'active',
      permissions: {},
      joined_at: now,
    })
    if (membershipError) throw new Error(membershipError.message)

    await supabase.from('company_subscriptions').upsert(
      {
        company_id: companyId,
        provider: billingProvider,
        plan_key: planKey,
        status: subscriptionStatus,
        payment_status: paymentStatus,
        provider_customer_id: isEnterpriseCompanyCreate
          ? templateSubscription.provider_customer_id || null
          : null,
        provider_subscription_id: isEnterpriseCompanyCreate
          ? templateSubscription.provider_subscription_id || null
          : null,
        provider_price_id: isEnterpriseCompanyCreate ? templateSubscription.provider_price_id || null : null,
        current_period_start: isEnterpriseCompanyCreate
          ? templateSubscription.current_period_start || null
          : null,
        current_period_end: isEnterpriseCompanyCreate
          ? templateSubscription.current_period_end || null
          : null,
        trial_started_at:
          isInternalCompanyCreate || isEnterpriseCompanyCreate
            ? templateSubscription.trial_started_at || null
            : now,
        trial_ends_at:
          isInternalCompanyCreate || isEnterpriseCompanyCreate
            ? templateSubscription.trial_ends_at || null
            : trialEndsAt,
        limits: subscriptionLimits,
        metadata: {
          created_from: 'company_create_flow',
          internal_override: isInternalCompanyCreate,
          inherited_enterprise_subscription: isEnterpriseCompanyCreate,
        },
      },
      { onConflict: 'company_id,provider' }
    )

    await supabase.from('company_departments').upsert(
      {
        company_id: companyId,
        code: 'DEFAULT',
        name,
        department_type: 'internal',
        is_default: true,
        is_active: true,
      },
      { onConflict: 'company_id,code' }
    )

    await supabase.from('locations').upsert(
      DEFAULT_LOCATIONS.map((location) => ({
        company_id: companyId,
        ...location,
        is_active: location.code === 'LOCATION-1',
        updated_at: now,
      })),
      { onConflict: 'company_id,code' }
    )

    await supabase.from('integration_settings').upsert(
      INTEGRATION_CHANNELS.map((channel) => ({
        company_id: companyId,
        channel,
        enabled: false,
        auto_sync: false,
        connection_status: 'not_connected',
        settings: {},
        updated_at: now,
      })),
      { onConflict: 'company_id,channel' }
    )

    await supabase.from('user_company_preferences').upsert(
      {
        user_id: user.id,
        active_company_id: companyId,
        updated_at: now,
      },
      { onConflict: 'user_id' }
    )

    await supabase.from('company_audit_events').insert({
      company_id: companyId,
      actor_user_id: user.id,
      event_type: 'company.created',
      metadata: { name, slug },
    })

    return NextResponse.json({ ok: true, company })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'Could not create company.' },
      { status: 500 }
    )
  }
}

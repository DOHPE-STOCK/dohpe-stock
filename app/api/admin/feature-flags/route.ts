import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getCookiePairs(request: Request) {
  return (request.headers.get('cookie') || '')
    .split(';')
    .map((cookie) => cookie.trim())
    .filter(Boolean)
    .map((cookie) => {
      const separatorIndex = cookie.indexOf('=')
      return {
        name: separatorIndex === -1 ? cookie : cookie.slice(0, separatorIndex),
        value: separatorIndex === -1 ? '' : cookie.slice(separatorIndex + 1),
      }
    })
}

function getSupabaseAuth(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error('Missing Supabase auth environment variables.')
  }

  const cookies = getCookiePairs(request)

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookies
      },
      setAll() {},
    },
  })
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('Missing Supabase admin environment variables.')
  }

  return createClient(url, serviceKey)
}

async function getRequestUser(request: Request) {
  const supabaseAuth = getSupabaseAuth(request)
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser()

  return user
}

async function getPlatformAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from('platform_admin_users')
    .select('id, role, is_active')
    .or(`auth_user_id.eq.${userId},user_id.eq.${userId}`)
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw new Error(error.message)

  return data
}

export async function GET(request: Request) {
  try {
    const user = await getRequestUser(request)

    if (!user) {
      return NextResponse.json({ ok: false, message: 'Not logged in.' }, { status: 401 })
    }

    const supabase = getSupabaseAdmin()
    const admin = await getPlatformAdmin(supabase, user.id)

    if (!admin) {
      return NextResponse.json({
        ok: true,
        isAdmin: false,
        user: {
          id: user.id,
          email: user.email,
        },
      })
    }

    const [companyResult, featureResult, companyFeatureResult] = await Promise.all([
      supabase
        .from('companies')
        .select('id, name, slug, access_state, billing_exempt, internal_account')
        .order('name', { ascending: true }),
      supabase
        .from('feature_modules')
        .select('feature_key, name, description, category, is_active')
        .eq('is_active', true)
        .order('category', { ascending: true })
        .order('name', { ascending: true }),
      supabase
        .from('company_features')
        .select('id, company_id, feature_key, enabled'),
    ])

    if (companyResult.error || featureResult.error || companyFeatureResult.error) {
      throw new Error(
        companyResult.error?.message ||
          featureResult.error?.message ||
          companyFeatureResult.error?.message ||
          'Could not load admin settings.'
      )
    }

    return NextResponse.json({
      ok: true,
      isAdmin: true,
      admin,
      user: {
        id: user.id,
        email: user.email,
      },
      companies: companyResult.data || [],
      features: featureResult.data || [],
      companyFeatures: companyFeatureResult.data || [],
    })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'Unknown admin load error.' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const user = await getRequestUser(request)

    if (!user) {
      return NextResponse.json({ ok: false, message: 'Not logged in.' }, { status: 401 })
    }

    const supabase = getSupabaseAdmin()
    const admin = await getPlatformAdmin(supabase, user.id)

    if (!admin) {
      return NextResponse.json({ ok: false, message: 'No platform admin access.' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const companyId = String(body.company_id || '')
    const featureKey = String(body.feature_key || '')
    const enabled = body.enabled === true

    if (!companyId || !featureKey) {
      return NextResponse.json({ ok: false, message: 'Missing company or feature.' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('company_features')
      .upsert(
        {
          company_id: companyId,
          feature_key: featureKey,
          enabled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'company_id,feature_key' }
      )
      .select('id, company_id, feature_key, enabled')
      .single()

    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true, row: data })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'Unknown admin save error.' },
      { status: 500 }
    )
  }
}

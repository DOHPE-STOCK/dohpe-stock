import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

export type CompanyMembershipRole = 'owner' | 'admin' | 'manager' | 'member' | 'billing' | 'viewer'

export type ServerTenantUser = {
  id: string
  email?: string | null
}

export type ServerCompanyAccess = {
  ok: true
  user: ServerTenantUser
  membership: {
    company_id: string
    role: CompanyMembershipRole
    status: string
  }
  company: {
    id: string
    name: string
    slug: string
    access_state: string
    billing_exempt: boolean
    subscription_status?: string | null
  }
}

export type ServerCompanyAccessFailure = {
  ok: false
  status: number
  message: string
}

export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('Missing Supabase admin environment variables.')
  }

  return createClient(url, serviceKey)
}

export async function getServerUser(): Promise<ServerTenantUser | null> {
  const cookieStore = await cookies()

  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {},
      },
    }
  )

  const {
    data: { user },
    error,
  } = await supabaseAuth.auth.getUser()

  if (error || !user) return null

  return {
    id: user.id,
    email: user.email,
  }
}

export function getActiveCompanyIdFromRequest(request: Request) {
  const cookie = request.headers.get('cookie') || ''
  const match = cookie.match(/(?:^|;\s*)active_company_id=([^;]+)/)

  if (!match) return null

  try {
    const companyId = decodeURIComponent(match[1])
    return companyId && companyId !== 'single-company-fallback' ? companyId : null
  } catch {
    return null
  }
}

export async function requireCompanyAccess(
  request: Request,
  allowedRoles: CompanyMembershipRole[] = ['owner', 'admin', 'manager', 'member', 'billing', 'viewer']
): Promise<ServerCompanyAccess | ServerCompanyAccessFailure> {
  const user = await getServerUser()
  if (!user) return { ok: false, status: 401, message: 'Login required.' }

  const companyId = getActiveCompanyIdFromRequest(request)
  if (!companyId) return { ok: false, status: 400, message: 'No active company selected.' }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('company_memberships')
    .select(
      `company_id, role, status,
      company:companies(id, name, slug, access_state, billing_exempt, subscription_status)`
    )
    .eq('company_id', companyId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (error) return { ok: false, status: 500, message: error.message }

  const company = Array.isArray(data?.company) ? data?.company[0] : data?.company

  if (!data || !company) {
    return { ok: false, status: 403, message: 'You do not have access to this company.' }
  }

  const role = String(data.role || 'member') as CompanyMembershipRole
  if (!allowedRoles.includes(role)) {
    return { ok: false, status: 403, message: 'You do not have permission for this action.' }
  }

  return {
    ok: true,
    user,
    membership: {
      company_id: String(data.company_id),
      role,
      status: String(data.status || 'active'),
    },
    company: {
      id: String(company.id),
      name: String(company.name || company.slug || company.id),
      slug: String(company.slug || company.id),
      access_state: String(company.access_state || 'active'),
      billing_exempt: company.billing_exempt === true,
      subscription_status: company.subscription_status || null,
    },
  }
}

export function companyHasOperationalAccess(company: ServerCompanyAccess['company']) {
  if (company.billing_exempt) return true
  return ['active', 'trial'].includes(company.access_state)
}

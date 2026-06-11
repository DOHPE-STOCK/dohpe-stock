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

export async function GET(request: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!url || !anonKey || !serviceKey) {
      throw new Error('Missing Supabase environment variables.')
    }

    const cookies = getCookiePairs(request)
    const supabaseAuth = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return cookies
        },
        setAll() {},
      },
    })

    const {
      data: { user },
    } = await supabaseAuth.auth.getUser()

    if (!user) {
      return NextResponse.json({ ok: true, isAdmin: false })
    }

    const supabase = createClient(url, serviceKey)
    const { data, error } = await supabase
      .from('platform_admin_users')
      .select('id')
      .or(`auth_user_id.eq.${user.id},user_id.eq.${user.id}`)
      .eq('is_active', true)
      .maybeSingle()

    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true, isAdmin: Boolean(data) })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, isAdmin: false, message: error.message || 'Unknown admin status error.' },
      { status: 500 }
    )
  }
}

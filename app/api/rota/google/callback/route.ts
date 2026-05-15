import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { getGoogleOAuthClient } from '@/lib/googleCalendar'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get('code')
    let userId = request.nextUrl.searchParams.get('state')

    if (!code) {
      return NextResponse.redirect(
        new URL('/rota/calendar?calendarError=missing_code', request.url)
      )
    }

    if (!userId) {
      const response = NextResponse.next()

      const supabaseCookieClient = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() {
              return request.cookies.getAll()
            },
            setAll(cookiesToSet) {
              cookiesToSet.forEach(({ name, value, options }) => {
                response.cookies.set(name, value, options)
              })
            },
          },
        }
      )

      const {
        data: { user },
      } = await supabaseCookieClient.auth.getUser()

      userId = user?.id || null
    }

    if (!userId) {
      return NextResponse.redirect(
        new URL('/rota/calendar?calendarError=missing_user', request.url)
      )
    }

    const oauth2Client = getGoogleOAuthClient()
    const { tokens } = await oauth2Client.getToken(code)

    oauth2Client.setCredentials(tokens)

    const oauth2 = google.oauth2({
      auth: oauth2Client,
      version: 'v2',
    })

    const me = await oauth2.userinfo.get()
    const googleEmail = me.data.email || ''

    const { data: existingToken } = await supabaseAdmin
      .from('rota_google_tokens')
      .select('refresh_token')
      .eq('user_id', userId)
      .maybeSingle()

    const refreshToken = tokens.refresh_token || existingToken?.refresh_token || null

    if (!refreshToken) {
      return NextResponse.redirect(
        new URL('/rota/calendar?calendarError=missing_refresh_token', request.url)
      )
    }

    const { error } = await supabaseAdmin.from('rota_google_tokens').upsert(
      {
        user_id: userId,
        google_email: googleEmail,
        access_token: tokens.access_token || null,
        refresh_token: refreshToken,
        expires_at: tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : null,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'user_id',
      }
    )

    if (error) {
      console.error('GOOGLE_TOKEN_SAVE_ERROR', error)
      return NextResponse.redirect(
        new URL('/rota/calendar?calendarError=token_save_failed', request.url)
      )
    }

    return NextResponse.redirect(new URL('/rota/calendar', request.url))
  } catch (error) {
    console.error('GOOGLE_CALLBACK_ERROR', error)

    return NextResponse.redirect(
      new URL('/rota/calendar?calendarError=callback_failed', request.url)
    )
  }
}
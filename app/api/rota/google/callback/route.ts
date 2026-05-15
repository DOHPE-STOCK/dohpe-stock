import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { getGoogleOAuthClient } from '@/lib/googleCalendar'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)

    const code = searchParams.get('code')
    const state = searchParams.get('state')

    if (!code) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/rota/calendar?error=no_code`
      )
    }

    const oauth2Client = getGoogleOAuthClient()

    const { tokens } = await oauth2Client.getToken(code)

    oauth2Client.setCredentials(tokens)

    const oauth2 = google.oauth2({
      auth: oauth2Client,
      version: 'v2',
    })

    const googleUser = await oauth2.userinfo.get()

    const email = googleUser.data.email

    if (!email) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/rota/calendar?error=no_email`
      )
    }

    const accessToken = tokens.access_token || ''
    const refreshToken = tokens.refresh_token || ''

    if (!refreshToken) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/rota/calendar?error=no_refresh_token`
      )
    }

    const {
      data: { users },
    } = await supabaseAdmin.auth.admin.listUsers()

    const matchedUser = users.find(
      (user) => user.email?.toLowerCase() === email.toLowerCase()
    )

    if (!matchedUser) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/rota/calendar?error=user_not_found`
      )
    }

    await supabaseAdmin.from('rota_google_tokens').upsert({
      user_id: matchedUser.id,
      email,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    })

    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL}/rota/calendar?connected=1`
    )
  } catch (error: any) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL}/rota/calendar?error=${encodeURIComponent(
        error.message || 'callback_failed'
      )}`
    )
  }
}
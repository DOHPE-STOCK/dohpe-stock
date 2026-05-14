import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { getGoogleOAuthClient } from '@/lib/googleCalendar'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get('code')
    const userId = request.nextUrl.searchParams.get('state')

    if (!code) {
      return NextResponse.json({ error: 'Missing code' }, { status: 400 })
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'Missing Supabase user state' },
        { status: 400 }
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
    const googleEmail = me.data.email

    await supabase.from('rota_google_tokens').upsert(
      {
        user_id: userId,
        google_email: googleEmail,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : null,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'user_id',
      }
    )

    return NextResponse.redirect(new URL('/rota/calendar', request.url))
  } catch (error) {
    console.error(error)

    return NextResponse.json(
      { error: 'Google auth failed' },
      { status: 500 }
    )
  }
}
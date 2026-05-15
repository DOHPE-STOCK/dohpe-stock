import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getGoogleOAuthClient } from '@/lib/googleCalendar'

export const dynamic = 'force-dynamic'

type GoogleEvent = {
  id: string
  summary?: string
  start?: {
    date?: string
    dateTime?: string
  }
  end?: {
    date?: string
    dateTime?: string
  }
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getGoogleTokenFromSupabaseUser(supabaseAccessToken: string) {
  const supabaseUserClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${supabaseAccessToken}`,
        },
      },
    }
  )

  const {
    data: { user },
    error: userError,
  } = await supabaseUserClient.auth.getUser()

  if (userError || !user) {
    throw new Error('Supabase user not found.')
  }

  const { data: tokenRow, error: tokenError } = await supabaseAdmin
    .from('rota_google_tokens')
    .select('google_email, access_token, refresh_token, expires_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (tokenError) throw tokenError
  if (!tokenRow?.access_token && !tokenRow?.refresh_token) {
    throw new Error('Google Calendar not connected.')
  }

  const oauth2Client = getGoogleOAuthClient()

  oauth2Client.setCredentials({
    access_token: tokenRow.access_token || undefined,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date: tokenRow.expires_at ? new Date(tokenRow.expires_at).getTime() : undefined,
  })

  const accessTokenResponse = await oauth2Client.getAccessToken()
  const googleAccessToken = accessTokenResponse.token

  if (!googleAccessToken) {
    throw new Error('Could not refresh Google access token.')
  }

  const credentials = oauth2Client.credentials

  await supabaseAdmin
    .from('rota_google_tokens')
    .update({
      access_token: credentials.access_token || googleAccessToken,
      expires_at: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : tokenRow.expires_at,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)

  return {
    googleAccessToken,
    googleEmail: tokenRow.google_email || '',
  }
}

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const supabaseAccessToken = authHeader.replace('Bearer ', '').trim()

    if (!supabaseAccessToken) {
      return NextResponse.json(
        { ok: false, message: 'Missing Supabase token.' },
        { status: 401 }
      )
    }

    const { googleAccessToken, googleEmail } = await getGoogleTokenFromSupabaseUser(supabaseAccessToken)

    const calendarResponse = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=2500',
      {
        headers: {
          Authorization: `Bearer ${googleAccessToken}`,
        },
      }
    )

    const calendarData = await calendarResponse.json().catch(() => null)

    if (!calendarResponse.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: 'Google Calendar events fetch failed.',
          googleData: calendarData,
        },
        { status: calendarResponse.status }
      )
    }

    const events = Array.isArray(calendarData?.items)
      ? calendarData.items.map((event: GoogleEvent) => ({
          id: event.id,
          title: event.summary || 'Busy',
          start: event.start?.dateTime || event.start?.date || '',
          end: event.end?.dateTime || event.end?.date || '',
        }))
      : []

    return NextResponse.json({
      ok: true,
      email: googleEmail,
      events,
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        message: error.message || 'Google Calendar events fetch failed.',
      },
      { status: 500 }
    )
  }
}
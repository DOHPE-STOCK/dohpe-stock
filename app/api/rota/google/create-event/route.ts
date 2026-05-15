import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getGoogleOAuthClient } from '@/lib/googleCalendar'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function addDaysToDateString(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)

  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')

  return `${yyyy}-${mm}-${dd}`
}

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
    .select('access_token, refresh_token, expires_at')
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

  return googleAccessToken
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const supabaseAccessToken = authHeader.replace('Bearer ', '').trim()

    if (!supabaseAccessToken) {
      return NextResponse.json(
        { ok: false, message: 'Missing Supabase token.' },
        { status: 401 }
      )
    }

    const body = await request.json()

    const title = String(body.title || '').trim()
    const startDate = String(body.startDate || '')
    const endDate = String(body.endDate || '')

    if (!title || !startDate || !endDate) {
      return NextResponse.json(
        { ok: false, message: 'Missing title, start date, or end date.' },
        { status: 400 }
      )
    }

    const googleAccessToken = await getGoogleTokenFromSupabaseUser(supabaseAccessToken)

    const googlePayload = {
      summary: title,
      start: {
        date: startDate,
      },
      end: {
        date: addDaysToDateString(endDate, 1),
      },
    }

    const googleResponse = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${googleAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(googlePayload),
      }
    )

    const googleData = await googleResponse.json().catch(() => null)

    if (!googleResponse.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: 'Google Calendar create failed.',
          googleData,
        },
        { status: googleResponse.status }
      )
    }

    return NextResponse.json({
      ok: true,
      event: googleData,
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        message: error.message || 'Create calendar entry failed.',
      },
      { status: 500 }
    )
  }
}
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

function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const supabaseToken = authHeader.replace('Bearer ', '').trim()

    if (!supabaseToken) {
      return NextResponse.json(
        { ok: false, message: 'Missing Supabase token.' },
        { status: 401 }
      )
    }

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(supabaseToken)

    if (userError || !user) {
      return NextResponse.json(
        { ok: false, message: 'Invalid Supabase user token.' },
        { status: 401 }
      )
    }

    const body = await request.json()

    const title = String(body.title || '').trim()
    const startDate = String(body.startDate || '')
    const endDate = String(body.endDate || '')
    const allDay = body.allDay !== false
    const startTime = String(body.startTime || '09:00')
    const endTime = String(body.endTime || '10:00')

    if (!title || !isValidDate(startDate) || !isValidDate(endDate)) {
      return NextResponse.json(
        { ok: false, message: 'Missing or invalid title, start date, or end date.' },
        { status: 400 }
      )
    }

    if (endDate < startDate) {
      return NextResponse.json(
        { ok: false, message: 'End date cannot be before start date.' },
        { status: 400 }
      )
    }

    const { data: tokenRow, error: tokenError } = await supabaseAdmin
      .from('rota_google_tokens')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', user.id)
      .maybeSingle()

    if (tokenError || !tokenRow?.refresh_token) {
      return NextResponse.json(
        { ok: false, message: 'Google Calendar is not connected. Reconnect Google Calendar.' },
        { status: 401 }
      )
    }

    const oauth2Client = getGoogleOAuthClient()

    oauth2Client.setCredentials({
      access_token: tokenRow.access_token || undefined,
      refresh_token: tokenRow.refresh_token,
      expiry_date: tokenRow.expires_at ? new Date(tokenRow.expires_at).getTime() : undefined,
    })

    const { credentials } = await oauth2Client.refreshAccessToken()
    const googleAccessToken = credentials.access_token

    if (!googleAccessToken) {
      return NextResponse.json(
        { ok: false, message: 'Could not refresh Google Calendar token.' },
        { status: 401 }
      )
    }

    await supabaseAdmin
      .from('rota_google_tokens')
      .update({
        access_token: googleAccessToken,
        expires_at: credentials.expiry_date
          ? new Date(credentials.expiry_date).toISOString()
          : null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)

    const googlePayload = allDay
      ? {
          summary: title,
          start: { date: startDate },
          end: { date: addDaysToDateString(endDate, 1) },
        }
      : {
          summary: title,
          start: {
            dateTime: `${startDate}T${startTime}:00`,
            timeZone: 'Europe/London',
          },
          end: {
            dateTime: `${endDate}T${endTime}:00`,
            timeZone: 'Europe/London',
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
          message: googleData?.error?.message || 'Google Calendar create failed.',
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
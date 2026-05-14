import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { getGoogleOAuthClient } from '@/lib/googleCalendar'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  try {
    const accessToken = request.cookies.get('sb-access-token')?.value

    if (!accessToken) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    const {
      data: { user },
    } = await supabase.auth.getUser(accessToken)

    if (!user) {
      return NextResponse.json(
        { error: 'No user' },
        { status: 401 }
      )
    }

    const { data: tokenRow, error } = await supabase
      .from('rota_google_tokens')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (error || !tokenRow) {
      return NextResponse.json(
        { error: 'Google calendar not connected' },
        { status: 404 }
      )
    }

    const oauth2Client = getGoogleOAuthClient()

    oauth2Client.setCredentials({
      access_token: tokenRow.access_token,
      refresh_token: tokenRow.refresh_token,
    })

    const calendar = google.calendar({
      version: 'v3',
      auth: oauth2Client,
    })

    const now = new Date()

    const future = new Date()
    future.setDate(future.getDate() + 35)

    const response = await calendar.events.list({
      calendarId: 'primary',
      singleEvents: true,
      orderBy: 'startTime',
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      maxResults: 250,
    })

    const events =
      response.data.items?.map((event) => ({
        id: event.id,
        title: event.summary || 'Busy',
        start:
          event.start?.dateTime || event.start?.date || '',
        end:
          event.end?.dateTime || event.end?.date || '',
      })) || []

    return NextResponse.json({
      ok: true,
      events,
      email: tokenRow.google_email,
    })
  } catch (error) {
    console.error(error)

    return NextResponse.json(
      { error: 'Failed to load events' },
      { status: 500 }
    )
  }
}
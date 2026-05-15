import { NextResponse } from 'next/server'

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

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const googleToken = authHeader.replace('Bearer ', '').trim()

    if (!googleToken) {
      return NextResponse.json(
        { ok: false, message: 'Missing Google token.' },
        { status: 401 }
      )
    }

    const calendarResponse = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=2500',
      {
        headers: {
          Authorization: `Bearer ${googleToken}`,
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

    const profileResponse = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: {
          Authorization: `Bearer ${googleToken}`,
        },
      }
    )

    const profileData = await profileResponse.json().catch(() => null)

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
      email: profileData?.email || '',
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
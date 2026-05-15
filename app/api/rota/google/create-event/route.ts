import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const accessToken = authHeader.replace('Bearer ', '').trim()

    if (!accessToken) {
      return NextResponse.json(
        { ok: false, message: 'Missing auth token.' },
        { status: 401 }
      )
    }

    const body = await request.json()

    const title = String(body.title || '').trim()
    const start = String(body.start || '')
    const end = String(body.end || '')
    const allDay = Boolean(body.allDay)

    if (!title || !start || !end) {
      return NextResponse.json(
        { ok: false, message: 'Missing event fields.' },
        { status: 400 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    })

    const {
      data: { session },
    } = await supabase.auth.getSession()

    const providerToken = session?.provider_token

    if (!providerToken) {
      return NextResponse.json(
        { ok: false, message: 'Missing Google provider token.' },
        { status: 401 }
      )
    }

    const eventPayload = allDay
      ? {
          summary: title,
          start: {
            date: start,
          },
          end: {
            date: end,
          },
        }
      : {
          summary: title,
          start: {
            dateTime: start,
            timeZone: 'Europe/London',
          },
          end: {
            dateTime: end,
            timeZone: 'Europe/London',
          },
        }

    const googleResponse = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${providerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventPayload),
      }
    )

    const googleData = await googleResponse.json()

    if (!googleResponse.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: 'Google Calendar create failed.',
          googleData,
        },
        { status: 500 }
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
        message: error.message || 'Create event failed.',
      },
      { status: 500 }
    )
  }
}

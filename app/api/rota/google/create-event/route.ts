import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function addDaysToDateString(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)

  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')

  return `${yyyy}-${mm}-${dd}`
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const googleToken = authHeader.replace('Bearer ', '').trim()

    if (!googleToken) {
      return NextResponse.json(
        { ok: false, message: 'Missing Google token.' },
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
          Authorization: `Bearer ${googleToken}`,
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
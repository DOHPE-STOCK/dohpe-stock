import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getGoogleOAuthClient } from '@/lib/googleCalendar'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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
    const eventId = String(body.eventId || '').trim()

    if (!eventId) {
      return NextResponse.json(
        { ok: false, message: 'Missing event id.' },
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

    const googleResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${googleAccessToken}`,
        },
      }
    )

    if (!googleResponse.ok) {
      const googleData = await googleResponse.json().catch(() => null)

      return NextResponse.json(
        {
          ok: false,
          message: googleData?.error?.message || 'Google Calendar delete failed.',
          googleData,
        },
        { status: googleResponse.status }
      )
    }

    return NextResponse.json({ ok: true, deleted: true, eventId })
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        message: error.message || 'Delete calendar entry failed.',
      },
      { status: 500 }
    )
  }
}

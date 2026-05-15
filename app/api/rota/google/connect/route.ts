import { NextResponse } from 'next/server'
import { getGoogleOAuthClient } from '@/lib/googleCalendar'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const oauth2Client = getGoogleOAuthClient()

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/calendar',
      ],
    })

    return NextResponse.redirect(url)
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        message: error.message || 'Google connect failed.',
      },
      { status: 500 }
    )
  }
}
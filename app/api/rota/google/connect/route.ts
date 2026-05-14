import { NextResponse } from 'next/server'
import { getGoogleOAuthClient } from '@/lib/googleCalendar'

export async function GET() {
  const oauth2Client = getGoogleOAuthClient()

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  })

  return NextResponse.redirect(url)
}
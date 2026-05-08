import { NextResponse } from 'next/server'

export async function GET() {
  const applicationId = process.env.LINNWORKS_APP_ID
  const applicationSecret = process.env.LINNWORKS_APP_SECRET
  const token = process.env.LINNWORKS_APP_TOKEN

  if (!applicationId || !applicationSecret || !token) {
    return NextResponse.json(
      {
        ok: false,
        message: 'Missing Linnworks environment variables.',
        missing: {
          LINNWORKS_APP_ID: !applicationId,
          LINNWORKS_APP_SECRET: !applicationSecret,
          LINNWORKS_APP_TOKEN: !token,
        },
      },
      { status: 500 }
    )
  }

  const response = await fetch(
    'https://api.linnworks.net/api/Auth/AuthorizeByApplication',
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ApplicationId: applicationId,
        ApplicationSecret: applicationSecret,
        Token: token,
      }),
    }
  )

  const text = await response.text()

  let data: any = null

  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }

  if (!response.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: 'Linnworks auth failed.',
        status: response.status,
        details: data,
      },
      { status: response.status }
    )
  }

  return NextResponse.json({
    ok: true,
    message: 'Linnworks connection successful.',
    server: data?.Server || null,
    token_received: Boolean(data?.Token),
  })
}
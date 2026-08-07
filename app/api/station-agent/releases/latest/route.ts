import { NextRequest, NextResponse } from 'next/server'

const STATION_AGENT_VERSION = '0.3.21'

function baseUrl(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  if (configured) return configured
  return request.nextUrl.origin
}

export async function GET(request: NextRequest) {
  const origin = baseUrl(request)
  const configuredDownload =
    process.env.STATION_AGENT_DOWNLOAD_URL ||
    process.env.NEXT_PUBLIC_STATION_AGENT_DOWNLOAD_URL ||
    ''
  const downloadUrl = configuredDownload || `${origin}/api/station-agent/download?v=${STATION_AGENT_VERSION}`

  return NextResponse.json({
    ok: true,
    name: 'Loopbase Station Agent',
    version: STATION_AGENT_VERSION,
    download_url: downloadUrl,
    manifest_url: `${origin}/api/station-agent/releases/latest`,
    min_supported_app_version: '0.1.0',
    published_at: '2026-08-07',
    release_notes: [
      'Verifies the in-app updater against the binary Loopbase download API route.',
      'Forces the Station Agent download route to run as a Node binary response.',
      'Keeps the installer filename as a Windows .exe for update downloads.',
    ],
  })
}

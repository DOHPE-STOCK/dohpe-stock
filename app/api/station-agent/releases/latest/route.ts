import { NextRequest, NextResponse } from 'next/server'

const STATION_AGENT_VERSION = '0.3.23'

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
      'Simplifies Photography Stations so sources only require watch folders.',
      'Keeps photo source tokens and internal processing folders managed automatically.',
      'Installs updates automatically, keeps settings, and reopens Loopbase after updating.',
    ],
  })
}

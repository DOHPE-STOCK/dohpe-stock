import { NextRequest, NextResponse } from 'next/server'

const STATION_AGENT_VERSION = '0.3.33'

function baseUrl(request: NextRequest) {
  // Use the request origin for desktop updates so a stale NEXT_PUBLIC_APP_URL
  // cannot point installed agents at localhost or an old deployment.
  return request.nextUrl.origin
}

export async function GET(request: NextRequest) {
  const origin = baseUrl(request)
  const downloadUrl = `${origin}/api/station-agent/download?v=${STATION_AGENT_VERSION}`

  return NextResponse.json({
    ok: true,
    name: 'Loopbase Station Agent',
    version: STATION_AGENT_VERSION,
    download_url: downloadUrl,
    manifest_url: `${origin}/api/station-agent/releases/latest`,
    min_supported_app_version: '0.1.0',
    published_at: '2026-08-07',
    release_notes: [
      'Restores the working binary update download route used by earlier successful in-app updates.',
      'Keeps the Remote Printer picker for saving multiple local Windows printers.',
      'Keeps the Station Agent UI unchanged.',
    ],
  })
}

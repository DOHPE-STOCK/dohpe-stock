import { NextRequest, NextResponse } from 'next/server'

const STATION_AGENT_VERSION = '0.3.35'

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
    published_at: '2026-08-08',
    release_notes: [
      'Fixes bundled helper launch so the photo ingest worker runs inside packaged Windows builds.',
      'Automatically starts and restarts the photo ingest worker after watched folder changes.',
      'Keeps watched folder uploads active after saving photography station settings.',
    ],
  })
}

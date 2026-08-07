import { NextRequest, NextResponse } from 'next/server'

const STATION_AGENT_VERSION = '0.3.5'

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
  const downloadUrl =
    configuredDownload ||
    `${origin}/api/station-agent/download`

  return NextResponse.json({
    ok: true,
    name: 'Loopbase Station Agent',
    version: STATION_AGENT_VERSION,
    download_url: downloadUrl,
    manifest_url: `${origin}/api/station-agent/releases/latest`,
    min_supported_app_version: '0.1.0',
    published_at: '2026-08-07',
    release_notes: [
      'Adds proper local printer selection so a station can expose chosen Windows printers to Loopbase.',
      'Keeps manual network TCP/ZPL printer setup for label printers on the local network.',
      'Changes Update Now to download and launch the hosted installer while preserving station settings.',
      'Keeps the hosted installer URL as a visible fallback if Windows blocks automatic launch.',
    ],
  })
}

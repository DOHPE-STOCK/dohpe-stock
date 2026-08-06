import { NextRequest, NextResponse } from 'next/server'

const STATION_AGENT_VERSION = '0.2.1'

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
    published_at: '2026-08-05',
    release_notes: [
      'Adds the Windows desktop Station Agent app shell.',
      'Launches the local Loopbase hardware helper without a separate browser tab.',
      'Adds Remote Printer, Photography Station, File Watcher, RFID reader/writer and RFID Zone Monitor sections.',
      'Supports local Windows printer discovery and remote print-job polling.',
      'Checks Loopbase for future station-agent updates while running.',
    ],
  })
}

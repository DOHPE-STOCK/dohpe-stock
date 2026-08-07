import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'node:fs'
import path from 'node:path'

const STATION_AGENT_VERSION = '0.3.14'
const INSTALLER_PATH = '/downloads/loopbase-station-agent/Loopbase-Station-Agent-Setup.exe'

function baseUrl(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  if (configured) return configured
  return request.nextUrl.origin
}

export async function GET(request: NextRequest) {
  const origin = baseUrl(request)
  const bundledInstaller = path.join(
    process.cwd(),
    'public',
    'downloads',
    'loopbase-station-agent',
    'Loopbase-Station-Agent-Setup.exe',
  )
  const configuredDownload =
    process.env.STATION_AGENT_DOWNLOAD_URL ||
    process.env.NEXT_PUBLIC_STATION_AGENT_DOWNLOAD_URL ||
    ''
  const downloadUrl =
    existsSync(bundledInstaller)
      ? `${origin}${INSTALLER_PATH}?v=${STATION_AGENT_VERSION}`
      : configuredDownload ||
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
      'Makes the six Station Agent cards open full section views.',
      'Adds an Updates section with check and update actions inside the app.',
      'Removes the fake traffic lights and title text from the top bar.',
    ],
  })
}

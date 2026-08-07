import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'node:fs'
import path from 'node:path'

const STATION_AGENT_VERSION = '0.3.19'
const INSTALLER_PATH = '/downloads/loopbase-station-agent/Loopbase-Station-Agent-Setup.exe'
const UPDATER_INSTALLER_PATH = '/downloads/loopbase-station-agent/Loopbase-Station-Agent-Setup.download'

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
  const bundledUpdaterInstaller = path.join(
    process.cwd(),
    'public',
    'downloads',
    'loopbase-station-agent',
    'Loopbase-Station-Agent-Setup.download',
  )
  const configuredDownload =
    process.env.STATION_AGENT_DOWNLOAD_URL ||
    process.env.NEXT_PUBLIC_STATION_AGENT_DOWNLOAD_URL ||
    ''
  const downloadUrl =
    existsSync(bundledUpdaterInstaller)
      ? `${origin}${UPDATER_INSTALLER_PATH}?v=${STATION_AGENT_VERSION}` :
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
      'Automatically links photography watch folders to the connected station token.',
      'Removes manual photo source token entry from the Station Agent desktop flow.',
      'Keeps the neutral installer download used by the in-app updater.',
    ],
  })
}

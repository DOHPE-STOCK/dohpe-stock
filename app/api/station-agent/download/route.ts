import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'fs'
import path from 'path'

export async function GET(request: NextRequest) {
  const configuredDownload =
    process.env.STATION_AGENT_DOWNLOAD_URL ||
    process.env.NEXT_PUBLIC_STATION_AGENT_DOWNLOAD_URL ||
    ''
  if (configuredDownload) {
    return NextResponse.redirect(configuredDownload)
  }

  const downloads = [
    {
      relativePath: '/downloads/loopbase-station-agent/Loopbase-Station-Agent-Setup.exe',
      fileName: 'Loopbase-Station-Agent-Setup.exe',
    },
    {
      relativePath: '/downloads/loopbase-station-agent/Loopbase-Station-Agent.exe',
      fileName: 'Loopbase-Station-Agent.exe',
    },
  ]

  for (const download of downloads) {
    const staticPath = path.join(process.cwd(), 'public', 'downloads', 'loopbase-station-agent', download.fileName)
    if (existsSync(staticPath)) {
      return NextResponse.redirect(new URL(download.relativePath, request.nextUrl.origin))
    }
  }

  return new NextResponse(
    `<!doctype html><html><head><title>Loopbase Station Agent</title></head><body style="font-family:system-ui;margin:40px;max-width:720px"><h1>Station Agent download is not published yet</h1><p>The release endpoint is configured, but the Windows installer has not been uploaded to this deployment yet.</p><p>Build it with <code>tools\\loopbase-station-desktop\\build-desktop.cmd</code>, or set <code>STATION_AGENT_DOWNLOAD_URL</code> to a hosted installer URL.</p></body></html>`,
    {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    },
  )
}

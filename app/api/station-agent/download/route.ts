import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import path from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
      fileName: 'Loopbase-Station-Agent-Setup.exe',
    },
    {
      fileName: 'Loopbase-Station-Agent.exe',
    },
  ]

  for (const download of downloads) {
    const staticPath = path.join(process.cwd(), 'public', 'downloads', 'loopbase-station-agent', download.fileName)
    if (existsSync(staticPath)) {
      const file = await readFile(staticPath)
      return new NextResponse(file, {
        status: 200,
        headers: {
          'content-type': 'application/vnd.microsoft.portable-executable',
          'content-disposition': `attachment; filename="${download.fileName}"`,
          'content-length': String(file.length),
          'cache-control': 'no-store, max-age=0',
          'x-content-type-options': 'nosniff',
        },
      })
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

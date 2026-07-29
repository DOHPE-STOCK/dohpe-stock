import { NextRequest, NextResponse } from 'next/server'
import {
  companyHasOperationalAccess,
  getSupabaseAdmin,
  requireCompanyAccess,
} from '@/lib/serverTenant'
import { cleanupPhotoPreviewRepresentations } from '@/lib/photoPreviewCleanup'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function failure(status: number, message: string) {
  return NextResponse.json({ ok: false, message }, { status })
}

function text(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function authorisedCron(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  return Boolean(process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`)
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map(text).filter(Boolean)
}

export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdmin()
  const body = await request.json().catch(() => ({}))
  const cron = authorisedCron(request)

  if (cron) {
    const olderThanHours = Number(body.older_than_hours || body.olderThanHours || 24)
    const cleanup = await cleanupPhotoPreviewRepresentations({
      supabase,
      companyId: text(body.company_id || body.companyId) || null,
      olderThanHours: Number.isFinite(olderThanHours) ? Math.max(1, olderThanHours) : 24,
      limit: 1000,
    })

    return NextResponse.json({ ok: cleanup.failed_count === 0, cleanup })
  }

  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member'])
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) {
    return failure(402, 'Company subscription is not active.')
  }

  const sessionId = text(body.session_id || body.sessionId)
  const captureIds = stringArray(body.capture_ids || body.captureIds)

  if (!sessionId && captureIds.length === 0) {
    return failure(400, 'Session or captures are required.')
  }

  const cleanup = await cleanupPhotoPreviewRepresentations({
    supabase,
    companyId: access.company.id,
    sessionId,
    captureIds,
    limit: 500,
  })

  return NextResponse.json({ ok: cleanup.failed_count === 0, cleanup })
}

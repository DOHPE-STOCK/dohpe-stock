import { NextResponse } from 'next/server'
import {
  companyHasOperationalAccess,
  getSupabaseAdmin,
  requireCompanyAccess,
} from '@/lib/serverTenant'
import { designatePhotoMeasurementSource } from '@/lib/photographyServer'

function failure(status: number, message: string) {
  return NextResponse.json({ ok: false, message }, { status })
}

function text(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

export async function POST(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member'])
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) {
    return failure(402, 'Company subscription is not active.')
  }

  const body = await request.json().catch(() => ({}))
  const itemImageId = text(body.item_image_id || body.itemImageId)
  const itemId = text(body.item_id || body.itemId)
  const originalFilename = text(body.original_filename || body.originalFilename) || null

  if (!itemImageId) return failure(400, 'Item image is required.')
  if (!itemId) return failure(400, 'Item is required.')

  const supabase = getSupabaseAdmin()

  const { data: itemImage, error: imageError } = await supabase
    .from('item_images')
    .select('id, item_id, company_id')
    .eq('id', itemImageId)
    .eq('item_id', itemId)
    .eq('company_id', access.company.id)
    .maybeSingle()

  if (imageError) return failure(500, imageError.message)
  if (!itemImage) return failure(404, 'Image not found for active company.')

  const { data: activeSessions, error: sessionError } = await supabase
    .from('photo_sessions')
    .select('id, station_id, item_id, started_at')
    .eq('company_id', access.company.id)
    .eq('item_id', itemId)
    .eq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(2)

  if (sessionError) return failure(500, sessionError.message)

  if (!activeSessions || activeSessions.length === 0) {
    return NextResponse.json({
      ok: true,
      attached: false,
      reason: 'no_active_session',
    })
  }

  if (activeSessions.length > 1) {
    return NextResponse.json({
      ok: true,
      attached: false,
      reason: 'multiple_active_sessions_for_item',
    })
  }

  const session = activeSessions[0]

  const { data: capture, error: captureError } = await supabase
    .from('photo_captures')
    .upsert(
      {
        company_id: access.company.id,
        station_id: session.station_id,
        session_id: session.id,
        item_id: itemId,
        item_image_id: itemImageId,
        capture_status: 'assigned',
        assignment_method: 'explicit_session',
        original_filename: originalFilename,
        received_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,item_image_id' }
    )
    .select('*')
    .single()

  if (captureError) return failure(500, captureError.message)

  await designatePhotoMeasurementSource({
    supabase,
    companyId: access.company.id,
    sessionId: session.id,
    captureId: capture.id,
  })

  await supabase
    .from('photography_stations')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('company_id', access.company.id)
    .eq('id', session.station_id)

  return NextResponse.json({
    ok: true,
    attached: true,
    capture,
  })
}

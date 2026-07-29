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
    .select('id, item_id, company_id, original_url, processed_url')
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
  const publicUrl = text(itemImage.original_url || itemImage.processed_url)

  const { data: source, error: sourceError } = await supabase
    .from('photo_sources')
    .select('id, source_type')
    .eq('company_id', access.company.id)
    .eq('station_id', session.station_id)
    .eq('enabled', true)
    .is('token_revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (sourceError) return failure(500, sourceError.message)

  const preferredSource = source?.source_type === 'phone'
    ? await supabase
        .from('photo_sources')
        .select('id')
        .eq('company_id', access.company.id)
        .eq('station_id', session.station_id)
        .eq('source_type', 'watched_folder')
        .eq('enabled', true)
        .is('token_revoked_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: source, error: null }

  if (preferredSource.error) return failure(500, preferredSource.error.message)

  const capturePayload = {
    company_id: access.company.id,
    station_id: session.station_id,
    source_id: preferredSource.data?.id || source?.id || null,
    session_id: session.id,
    item_id: itemId,
    item_image_id: itemImageId,
    capture_status: 'assigned',
    assignment_method: 'explicit_session',
    original_filename: originalFilename,
    exif: {
      manual_upload: true,
      public_url: publicUrl || null,
      original_url: itemImage.original_url || null,
      processed_url: itemImage.processed_url || null,
    },
    received_at: new Date().toISOString(),
  }

  const { data: existingCapture, error: existingCaptureError } = await supabase
    .from('photo_captures')
    .select('id')
    .eq('company_id', access.company.id)
    .eq('session_id', session.id)
    .eq('item_image_id', itemImageId)
    .maybeSingle()

  if (existingCaptureError) return failure(500, existingCaptureError.message)

  const captureQuery = existingCapture?.id
    ? supabase
        .from('photo_captures')
        .update(capturePayload)
        .eq('company_id', access.company.id)
        .eq('id', existingCapture.id)
        .select('*')
        .single()
    : supabase
        .from('photo_captures')
        .insert(capturePayload)
        .select('*')
        .single()

  const { data: capture, error: captureError } = await captureQuery

  if (captureError) return failure(500, captureError.message)

  await supabase
    .from('photo_capture_representations')
    .update({
      session_id: session.id,
      item_id: itemId,
      source_id: capture.source_id || preferredSource.data?.id || source?.id || null,
    })
    .eq('company_id', access.company.id)
    .eq('capture_id', capture.id)

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

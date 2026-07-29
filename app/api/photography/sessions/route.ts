import { NextResponse } from 'next/server'
import {
  companyHasOperationalAccess,
  getSupabaseAdmin,
  requireCompanyAccess,
} from '@/lib/serverTenant'
import { loadCompanyPhotoSettings, originalDeleteAfterFrom } from '@/lib/photoRetention'
import { startPhotoSessionForItem, type PhotoStartMethod } from '@/lib/photographyServer'
import { cleanupPhotoPreviewRepresentations } from '@/lib/photoPreviewCleanup'

function failure(status: number, message: string) {
  return NextResponse.json({ ok: false, message }, { status })
}

function text(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

const channelStatusFields = [
  'linnworks_status',
  'ebay_status',
  'shopify_status',
  'square_status',
  'grailed_status',
  'vestiaire_collective_status',
  'whatnot_status',
  'vinted_status',
  'depop_status',
  'tiktok_shop_status',
]

const liveChannelStatuses = new Set(['synced', 'active', 'listed', 'pending_update', 'failed'])

async function markItemChannelUpdatesPending(supabase: any, companyId: string, itemId: string | null | undefined) {
  if (!itemId) return

  const { data: item } = await supabase
    .from('items')
    .select(channelStatusFields.join(','))
    .eq('company_id', companyId)
    .eq('id', itemId)
    .maybeSingle()

  if (!item) return

  const updates = channelStatusFields.reduce((next: Record<string, string>, field) => {
    if (liveChannelStatuses.has(text(item[field]).toLowerCase())) {
      next[field] = 'pending_update'
    }
    return next
  }, {})

  if (Object.keys(updates).length === 0) return

  await supabase
    .from('items')
    .update(updates)
    .eq('company_id', companyId)
    .eq('id', itemId)
}

export async function POST(request: Request) {
  try {
    const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member'])
    if (!access.ok) return failure(access.status, access.message)
    if (!companyHasOperationalAccess(access.company)) {
      return failure(402, 'Company subscription is not active.')
    }

    const body = await request.json().catch(() => ({}))
    const stationId = String(body.station_id || '').trim()
    const itemId = String(body.item_id || '').trim()
    const startMethod = String(body.start_method || 'manual_button').trim() as PhotoStartMethod
    const staffId = String(body.staff_id || '').trim() || null

    if (!stationId) return failure(400, 'Station is required.')
    if (!itemId) return failure(400, 'Item is required.')
    if (!['manual_button', 'barcode_scan', 'rfid_scan', 'api'].includes(startMethod)) {
      return failure(400, 'Invalid start method.')
    }

    const supabase = getSupabaseAdmin()
    const session = await startPhotoSessionForItem({
      supabase,
      companyId: access.company.id,
      stationId,
      itemId,
      startMethod,
      startedByUserId: access.user.id,
      startedByStaffId: staffId,
    })

    return NextResponse.json({ ok: true, session })
  } catch (error: any) {
    return failure(500, error.message || 'Photo session failed to start.')
  }
}

export async function PATCH(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member'])
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) {
    return failure(402, 'Company subscription is not active.')
  }

  const body = await request.json().catch(() => ({}))
  const action = text(body.action)
  const stationId = text(body.station_id)
  const sessionId = text(body.session_id || body.sessionId)
  const staffId = text(body.staff_id || body.staffId) || null
  const qcNotes = text(body.qc_notes || body.qcNotes) || null
  const qcStatus = text(body.qc_status || body.qcStatus)

  if (!['end', 'complete', 'qc'].includes(action)) return failure(400, 'Unsupported session action.')

  const supabase = getSupabaseAdmin()

  if (action === 'qc') {
    if (!sessionId) return failure(400, 'Session is required.')

    const updates: Record<string, unknown> = {}
    if (body.qc_notes !== undefined || body.qcNotes !== undefined) updates.qc_notes = qcNotes
    if (qcStatus && ['pending', 'complete', 'needs_reshoot', 'skipped'].includes(qcStatus)) {
      updates.qc_status = qcStatus
    }

    const { data, error } = await supabase
      .from('photo_sessions')
      .update(updates)
      .eq('company_id', access.company.id)
      .eq('id', sessionId)
      .select('*')
      .single()

    if (error) return failure(500, error.message)
    return NextResponse.json({ ok: true, session: data })
  }

  if (!stationId) return failure(400, 'Station is required.')

  if (action === 'complete') {
    const now = new Date().toISOString()

    const { data: activeSession, error: activeError } = await supabase
      .from('photo_sessions')
      .select('id')
      .eq('company_id', access.company.id)
      .eq('station_id', stationId)
      .eq('status', 'active')
      .maybeSingle()

    if (activeError) return failure(500, activeError.message)
    if (!activeSession) return failure(404, 'No active photo session found for this station.')

    const { data: session, error } = await supabase
      .from('photo_sessions')
      .update({
        status: 'ended',
        ended_at: now,
        qc_status: qcStatus && ['complete', 'needs_reshoot', 'skipped'].includes(qcStatus) ? qcStatus : 'complete',
        qc_notes: qcNotes,
        completed_at: now,
        completed_by_staff_id: staffId,
      })
      .eq('company_id', access.company.id)
      .eq('id', activeSession.id)
      .select('*')
      .single()

    if (error) return failure(500, error.message)

    const { data: captures } = await supabase
      .from('photo_captures')
      .select('item_image_id')
      .eq('company_id', access.company.id)
      .eq('session_id', session.id)
      .not('item_image_id', 'is', null)

    const itemImageIds = Array.from(new Set((captures || []).map((capture: any) => capture.item_image_id).filter(Boolean)))

    if (itemImageIds.length > 0) {
      const photoSettings = await loadCompanyPhotoSettings(supabase, access.company.id)
      const { data: itemImages, error: itemImagesError } = await supabase
        .from('item_images')
        .select('id, original_url, processed_url')
        .eq('company_id', access.company.id)
        .in('id', itemImageIds)
        .not('processed_url', 'is', null)
        .not('original_url', 'is', null)

      if (itemImagesError) return failure(500, itemImagesError.message)

      const genuinelyProcessedImageIds = (itemImages || [])
        .filter((image: any) => text(image.processed_url) && text(image.original_url) && image.processed_url !== image.original_url)
        .map((image: any) => image.id)

      const originalOnlyImageIds = (itemImages || [])
        .filter((image: any) => text(image.processed_url) && text(image.original_url) && image.processed_url === image.original_url)
        .map((image: any) => image.id)

      if (genuinelyProcessedImageIds.length > 0) {
        await supabase
          .from('item_images')
          .update({
            original_delete_after: originalDeleteAfterFrom(now, photoSettings.original_retention_days),
            original_retention_status: 'cleanup_scheduled',
          })
          .eq('company_id', access.company.id)
          .in('id', genuinelyProcessedImageIds)
      }

      if (originalOnlyImageIds.length > 0) {
        await supabase
          .from('item_images')
          .update({
            original_delete_after: null,
            original_retention_status: 'active',
          })
          .eq('company_id', access.company.id)
          .in('id', originalOnlyImageIds)
      }

      await markItemChannelUpdatesPending(supabase, access.company.id, session.item_id)
    }

    await supabase
      .from('photography_stations')
      .update({ active_photo_session_id: null, last_activity_at: now })
      .eq('company_id', access.company.id)
      .eq('id', stationId)

    try {
      await cleanupPhotoPreviewRepresentations({
        supabase,
        companyId: access.company.id,
        sessionId: session.id,
      })
    } catch (cleanupError) {
      console.warn('Photo preview cleanup after complete failed', cleanupError)
    }

    return NextResponse.json({ ok: true, session })
  }

  const { data: activeSession, error: activeSessionError } = await supabase
    .from('photo_sessions')
    .select('id')
    .eq('company_id', access.company.id)
    .eq('station_id', stationId)
    .eq('status', 'active')
    .maybeSingle()

  if (activeSessionError) return failure(500, activeSessionError.message)

  const { data: session, error } = await supabase.rpc('end_photo_session', {
    p_company_id: access.company.id,
    p_station_id: stationId,
  })

  if (error) return failure(500, error.message)

  if (activeSession?.id) {
    try {
      await cleanupPhotoPreviewRepresentations({
        supabase,
        companyId: access.company.id,
        sessionId: activeSession.id,
      })
    } catch (cleanupError) {
      console.warn('Photo preview cleanup after end failed', cleanupError)
    }
  }

  return NextResponse.json({ ok: true, session })
}

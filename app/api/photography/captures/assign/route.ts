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

async function nextImageOrder(companyId: string, itemId: string) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('item_images')
    .select('image_order')
    .eq('company_id', companyId)
    .eq('item_id', itemId)
    .order('image_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return Number(data?.image_order || 0) + 1
}

export async function POST(request: Request) {
  try {
    const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member'])
    if (!access.ok) return failure(access.status, access.message)
    if (!companyHasOperationalAccess(access.company)) {
      return failure(402, 'Company subscription is not active.')
    }

    const body = await request.json().catch(() => ({}))
    const captureId = text(body.capture_id || body.captureId)
    const sessionId = text(body.session_id || body.sessionId)

    if (!captureId) return failure(400, 'Capture is required.')
    if (!sessionId) return failure(400, 'Active photo session is required.')

    const supabase = getSupabaseAdmin()

    const { data: session, error: sessionError } = await supabase
      .from('photo_sessions')
      .select('id, company_id, station_id, item_id, status')
      .eq('company_id', access.company.id)
      .eq('id', sessionId)
      .eq('status', 'active')
      .maybeSingle()

    if (sessionError) return failure(500, sessionError.message)
    if (!session) return failure(404, 'Active photo session not found.')

    const { data: capture, error: captureError } = await supabase
      .from('photo_captures')
      .select('*')
      .eq('company_id', access.company.id)
      .eq('id', captureId)
      .maybeSingle()

    if (captureError) return failure(500, captureError.message)
    if (!capture) return failure(404, 'Capture not found.')
    if (capture.capture_status === 'deleted' || capture.capture_status === 'archived') {
      return failure(409, 'Deleted or archived captures cannot be assigned.')
    }

    let itemImageId = capture.item_image_id || null
    if (!itemImageId) {
      const publicUrl = text(capture.exif?.public_url)
      if (!publicUrl) {
        return failure(409, 'Capture has no stored image URL to attach.')
      }

      const order = await nextImageOrder(access.company.id, session.item_id)
      const { data: image, error: imageError } = await supabase
        .from('item_images')
        .insert({
          company_id: access.company.id,
          item_id: session.item_id,
          original_url: publicUrl,
          image_order: order,
        })
        .select('id, item_id, original_url, image_order')
        .single()

      if (imageError) return failure(500, imageError.message)
      itemImageId = image.id
    }

    const { data: updated, error: updateError } = await supabase
      .from('photo_captures')
      .update({
        station_id: session.station_id,
        session_id: session.id,
        item_id: session.item_id,
        item_image_id: itemImageId,
        capture_status: 'assigned',
        assignment_method: 'manual',
      })
      .eq('company_id', access.company.id)
      .eq('id', capture.id)
      .select('*')
      .single()

    if (updateError) return failure(500, updateError.message)

    await designatePhotoMeasurementSource({
      supabase,
      companyId: access.company.id,
      sessionId: session.id,
      captureId: updated.id,
    })

    await supabase
      .from('photography_stations')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('company_id', access.company.id)
      .eq('id', session.station_id)

    return NextResponse.json({ ok: true, capture: updated, item_image_id: itemImageId })
  } catch (error: any) {
    return failure(500, error.message || 'Could not assign capture.')
  }
}

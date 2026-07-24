import { NextResponse } from 'next/server'
import {
  companyHasOperationalAccess,
  getSupabaseAdmin,
  requireCompanyAccess,
} from '@/lib/serverTenant'
import { loadCompanyPhotoSettings, originalDeleteAfterFrom } from '@/lib/photoRetention'

function failure(status: number, message: string) {
  return NextResponse.json({ ok: false, message }, { status })
}

function text(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

export async function GET(request: Request) {
  const access = await requireCompanyAccess(request)
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) {
    return failure(402, 'Company subscription is not active.')
  }

  const url = new URL(request.url)
  const captureId = text(url.searchParams.get('capture_id'))
  const sessionId = text(url.searchParams.get('session_id'))

  if (!captureId && !sessionId) return failure(400, 'Capture or session is required.')

  const supabase = getSupabaseAdmin()
  let query = supabase
    .from('photo_capture_representations')
    .select(
      `id, company_id, capture_id, item_id, session_id, source_id, representation_type,
      status, storage_bucket, storage_path, public_url, local_reference, sha256,
      mime_type, file_size_bytes, original_filename, width, height, metadata,
      created_at, updated_at`
    )
    .eq('company_id', access.company.id)
    .order('created_at', { ascending: true })

  if (captureId) query = query.eq('capture_id', captureId)
  if (sessionId) query = query.eq('session_id', sessionId)

  const { data, error } = await query
  if (error) return failure(500, error.message)

  return NextResponse.json({ ok: true, representations: data || [] })
}

export async function POST(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member'])
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) {
    return failure(402, 'Company subscription is not active.')
  }

  const body = await request.json().catch(() => ({}))
  const action = text(body.action)
  const representationId = text(body.representation_id || body.representationId)

  if (action !== 'apply_to_item_image') return failure(400, 'Invalid representation action.')
  if (!representationId) return failure(400, 'Representation is required.')

  const supabase = getSupabaseAdmin()
  const { data: representation, error: representationError } = await supabase
    .from('photo_capture_representations')
    .select('id, company_id, capture_id, item_id, representation_type, status, public_url, storage_bucket, storage_path, file_size_bytes')
    .eq('company_id', access.company.id)
    .eq('id', representationId)
    .maybeSingle()

  if (representationError) return failure(500, representationError.message)
  if (!representation) return failure(404, 'Representation not found for active company.')
  if (representation.status !== 'available') return failure(409, 'Representation is not available yet.')
  if (!text(representation.public_url)) return failure(409, 'Representation does not have an uploaded image URL.')
  if (representation.representation_type === 'camera_original_jpeg' || representation.representation_type === 'raw_original') {
    return failure(400, 'Only processed representations can be applied as processed item images.')
  }

  const { data: capture, error: captureError } = await supabase
    .from('photo_captures')
    .select('id, company_id, item_id, item_image_id')
    .eq('company_id', access.company.id)
    .eq('id', representation.capture_id)
    .maybeSingle()

  if (captureError) return failure(500, captureError.message)
  if (!capture?.item_image_id) return failure(409, 'Capture is not linked to an item image.')

  const photoSettings = await loadCompanyPhotoSettings(supabase, access.company.id)
  const { data: itemImage, error: updateError } = await supabase
    .from('item_images')
    .update({
      processed_url: representation.public_url,
      processed_storage_bucket: representation.storage_bucket || 'item-images',
      processed_storage_path: representation.storage_path || null,
      processed_file_size_bytes: representation.file_size_bytes || null,
      original_delete_after: originalDeleteAfterFrom(new Date(), photoSettings.original_retention_days),
      original_retention_status: 'cleanup_scheduled',
    })
    .eq('company_id', access.company.id)
    .eq('id', capture.item_image_id)
    .select('id, item_id, original_url, processed_url, image_order')
    .single()

  if (updateError) return failure(500, updateError.message)

  return NextResponse.json({
    ok: true,
    item_image: itemImage,
    representation,
  })
}

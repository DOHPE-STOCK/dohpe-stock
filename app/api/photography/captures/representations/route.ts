import crypto from 'crypto'
import { NextResponse } from 'next/server'
import {
  companyHasOperationalAccess,
  getSupabaseAdmin,
  requireCompanyAccess,
} from '@/lib/serverTenant'
import { loadCompanyPhotoSettings, originalDeleteAfterFrom } from '@/lib/photoRetention'
import { cleanupPhotoPreviewRepresentations } from '@/lib/photoPreviewCleanup'

function failure(status: number, message: string) {
  return NextResponse.json({ ok: false, message }, { status })
}

function text(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function numberInRange(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function sha256Buffer(buffer: Buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
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
  const supabase = getSupabaseAdmin()

  if (action === 'create_manual_crop_preview') {
    const captureId = text(body.capture_id || body.captureId)
    const itemImageId = text(body.item_image_id || body.itemImageId)
    const settings = body.settings && typeof body.settings === 'object' ? body.settings : {}

    if (!captureId || !itemImageId) return failure(400, 'Capture and item image are required.')

    const { data: capture, error: captureError } = await supabase
      .from('photo_captures')
      .select('id, company_id, item_id, item_image_id, session_id, source_id')
      .eq('company_id', access.company.id)
      .eq('id', captureId)
      .eq('item_image_id', itemImageId)
      .maybeSingle()

    if (captureError) return failure(500, captureError.message)
    if (!capture) return failure(404, 'Capture not found for active company.')

    const { data: itemImage, error: imageError } = await supabase
      .from('item_images')
      .select('id, item_id, original_url, processed_url')
      .eq('company_id', access.company.id)
      .eq('id', itemImageId)
      .maybeSingle()

    if (imageError) return failure(500, imageError.message)
    const sourceUrl = text(itemImage?.original_url || itemImage?.processed_url)
    if (!sourceUrl) return failure(409, 'Item image has no original image URL.')

    const sourceResponse = await fetch(sourceUrl)
    if (!sourceResponse.ok) return failure(502, `Could not download original image: HTTP ${sourceResponse.status}`)
    const sourceBuffer = Buffer.from(await sourceResponse.arrayBuffer())

    const sharp = (await import('sharp')).default
    const metadata = await sharp(sourceBuffer).rotate().metadata()
    const width = metadata.width || 0
    const height = metadata.height || 0
    if (!width || !height) return failure(422, 'Could not read original image dimensions.')

    const rotation = numberInRange((settings as any).rotation_degrees, 0, -45, 45)
    const hasEdgeCropSettings =
      'crop_left_percent' in (settings as any) ||
      'crop_right_percent' in (settings as any) ||
      'crop_top_percent' in (settings as any) ||
      'crop_bottom_percent' in (settings as any)

    let left = 0
    let top = 0
    let cropWidth = width
    let cropHeight = height

    if (hasEdgeCropSettings) {
      const cropLeft = numberInRange((settings as any).crop_left_percent, 0, 0, 80) / 100
      const cropRight = numberInRange((settings as any).crop_right_percent, 0, 0, 80) / 100
      const cropTop = numberInRange((settings as any).crop_top_percent, 0, 0, 80) / 100
      const cropBottom = numberInRange((settings as any).crop_bottom_percent, 0, 0, 80) / 100
      left = Math.round(width * cropLeft)
      top = Math.round(height * cropTop)
      cropWidth = Math.max(1, width - left - Math.round(width * cropRight))
      cropHeight = Math.max(1, height - top - Math.round(height * cropBottom))
    } else {
      const fallbackCropWidth = Math.round(10000 / numberInRange((settings as any).zoom_percent, 100, 100, 220))
      const cropWidthPercent = numberInRange((settings as any).crop_width_percent, fallbackCropWidth, 20, 100) / 100
      const cropCenterX = numberInRange(
        (settings as any).crop_center_x_percent ?? (settings as any).offset_x_percent,
        0,
        -100,
        100
      ) / 100
      const cropCenterY = numberInRange(
        (settings as any).crop_center_y_percent ?? (settings as any).offset_y_percent,
        0,
        -100,
        100
      ) / 100
      cropWidth = Math.max(1, Math.round(width * cropWidthPercent))
      cropHeight = Math.max(1, Math.round(height * cropWidthPercent))
      const maxLeft = Math.max(0, width - cropWidth)
      const maxTop = Math.max(0, height - cropHeight)
      left = Math.max(0, Math.min(maxLeft, Math.round(maxLeft / 2 + cropCenterX * (maxLeft / 2))))
      top = Math.max(0, Math.min(maxTop, Math.round(maxTop / 2 + cropCenterY * (maxTop / 2))))
    }

    const output = await sharp(sourceBuffer)
      .rotate()
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .rotate(rotation, { background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 94 })
      .toBuffer()

    const sha = sha256Buffer(output)
    const storagePath = [
      'processed-representations',
      access.company.id,
      'manual-crop',
      new Date().toISOString().slice(0, 10),
      `${Date.now()}-${sha.slice(0, 12)}-manual-crop.jpg`,
    ].join('/')

    const { error: uploadError } = await supabase.storage
      .from('item-images')
      .upload(storagePath, output, {
        contentType: 'image/jpeg',
        upsert: false,
      })

    if (uploadError) return failure(500, uploadError.message)
    const { data: urlData } = supabase.storage.from('item-images').getPublicUrl(storagePath)

    const { data: representation, error: insertError } = await supabase
      .from('photo_capture_representations')
      .insert({
        company_id: access.company.id,
        capture_id: capture.id,
        item_id: capture.item_id || itemImage?.item_id || null,
        session_id: capture.session_id || null,
        source_id: capture.source_id || null,
        representation_type: 'processed_preview',
        status: 'preview',
        storage_bucket: 'item-images',
        storage_path: storagePath,
        public_url: urlData.publicUrl,
        sha256: sha,
        mime_type: 'image/jpeg',
        file_size_bytes: output.length,
        original_filename: 'manual-crop.jpg',
        metadata: {
          engine: 'sharp-manual-crop',
          settings,
          source_width: width,
          source_height: height,
          crop_box: { left, top, width: cropWidth, height: cropHeight },
        },
      })
      .select('*')
      .single()

    if (insertError) return failure(500, insertError.message)
    return NextResponse.json({ ok: true, representation })
  }

  if (action !== 'apply_to_item_image') return failure(400, 'Invalid representation action.')
  if (!representationId) return failure(400, 'Representation is required.')

  const { data: representation, error: representationError } = await supabase
    .from('photo_capture_representations')
    .select('id, company_id, capture_id, item_id, representation_type, status, public_url, storage_bucket, storage_path, file_size_bytes')
    .eq('company_id', access.company.id)
    .eq('id', representationId)
    .maybeSingle()

  if (representationError) return failure(500, representationError.message)
  if (!representation) return failure(404, 'Representation not found for active company.')
  if (!['available', 'preview', 'accepted'].includes(representation.status)) {
    return failure(409, 'Representation is not available yet.')
  }
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

  await supabase
    .from('photo_capture_representations')
    .update({ status: 'accepted' })
    .eq('company_id', access.company.id)
    .eq('id', representation.id)

  try {
    await cleanupPhotoPreviewRepresentations({
      supabase,
      companyId: access.company.id,
      captureIds: [representation.capture_id],
      excludeRepresentationIds: [representation.id],
    })
  } catch (error) {
    console.warn('Photo preview cleanup after accept failed', error)
  }

  return NextResponse.json({
    ok: true,
    item_image: itemImage,
    representation,
  })
}

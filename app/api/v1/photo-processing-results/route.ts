import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/serverTenant'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function failure(status: number, message: string) {
  return NextResponse.json({ ok: false, message }, { status })
}

function text(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function tokenHash(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function sha256Buffer(buffer: Buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function cleanFilename(value: string) {
  return value.replace(/[^\w.\- ]+/g, '_').slice(0, 160) || 'processed-output'
}

function parseJsonObject(value: FormDataEntryValue | null) {
  const raw = text(value)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function parseJsonArray(value: FormDataEntryValue | null) {
  const raw = text(value)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function getBearerToken(request: Request) {
  const header = request.headers.get('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

async function loadSourceByToken(token: string) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('photo_sources')
    .select('id, company_id, station_id, enabled, token_revoked_at')
    .eq('token_hash', tokenHash(token))
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data || data.enabled === false || data.token_revoked_at) return null
  return data
}

const representationTypes = new Set([
  'baseline_processed',
  'calibrated_preview',
  'processed_preview',
  'product_master',
  'background_removed',
  'measurement_analysis',
])

export async function POST(request: Request) {
  try {
    const token = getBearerToken(request)
    if (!token) return failure(401, 'Missing photo source token.')

    const source = await loadSourceByToken(token)
    if (!source) return failure(401, 'Invalid photo source token.')

    const form = await request.formData()
    const jobId = text(form.get('job_id'))
    const representationType = text(form.get('representation_type'))
    const originalFilename = cleanFilename(text(form.get('original_filename')) || 'processed-output')
    const metadata = parseJsonObject(form.get('metadata')) || {}
    const measurementSuggestions = parseJsonArray(form.get('measurement_suggestions'))
    const workerSha = text(form.get('sha256')).toLowerCase()
    const file = form.get('file')

    if (!jobId) return failure(400, 'Processing job is required.')
    if (representationType && !representationTypes.has(representationType)) {
      return failure(400, 'Invalid representation type.')
    }

    const supabase = getSupabaseAdmin()
    const { data: job, error: jobError } = await supabase
      .from('photo_processing_jobs')
      .select(
        `id, company_id, station_id, source_id, session_id, capture_id, job_type,
        status, calibration_profile_ids,
        capture:photo_captures(item_id, item_image_id)`
      )
      .eq('company_id', source.company_id)
      .eq('source_id', source.id)
      .eq('id', jobId)
      .maybeSingle()

    if (jobError) throw new Error(jobError.message)
    if (!job) return failure(404, 'Processing job not found for this source.')

    let representation = null
    const capture = Array.isArray(job.capture) ? job.capture[0] : job.capture
    const itemId = capture?.item_id || null
    const itemImageId = capture?.item_image_id || null

    if (file instanceof File) {
      const buffer = Buffer.from(await file.arrayBuffer())
      const sha = sha256Buffer(buffer)
      if (workerSha && workerSha !== sha) return failure(400, 'SHA-256 does not match uploaded result file.')
      const cleanRepresentationType = representationType || 'processed_preview'

      const { data: existingRepresentation, error: existingRepresentationError } = await supabase
        .from('photo_capture_representations')
        .select('*')
        .eq('company_id', source.company_id)
        .eq('capture_id', job.capture_id)
        .eq('representation_type', cleanRepresentationType)
        .eq('sha256', sha)
        .maybeSingle()

      if (existingRepresentationError) throw new Error(existingRepresentationError.message)

      if (existingRepresentation) {
        representation = existingRepresentation
      } else {
        const storagePath = [
          'processed-representations',
          source.company_id,
          source.station_id,
          new Date().toISOString().slice(0, 10),
          `${Date.now()}-${sha.slice(0, 12)}-${originalFilename}`,
        ].join('/')

        const { error: uploadError } = await supabase.storage
          .from('item-images')
          .upload(storagePath, buffer, {
            contentType: file.type || 'application/octet-stream',
            upsert: false,
          })

        if (uploadError) throw new Error(uploadError.message)

        const { data: urlData } = supabase.storage.from('item-images').getPublicUrl(storagePath)

        const { data: inserted, error: representationError } = await supabase
          .from('photo_capture_representations')
          .insert({
            company_id: source.company_id,
            capture_id: job.capture_id,
            item_id: itemId,
            session_id: job.session_id || null,
            source_id: source.id,
            representation_type: cleanRepresentationType,
            status: cleanRepresentationType === 'baseline_processed' ? 'available' : 'preview',
            storage_bucket: 'item-images',
            storage_path: storagePath,
            public_url: urlData.publicUrl,
            sha256: sha,
            mime_type: file.type || null,
            file_size_bytes: buffer.length,
            original_filename: originalFilename,
            metadata,
          })
          .select('*')
          .single()

        if (representationError) {
          if (String(representationError.message || '').includes('duplicate key value')) {
            const { data: duplicateRepresentation, error: duplicateLookupError } = await supabase
              .from('photo_capture_representations')
              .select('*')
              .eq('company_id', source.company_id)
              .eq('capture_id', job.capture_id)
              .eq('representation_type', cleanRepresentationType)
              .eq('sha256', sha)
              .maybeSingle()

            if (duplicateLookupError) throw new Error(duplicateLookupError.message)
            if (!duplicateRepresentation) throw new Error(representationError.message)
            representation = duplicateRepresentation
          } else {
            throw new Error(representationError.message)
          }
        } else {
          representation = inserted
        }
      }

      if (representationType === 'baseline_processed' && itemImageId) {
        const { data: itemImage, error: itemImageError } = await supabase
          .from('item_images')
          .select('id, processed_url')
          .eq('company_id', source.company_id)
          .eq('id', itemImageId)
          .maybeSingle()

        if (itemImageError) throw new Error(itemImageError.message)

        const imageUpdate: Record<string, unknown> = {
          baseline_processed_url: representation.public_url,
          baseline_processed_storage_bucket: representation.storage_bucket || 'item-images',
          baseline_processed_storage_path: representation.storage_path || null,
          baseline_processed_file_size_bytes: representation.file_size_bytes || buffer.length,
          baseline_processed_created_at: new Date().toISOString(),
        }

        if (itemImage && !itemImage.processed_url) {
          imageUpdate.processed_url = representation.public_url
          imageUpdate.processed_storage_bucket = representation.storage_bucket || 'item-images'
          imageUpdate.processed_storage_path = representation.storage_path || null
          imageUpdate.processed_file_size_bytes = representation.file_size_bytes || buffer.length
        }

        const { error: baselineError } = await supabase
          .from('item_images')
          .update(imageUpdate)
          .eq('company_id', source.company_id)
          .eq('id', itemImageId)

        if (baselineError) throw new Error(baselineError.message)
      }
    }

    const insertedSuggestions = []
    for (const row of measurementSuggestions) {
      if (!itemId) continue
      if (!row || typeof row !== 'object') continue
      const measurementType = text((row as any).measurement_type || (row as any).measurementType)
      if (!measurementType) continue

      const { data, error } = await supabase
        .from('photo_measurement_suggestions')
        .insert({
          company_id: source.company_id,
          item_id: itemId,
          session_id: job.session_id,
          capture_id: job.capture_id,
          station_id: job.station_id || source.station_id,
          calibration_profile_ids: job.calibration_profile_ids || [],
          measurement_type: measurementType,
          raw_value_mm: (row as any).raw_value_mm ?? null,
          raw_value_in: (row as any).raw_value_in ?? null,
          transformation_rule: text((row as any).transformation_rule) || 'processor',
          proposed_value_in: (row as any).proposed_value_in ?? null,
          rounding_rule: text((row as any).rounding_rule) || 'nearest_whole_inch',
          confidence: (row as any).confidence ?? null,
          status: text((row as any).status) || 'suggested',
          processing_version: text((row as any).processing_version) || null,
          metadata: (row as any).metadata && typeof (row as any).metadata === 'object' ? (row as any).metadata : {},
        })
        .select('*')
        .single()

      if (error) throw new Error(error.message)
      insertedSuggestions.push(data)
    }

    const { error: updateError } = await supabase
      .from('photo_processing_jobs')
      .update({
        status: 'completed',
        result_representation_id: representation?.id || null,
        error_message: null,
        completed_at: new Date().toISOString(),
      })
      .eq('company_id', source.company_id)
      .eq('source_id', source.id)
      .eq('id', job.id)

    if (updateError) throw new Error(updateError.message)

    return NextResponse.json({
      ok: true,
      representation,
      measurement_suggestions: insertedSuggestions,
    })
  } catch (error: any) {
    return failure(500, error.message || 'Photo processing result upload failed.')
  }
}

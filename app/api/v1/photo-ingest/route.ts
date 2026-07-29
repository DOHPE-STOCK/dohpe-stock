import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/serverTenant'
import { designatePhotoMeasurementSource } from '@/lib/photographyServer'
import { loadCompanyPhotoSettings, megabytesToBytes } from '@/lib/photoRetention'

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
  return value.replace(/[^\w.\- ]+/g, '_').slice(0, 160) || 'capture.jpg'
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

function cleanPhotoRole(value: string) {
  const role = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 40)
  return role || 'other'
}

function getBearerToken(request: Request) {
  const header = request.headers.get('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

async function loadSourceByToken(token: string) {
  const supabase = getSupabaseAdmin()
  const hash = tokenHash(token)

  const { data, error } = await supabase
    .from('photo_sources')
    .select(
      `id, company_id, station_id, name, source_type, enabled, token_revoked_at,
      clock_offset_seconds, capture_tolerance_seconds,
      station:photography_stations(id, name, code, active_photo_session_id)`
    )
    .eq('token_hash', hash)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data
}

async function resolveSession(params: {
  companyId: string
  stationId: string
  explicitSessionId: string
  capturedAt: string | null
  clockOffsetSeconds: number
  captureToleranceSeconds: number
}) {
  const supabase = getSupabaseAdmin()

  if (params.explicitSessionId) {
    const { data, error } = await supabase
      .from('photo_sessions')
      .select('id, company_id, station_id, item_id, status')
      .eq('company_id', params.companyId)
      .eq('station_id', params.stationId)
      .eq('id', params.explicitSessionId)
      .eq('status', 'active')
      .maybeSingle()

    if (error) throw new Error(error.message)
    return { session: data, assignmentMethod: data ? 'explicit_session' : 'unassigned' }
  }

  const capturedTime = params.capturedAt ? new Date(params.capturedAt) : null
  if (capturedTime && !Number.isNaN(capturedTime.getTime())) {
    const adjustedTime = new Date(capturedTime.getTime() + params.clockOffsetSeconds * 1000)
    const toleranceMs = Math.max(0, params.captureToleranceSeconds) * 1000
    const windowStart = new Date(adjustedTime.getTime() - toleranceMs).toISOString()
    const windowEnd = new Date(adjustedTime.getTime() + toleranceMs).toISOString()

    const { data, error } = await supabase
      .from('photo_sessions')
      .select('id, company_id, station_id, item_id, status, started_at, ended_at')
      .eq('company_id', params.companyId)
      .eq('station_id', params.stationId)
      .lte('started_at', windowEnd)
      .or(`ended_at.is.null,ended_at.gte.${windowStart}`)
      .order('started_at', { ascending: false })
      .limit(2)

    if (error) throw new Error(error.message)
    if ((data || []).length === 1) {
      return { session: data?.[0], assignmentMethod: 'capture_time' }
    }
  }

  const { data, error } = await supabase
    .from('photo_sessions')
    .select('id, company_id, station_id, item_id, status, started_at')
    .eq('company_id', params.companyId)
    .eq('station_id', params.stationId)
    .eq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(2)

  if (error) throw new Error(error.message)

  if ((data || []).length === 1) {
    return { session: data?.[0], assignmentMethod: 'active_session' }
  }

  return { session: null, assignmentMethod: 'unassigned' }
}

async function consumeStationCalibrationIntent(params: {
  companyId: string
  stationId: string
  sourceId: string
}) {
  const supabase = getSupabaseAdmin()
  const now = new Date().toISOString()

  const { error: expireError } = await supabase
    .from('photo_station_capture_intents')
    .update({
      status: 'expired',
      metadata: { expired_by: 'photo_ingest' },
    })
    .eq('company_id', params.companyId)
    .eq('station_id', params.stationId)
    .eq('status', 'queued')
    .lt('expires_at', now)

  if (expireError?.code === '42P01') return null
  if (expireError) throw new Error(expireError.message)

  const { data, error } = await supabase
    .from('photo_station_capture_intents')
    .select('id')
    .eq('company_id', params.companyId)
    .eq('station_id', params.stationId)
    .eq('intent_type', 'station_calibration')
    .eq('status', 'queued')
    .or(`source_id.is.null,source_id.eq.${params.sourceId}`)
    .gte('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error?.code === '42P01') return null
  if (error) throw new Error(error.message)
  return data || null
}

async function saveStationCalibrationReference(params: {
  companyId: string
  stationId: string
  sourceId: string
  captureId: string
  publicUrl: string
  intentId: string
}) {
  const supabase = getSupabaseAdmin()
  const now = new Date().toISOString()
  const today = now.slice(0, 10)
  const measuredReference = {
    calibration_capture_id: params.captureId,
    calibration_image_url: params.publicUrl,
    reference_scope: ['colour', 'geometry', 'measurements', 'background', 'crop'],
  }
  const calibrationData = {
    captured_for_date: today,
    background_reference: {
      enabled: true,
      sample_method: 'calibration_image_background_estimate',
      note: 'Processor should estimate the clean background from this calibration image before matting product photos.',
    },
    notes: 'Session calibration reference for colour, ArUco geometry, measurement scale, background removal and crop guidance.',
    source: 'station_capture_intent',
  }

  const { data: existing, error: existingError } = await supabase
    .from('photography_calibration_profiles')
    .select('id, name, measured_reference, calibration_data')
    .eq('company_id', params.companyId)
    .eq('station_id', params.stationId)
    .eq('profile_type', 'station_daily_reference')
    .neq('status', 'archived')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingError) throw new Error(existingError.message)

  if (existing?.id) {
    const { error } = await supabase
      .from('photography_calibration_profiles')
      .update({
        source_id: params.sourceId,
        name: existing.name || `Session reference ${new Date().toLocaleDateString('en-GB')}`,
        status: 'active',
        measured_reference: {
          ...(existing.measured_reference || {}),
          ...measuredReference,
        },
        calibration_data: {
          ...(existing.calibration_data || {}),
          ...calibrationData,
        },
      })
      .eq('company_id', params.companyId)
      .eq('id', existing.id)

    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase
      .from('photography_calibration_profiles')
      .insert({
        company_id: params.companyId,
        station_id: params.stationId,
        source_id: params.sourceId,
        name: `Session reference ${new Date().toLocaleDateString('en-GB')}`,
        profile_type: 'station_daily_reference',
        status: 'active',
        measured_reference: measuredReference,
        calibration_data: calibrationData,
      })

    if (error) throw new Error(error.message)
  }

  const { error: intentError } = await supabase
    .from('photo_station_capture_intents')
    .update({
      status: 'consumed',
      consumed_capture_id: params.captureId,
      consumed_at: now,
      metadata: {
        consumed_as: 'station_calibration_reference',
        calibration_image_url: params.publicUrl,
      },
    })
    .eq('company_id', params.companyId)
    .eq('id', params.intentId)

  if (intentError) throw new Error(intentError.message)
}

async function recordCameraOriginalRepresentation(params: {
  companyId: string
  captureId: string
  sessionId: string | null
  itemId: string | null
  sourceId: string
  storagePath: string
  publicUrl: string
  sha256: string
  mimeType: string | null
  fileSizeBytes: number
  originalFilename: string
  metadata: Record<string, unknown>
}) {
  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('photo_capture_representations')
    .insert({
      company_id: params.companyId,
      capture_id: params.captureId,
      item_id: params.itemId,
      session_id: params.sessionId,
      source_id: params.sourceId,
      representation_type: 'camera_original_jpeg',
      status: 'available',
      storage_bucket: 'item-images',
      storage_path: params.storagePath,
      public_url: params.publicUrl,
      sha256: params.sha256,
      mime_type: params.mimeType,
      file_size_bytes: params.fileSizeBytes,
      original_filename: params.originalFilename,
      metadata: params.metadata,
    })

  if (error && error.code !== '23505') {
    console.warn('Photo representation record skipped:', error.message)
  }
}

async function recordRawOriginalRepresentation(params: {
  companyId: string
  captureId: string
  sessionId: string | null
  itemId: string | null
  sourceId: string
  rawMetadata: Record<string, any> | null
}) {
  if (!params.rawMetadata?.raw_available) return

  const supabase = getSupabaseAdmin()
  const localReference = {
    raw_worker_file_id: text(params.rawMetadata.raw_worker_file_id) || null,
    pair_key: text(params.rawMetadata.pair_key) || null,
    raw_available: true,
    local_state: 'retained',
  }

  const { error } = await supabase
    .from('photo_capture_representations')
    .insert({
      company_id: params.companyId,
      capture_id: params.captureId,
      item_id: params.itemId,
      session_id: params.sessionId,
      source_id: params.sourceId,
      representation_type: 'raw_original',
      status: 'available',
      local_reference: localReference,
      sha256: text(params.rawMetadata.raw_sha256) || null,
      mime_type: 'image/x-raw',
      file_size_bytes: Number(params.rawMetadata.raw_size_bytes || 0) || null,
      original_filename: cleanFilename(text(params.rawMetadata.raw_filename) || 'raw-original'),
      metadata: {
        raw_extension: text(params.rawMetadata.raw_extension) || null,
        raw_mtime: params.rawMetadata.raw_mtime || null,
        worker_note: 'RAW retained locally; not uploaded to Loopbase.',
      },
    })

  if (error && error.code !== '23505') {
    console.warn('RAW representation record skipped:', error.message)
  }
}

async function queueBaselineProcessedJob(params: {
  companyId: string
  stationId: string
  sourceId: string
  sessionId: string | null
  captureId: string
}) {
  const supabase = getSupabaseAdmin()

  const { data: existing, error: existingError } = await supabase
    .from('photo_processing_jobs')
    .select('id')
    .eq('company_id', params.companyId)
    .eq('capture_id', params.captureId)
    .eq('job_type', 'baseline_processed')
    .limit(1)
    .maybeSingle()

  if (existingError) {
    console.warn('Baseline processed job check skipped:', existingError.message)
    return
  }

  if (existing) return

  const { error } = await supabase
    .from('photo_processing_jobs')
    .insert({
      company_id: params.companyId,
      station_id: params.stationId,
      source_id: params.sourceId,
      session_id: params.sessionId,
      capture_id: params.captureId,
      job_type: 'baseline_processed',
      status: 'queued',
      processing_source: 'jpeg_camera_original',
      options: {
        purpose: 'permanent_no_edit_revert_copy',
      },
    })

  if (error) {
    console.warn('Baseline processed job skipped:', error.message)
  }
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
    const token = getBearerToken(request)
    if (!token) return failure(401, 'Missing photo source token.')

    const source = await loadSourceByToken(token)
    if (!source) return failure(401, 'Invalid photo source token.')
    if (source.enabled === false || source.token_revoked_at) {
      return failure(403, 'Photo source token is not active.')
    }

    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return failure(400, 'File is required.')

    const explicitSessionId = text(form.get('session_id'))
    const workerSha = text(form.get('sha256')).toLowerCase()
    const originalFilename = cleanFilename(text(form.get('original_filename')) || file.name)
    const capturedAt = text(form.get('captured_at')) || null
    const idempotencyKey = text(form.get('idempotency_key'))
    const workerVersion = text(form.get('worker_version'))
    const rawMetadata = parseJsonObject(form.get('raw_metadata'))
    const uploadedPhotoRole = cleanPhotoRole(text(form.get('photo_role')) || 'other')

    const buffer = Buffer.from(await file.arrayBuffer())
    const sha = sha256Buffer(buffer)

    if (workerSha && workerSha !== sha) {
      return failure(400, 'SHA-256 does not match uploaded file.')
    }

    const supabase = getSupabaseAdmin()
    const photoSettings = await loadCompanyPhotoSettings(supabase, source.company_id)
    const maxUploadBytes = megabytesToBytes(photoSettings.station_upload_max_file_mb)

    if (buffer.length > maxUploadBytes) {
      return failure(
        413,
        `Photo is too large. Station uploads are limited to ${photoSettings.station_upload_max_file_mb}MB.`
      )
    }

    const { data: existingCapture, error: existingError } = await supabase
      .from('photo_captures')
      .select('id, item_image_id, session_id, item_id, capture_status, sha256')
      .eq('company_id', source.company_id)
      .eq('sha256', sha)
      .maybeSingle()

    if (existingError) throw new Error(existingError.message)
    if (existingCapture) {
      await supabase
        .from('photo_sources')
        .update({ last_activity_at: new Date().toISOString() })
        .eq('id', source.id)

      return NextResponse.json({
        ok: true,
        deduplicated: true,
        capture: existingCapture,
      })
    }

    const calibrationIntent = await consumeStationCalibrationIntent({
      companyId: source.company_id,
      stationId: source.station_id,
      sourceId: source.id,
    })

    const { session, assignmentMethod } = calibrationIntent
      ? { session: null, assignmentMethod: 'unassigned' }
      : await resolveSession({
          companyId: source.company_id,
          stationId: source.station_id,
          explicitSessionId,
          capturedAt,
          clockOffsetSeconds: Number(source.clock_offset_seconds || 0) || 0,
          captureToleranceSeconds: Number(source.capture_tolerance_seconds || 90) || 90,
        })

    const itemId = session?.item_id || null
    const photoRole = calibrationIntent ? 'station_calibration' : uploadedPhotoRole
    let itemImage = null
    const storagePath = [
      itemId ? 'camera-originals' : 'camera-unassigned',
      source.company_id,
      source.station_id,
      new Date().toISOString().slice(0, 10),
      `${Date.now()}-${sha.slice(0, 12)}-${originalFilename}`,
    ].join('/')

    const { error: uploadError } = await supabase.storage
      .from('item-images')
      .upload(storagePath, buffer, {
        contentType: file.type || 'image/jpeg',
        upsert: false,
      })

    if (uploadError) throw new Error(uploadError.message)

    const { data: urlData } = supabase.storage.from('item-images').getPublicUrl(storagePath)
    const publicUrl = urlData.publicUrl

    if (itemId) {
      const order = await nextImageOrder(source.company_id, itemId)
      const { data: insertedImage, error: imageError } = await supabase
        .from('item_images')
        .insert({
          company_id: source.company_id,
          item_id: itemId,
          original_url: publicUrl,
          original_storage_bucket: 'item-images',
          original_storage_path: storagePath,
          original_file_size_bytes: buffer.length,
          original_retention_status: 'active',
          upload_source: 'photography_session',
          image_order: order,
        })
        .select('id, item_id, original_url, image_order')
        .single()

      if (imageError) throw new Error(imageError.message)
      itemImage = insertedImage
    }

    const { data: capture, error: captureError } = await supabase
      .from('photo_captures')
      .insert({
        company_id: source.company_id,
        station_id: source.station_id,
        session_id: session?.id || null,
        item_id: itemId,
        source_id: source.id,
        item_image_id: itemImage?.id || null,
        capture_status: itemId ? 'assigned' : 'unassigned',
        assignment_method: assignmentMethod,
        sha256: sha,
        original_filename: originalFilename,
        captured_at: capturedAt,
        exif: {
          idempotency_key: idempotencyKey || null,
          worker_version: workerVersion || null,
          photo_role: photoRole,
          mime_type: file.type || null,
          size_bytes: buffer.length,
          storage_bucket: 'item-images',
          storage_path: storagePath,
          public_url: publicUrl,
        },
      })
      .select('*')
      .single()

    if (captureError) throw new Error(captureError.message)

    if (calibrationIntent?.id) {
      await saveStationCalibrationReference({
        companyId: source.company_id,
        stationId: source.station_id,
        sourceId: source.id,
        captureId: capture.id,
        publicUrl,
        intentId: calibrationIntent.id,
      })
    }

    await recordCameraOriginalRepresentation({
      companyId: source.company_id,
      captureId: capture.id,
      sessionId: capture.session_id || null,
      itemId: capture.item_id || null,
      sourceId: source.id,
      storagePath,
      publicUrl,
      sha256: sha,
      mimeType: file.type || null,
      fileSizeBytes: buffer.length,
      originalFilename,
      metadata: {
        idempotency_key: idempotencyKey || null,
        worker_version: workerVersion || null,
        captured_at: capturedAt,
        assignment_method: assignmentMethod,
        photo_role: photoRole,
      },
    })

    await recordRawOriginalRepresentation({
      companyId: source.company_id,
      captureId: capture.id,
      sessionId: capture.session_id || null,
      itemId: capture.item_id || null,
      sourceId: source.id,
      rawMetadata,
    })

    if (capture.item_image_id && capture.capture_status === 'assigned') {
      await queueBaselineProcessedJob({
        companyId: source.company_id,
        stationId: source.station_id,
        sourceId: source.id,
        sessionId: capture.session_id || null,
        captureId: capture.id,
      })
    }

    if (capture.session_id && capture.capture_status === 'assigned') {
      await designatePhotoMeasurementSource({
        supabase,
        companyId: source.company_id,
        sessionId: capture.session_id,
        captureId: capture.id,
      })
    }

    const now = new Date().toISOString()
    await supabase
      .from('photo_sources')
      .update({ last_activity_at: now })
      .eq('id', source.id)

    await supabase
      .from('photography_stations')
      .update({ last_activity_at: now })
      .eq('id', source.station_id)

    return NextResponse.json({
      ok: true,
      deduplicated: false,
      assigned: Boolean(itemId),
      assignment_method: assignmentMethod,
      source_id: source.id,
      station_id: source.station_id,
      session_id: session?.id || null,
      item_id: itemId,
      item_image: itemImage,
      public_url: publicUrl || null,
      capture,
    })
  } catch (error: any) {
    return failure(500, error.message || 'Photo ingest failed.')
  }
}

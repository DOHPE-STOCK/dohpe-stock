import { NextResponse } from 'next/server'
import {
  companyHasOperationalAccess,
  getSupabaseAdmin,
  requireCompanyAccess,
} from '@/lib/serverTenant'

function failure(status: number, message: string) {
  return NextResponse.json({ ok: false, message }, { status })
}

function text(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

const allowedJobTypes = [
  'calibrated_preview',
  'measurement_analysis',
  'processed_preview',
  'product_master',
  'raw_development',
  'background_removal',
  'derivative',
]

const allowedSources = ['jpeg_camera_original', 'raw_local_original']

function activeJobStatuses() {
  return ['queued', 'waiting_for_worker', 'processing', 'uploading']
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
    .from('photo_processing_jobs')
    .select(
      `id, company_id, station_id, source_id, session_id, capture_id, job_type,
      status, processing_source, options, calibration_profile_ids,
      result_representation_id, attempts, error_message, queued_at, started_at,
      completed_at, created_by, created_at, updated_at,
      result_representation:photo_capture_representations(id, representation_type, public_url, status)`
    )
    .eq('company_id', access.company.id)
    .order('queued_at', { ascending: false })
    .limit(30)

  if (captureId) query = query.eq('capture_id', captureId)
  if (sessionId) query = query.eq('session_id', sessionId)

  const { data, error } = await query
  if (error) return failure(500, error.message)

  return NextResponse.json({ ok: true, jobs: data || [] })
}

export async function POST(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member'])
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) {
    return failure(402, 'Company subscription is not active.')
  }

  const body = await request.json().catch(() => ({}))
  const captureId = text(body.capture_id || body.captureId)
  const jobType = text(body.job_type || body.jobType)
  const processingSource = text(body.processing_source || body.processingSource) || 'jpeg_camera_original'

  if (!captureId) return failure(400, 'Capture is required.')
  if (!allowedJobTypes.includes(jobType)) return failure(400, 'Invalid processing job type.')
  if (!allowedSources.includes(processingSource)) return failure(400, 'Invalid processing source.')

  const supabase = getSupabaseAdmin()
  const { data: capture, error: captureError } = await supabase
    .from('photo_captures')
    .select('id, company_id, station_id, source_id, session_id, item_id, capture_status')
    .eq('company_id', access.company.id)
    .eq('id', captureId)
    .maybeSingle()

  if (captureError) return failure(500, captureError.message)
  if (!capture) return failure(404, 'Capture not found for active company.')
  if (capture.capture_status === 'deleted' || capture.capture_status === 'archived') {
    return failure(409, 'Deleted or archived captures cannot be processed.')
  }

  const { data: existing, error: existingError } = await supabase
    .from('photo_processing_jobs')
    .select('id, status, queued_at')
    .eq('company_id', access.company.id)
    .eq('capture_id', capture.id)
    .eq('job_type', jobType)
    .eq('processing_source', processingSource)
    .in('status', activeJobStatuses())
    .order('queued_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingError) return failure(500, existingError.message)
  if (existing) {
    return NextResponse.json({
      ok: true,
      job: existing,
      already_queued: true,
      message: 'A matching processing job is already active.',
    })
  }

  const calibrationProfileIds = Array.isArray(body.calibration_profile_ids || body.calibrationProfileIds)
    ? (body.calibration_profile_ids || body.calibrationProfileIds).map(text).filter(Boolean)
    : []

  const { data: job, error } = await supabase
    .from('photo_processing_jobs')
    .insert({
      company_id: access.company.id,
      station_id: capture.station_id,
      source_id: capture.source_id,
      session_id: capture.session_id,
      capture_id: capture.id,
      job_type: jobType,
      status: 'queued',
      processing_source: processingSource,
      options: body.options && typeof body.options === 'object' ? body.options : {},
      calibration_profile_ids: calibrationProfileIds,
      created_by: access.user.id,
    })
    .select('*')
    .single()

  if (error) return failure(500, error.message)
  return NextResponse.json({ ok: true, job })
}

export async function PATCH(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager'])
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) {
    return failure(402, 'Company subscription is not active.')
  }

  const body = await request.json().catch(() => ({}))
  const jobId = text(body.id || body.job_id || body.jobId)
  const status = text(body.status)

  if (!jobId) return failure(400, 'Processing job is required.')
  if (!['cancelled'].includes(status)) return failure(400, 'Invalid processing job update.')

  const { data, error } = await getSupabaseAdmin()
    .from('photo_processing_jobs')
    .update({
      status,
      completed_at: new Date().toISOString(),
      error_message: text(body.error_message || body.errorMessage) || null,
    })
    .eq('company_id', access.company.id)
    .eq('id', jobId)
    .in('status', activeJobStatuses())
    .select('*')
    .single()

  if (error) return failure(500, error.message)
  return NextResponse.json({ ok: true, job: data })
}

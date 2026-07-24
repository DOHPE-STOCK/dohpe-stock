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

function getBearerToken(request: Request) {
  const header = request.headers.get('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

async function loadSourceByToken(token: string) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('photo_sources')
    .select('id, company_id, station_id, name, enabled, token_revoked_at')
    .eq('token_hash', tokenHash(token))
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data || data.enabled === false || data.token_revoked_at) return null
  return data
}

export async function GET(request: Request) {
  try {
    const token = getBearerToken(request)
    if (!token) return failure(401, 'Missing photo source token.')

    const source = await loadSourceByToken(token)
    if (!source) return failure(401, 'Invalid photo source token.')

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('photo_processing_jobs')
      .select(
        `id, company_id, station_id, source_id, session_id, capture_id, job_type,
        status, processing_source, options, calibration_profile_ids, attempts,
        queued_at, started_at, created_at,
        capture:photo_captures(id, original_filename, exif, item_image_id),
        representations:photo_capture_representations(
          id, representation_type, status, public_url, local_reference,
          original_filename, storage_bucket, storage_path, mime_type
        )`
      )
      .eq('company_id', source.company_id)
      .eq('source_id', source.id)
      .in('status', ['queued', 'waiting_for_worker'])
      .order('queued_at', { ascending: true })
      .limit(5)

    if (error) return failure(500, error.message)

    const jobs = data || []
    const profileIds = Array.from(
      new Set(
        jobs
          .flatMap((job: any) => Array.isArray(job.calibration_profile_ids) ? job.calibration_profile_ids : [])
          .map(text)
          .filter(Boolean)
      )
    )

    let profilesById = new Map<string, any>()
    if (profileIds.length > 0) {
      const { data: profiles, error: profileError } = await supabase
        .from('photography_calibration_profiles')
        .select(
          `id, name, profile_type, status, profile_version, source_id,
          manufacturer, camera_model, lens_model, measured_reference,
          calibration_data, updated_at`
        )
        .eq('company_id', source.company_id)
        .in('id', profileIds)

      if (profileError) return failure(500, profileError.message)
      profilesById = new Map((profiles || []).map((profile: any) => [String(profile.id), profile]))
    }

    const jobsWithProfiles = jobs.map((job: any) => ({
      ...job,
      calibration_profiles: (Array.isArray(job.calibration_profile_ids) ? job.calibration_profile_ids : [])
        .map((id: string) => profilesById.get(String(id)))
        .filter(Boolean),
    }))

    return NextResponse.json({ ok: true, jobs: jobsWithProfiles })
  } catch (error: any) {
    return failure(500, error.message || 'Could not load photo processing jobs.')
  }
}

export async function PATCH(request: Request) {
  try {
    const token = getBearerToken(request)
    if (!token) return failure(401, 'Missing photo source token.')

    const source = await loadSourceByToken(token)
    if (!source) return failure(401, 'Invalid photo source token.')

    const body = await request.json().catch(() => ({}))
    const jobId = text(body.job_id || body.jobId || body.id)
    const status = text(body.status)
    const message = text(body.message || body.error_message || body.errorMessage)

    if (!jobId) return failure(400, 'Processing job is required.')
    if (!['waiting_for_worker', 'processing', 'uploading', 'completed', 'failed', 'cancelled'].includes(status)) {
      return failure(400, 'Invalid processing job status.')
    }

    const updates: Record<string, unknown> = {
      status,
      error_message: message || null,
    }

    if (status === 'waiting_for_worker' || status === 'processing') {
      updates.started_at = new Date().toISOString()
    }
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updates.completed_at = new Date().toISOString()
    }
    if (status === 'failed') updates.attempts = Number(body.attempts || 0) + 1
    if (text(body.result_representation_id || body.resultRepresentationId)) {
      updates.result_representation_id = text(body.result_representation_id || body.resultRepresentationId)
    }

    const { data, error } = await getSupabaseAdmin()
      .from('photo_processing_jobs')
      .update(updates)
      .eq('company_id', source.company_id)
      .eq('source_id', source.id)
      .eq('id', jobId)
      .select('id, status, error_message, attempts, started_at, completed_at, result_representation_id')
      .single()

    if (error) return failure(500, error.message)

    return NextResponse.json({ ok: true, job: data })
  } catch (error: any) {
    return failure(500, error.message || 'Could not update photo processing job.')
  }
}

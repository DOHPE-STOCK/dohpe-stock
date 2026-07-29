import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/serverTenant'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status })
}

async function stationFromToken(token: string) {
  if (!token) return { station: null, error: 'Station token is required.' }
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('company_devices')
    .select('id, company_id, device_key, name, device_type, is_active')
    .eq('station_token', token)
    .eq('is_active', true)
    .maybeSingle()

  if (error) return { station: null, error: error.message }
  if (!data) return { station: null, error: 'Station token was not recognised.' }
  return { station: data, error: null }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const token = String(body?.station_token || '').trim()
  const { station, error } = await stationFromToken(token)
  if (error || !station) return jsonError(error || 'Station not found.', 401)

  const supabase = getSupabaseAdmin()
  const printerPayload = Array.isArray(body?.printers) ? body.printers : []
  await supabase
    .from('company_devices')
    .update({
      last_seen_at: new Date().toISOString(),
      station_capabilities: {
        remote_printer: true,
        printers: printerPayload,
        services: body?.services || {},
      },
      station_last_payload: body && typeof body === 'object' ? body : {},
    })
    .eq('id', station.id)

  const reports = Array.isArray(body?.reports) ? body.reports : []
  for (const report of reports) {
    const jobId = String(report?.id || '').trim()
    if (!jobId) continue
    const status = String(report?.status || '').trim()
    if (!['printed', 'failed', 'printing', 'cancelled'].includes(status)) continue
    await supabase
      .from('remote_print_jobs')
      .update({
        status,
        error_message: report?.error_message || null,
        printed_at: status === 'printed' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('company_id', station.company_id)
  }

  const { data: jobs, error: jobsError } = await supabase
    .from('remote_print_jobs')
    .select('id, printer_name, job_type, document_name, filename, content_base64, content_text, attempts, metadata')
    .eq('company_id', station.company_id)
    .or(`device_id.is.null,device_id.eq.${station.id}`)
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(10)

  if (jobsError) return jsonError(jobsError.message, 500)

  const jobIds = (jobs || []).map((job) => job.id)
  if (jobIds.length) {
    await supabase
      .from('remote_print_jobs')
      .update({
        status: 'claimed',
        claimed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .in('id', jobIds)
      .eq('company_id', station.company_id)
  }

  return NextResponse.json({
    ok: true,
    station: {
      id: station.id,
      company_id: station.company_id,
      name: station.name,
    },
    jobs: jobs || [],
  })
}

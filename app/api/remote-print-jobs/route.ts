import { NextResponse } from 'next/server'
import { getSupabaseAdmin, requireCompanyAccess } from '@/lib/serverTenant'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status })
}

export async function GET(request: Request) {
  const access = await requireCompanyAccess(request)
  if (!access.ok) return jsonError(access.message, access.status)

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('remote_print_jobs')
    .select('id, printer_name, job_type, document_name, filename, status, error_message, attempts, printed_at, created_at, updated_at')
    .eq('company_id', access.company.id)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return jsonError(error.message, 500)
  return NextResponse.json({ ok: true, jobs: data || [] })
}

export async function POST(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member'])
  if (!access.ok) return jsonError(access.message, access.status)

  const body = await request.json().catch(() => ({}))
  const printerName = String(body?.printer_name || '').trim()
  const jobType = String(body?.job_type || 'file_base64').trim()
  const documentName = String(body?.document_name || 'Loopbase Print Job').trim()

  if (!printerName) return jsonError('Printer name is required.')
  if (!['zpl', 'raw_text', 'raw_base64', 'file_base64'].includes(jobType)) {
    return jsonError('Unsupported print job type.')
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('remote_print_jobs')
    .insert({
      company_id: access.company.id,
      requested_by: access.user.id,
      device_id: body?.device_id || null,
      printer_name: printerName,
      job_type: jobType,
      document_name: documentName,
      filename: body?.filename || null,
      content_base64: body?.content_base64 || null,
      content_text: body?.content || body?.content_text || null,
      metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    })
    .select('id, status')
    .single()

  if (error) return jsonError(error.message, 500)
  return NextResponse.json({ ok: true, job: data })
}

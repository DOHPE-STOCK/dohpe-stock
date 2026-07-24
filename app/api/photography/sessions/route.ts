import { NextResponse } from 'next/server'
import {
  companyHasOperationalAccess,
  getSupabaseAdmin,
  requireCompanyAccess,
} from '@/lib/serverTenant'
import { startPhotoSessionForItem, type PhotoStartMethod } from '@/lib/photographyServer'

function failure(status: number, message: string) {
  return NextResponse.json({ ok: false, message }, { status })
}

function text(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
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

    await supabase
      .from('photography_stations')
      .update({ active_photo_session_id: null, last_activity_at: now })
      .eq('company_id', access.company.id)
      .eq('id', stationId)

    return NextResponse.json({ ok: true, session })
  }

  const { data: session, error } = await supabase.rpc('end_photo_session', {
    p_company_id: access.company.id,
    p_station_id: stationId,
  })

  if (error) return failure(500, error.message)

  return NextResponse.json({ ok: true, session })
}

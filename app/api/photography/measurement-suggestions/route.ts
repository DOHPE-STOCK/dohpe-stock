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

const measurementFields = new Set([
  'pit_to_pit_in',
  'collar_to_hem_in',
  'pit_to_cuff_in',
  'sleeve_in',
  'waist_in',
  'inside_leg_in',
  'rise_in',
  'hem_width_in',
])

function parseMeasurement(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

async function staffBelongsToCompany(staffId: string, companyId: string) {
  if (!staffId) return false
  const { data, error } = await getSupabaseAdmin()
    .from('staff_users')
    .select('id')
    .eq('company_id', companyId)
    .eq('id', staffId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return Boolean(data?.id)
}

export async function GET(request: Request) {
  const access = await requireCompanyAccess(request)
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) {
    return failure(402, 'Company subscription is not active.')
  }

  const url = new URL(request.url)
  const itemId = text(url.searchParams.get('item_id'))
  const sessionId = text(url.searchParams.get('session_id'))

  if (!itemId && !sessionId) return failure(400, 'Item or session is required.')

  const supabase = getSupabaseAdmin()
  let query = supabase
    .from('photo_measurement_suggestions')
    .select(
      `id, company_id, item_id, session_id, capture_id, station_id,
      calibration_profile_ids, measurement_type, raw_value_mm, raw_value_in,
      transformation_rule, proposed_value_in, rounding_rule, confidence,
      status, processing_version, metadata, accepted_value_in,
      accepted_by_staff_id, accepted_at, created_at, updated_at,
      session:photo_sessions(id, status, started_at, completed_at),
      capture:photo_captures(id, original_filename, received_at, item_image_id)`
    )
    .eq('company_id', access.company.id)
    .order('created_at', { ascending: false })

  if (itemId) query = query.eq('item_id', itemId)
  if (sessionId) query = query.eq('session_id', sessionId)

  const { data, error } = await query
  if (error) return failure(500, error.message)

  return NextResponse.json({ ok: true, suggestions: data || [] })
}

export async function PATCH(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member'])
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) {
    return failure(402, 'Company subscription is not active.')
  }

  const body = await request.json().catch(() => ({}))
  const suggestionId = text(body.id || body.suggestion_id || body.suggestionId)
  const action = text(body.action || body.status)
  const staffId = text(body.staff_id || body.staffId)

  if (!suggestionId) return failure(400, 'Measurement suggestion is required.')
  if (!['accepted', 'edited', 'rejected'].includes(action)) {
    return failure(400, 'Invalid measurement suggestion action.')
  }

  const supabase = getSupabaseAdmin()
  const { data: suggestion, error: suggestionError } = await supabase
    .from('photo_measurement_suggestions')
    .select('id, company_id, item_id, measurement_type, proposed_value_in, status')
    .eq('company_id', access.company.id)
    .eq('id', suggestionId)
    .maybeSingle()

  if (suggestionError) return failure(500, suggestionError.message)
  if (!suggestion) return failure(404, 'Measurement suggestion not found.')

  const measurementType = text(suggestion.measurement_type)
  if (!measurementFields.has(measurementType)) {
    return failure(400, 'Suggestion measurement type cannot be applied to this item.')
  }

  if (staffId && !(await staffBelongsToCompany(staffId, access.company.id))) {
    return failure(403, 'Selected staff member does not belong to this company.')
  }

  const acceptedValue =
    action === 'rejected'
      ? null
      : parseMeasurement(body.accepted_value_in ?? body.acceptedValueIn ?? suggestion.proposed_value_in)

  if (action !== 'rejected' && acceptedValue === null) {
    return failure(400, 'Accepted measurement value is required.')
  }

  if (action !== 'rejected') {
    const { error: itemError } = await supabase
      .from('items')
      .update({
        [measurementType]: acceptedValue,
      })
      .eq('company_id', access.company.id)
      .eq('id', suggestion.item_id)

    if (itemError) return failure(500, itemError.message)
  }

  const { data, error } = await supabase
    .from('photo_measurement_suggestions')
    .update({
      status: action,
      accepted_value_in: acceptedValue,
      accepted_by_staff_id: staffId || null,
      accepted_at: action === 'rejected' ? null : new Date().toISOString(),
    })
    .eq('company_id', access.company.id)
    .eq('id', suggestion.id)
    .select('*')
    .single()

  if (error) return failure(500, error.message)

  return NextResponse.json({
    ok: true,
    suggestion: data,
    applied_field: action === 'rejected' ? null : measurementType,
    applied_value: action === 'rejected' ? null : acceptedValue,
  })
}

import type { SupabaseClient } from '@supabase/supabase-js'

export type PhotoStartMethod = 'manual_button' | 'barcode_scan' | 'rfid_scan' | 'api'

export function normalizePhotoIdentifier(value: string) {
  return value.trim().replace(/\s+/g, '').toUpperCase()
}

function escapePostgrestOrValue(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')
    .replaceAll(',', '\\,')
}

export function photoSessionSelect() {
  return `id, company_id, station_id, item_id, status, start_method, started_at, ended_at,
  qc_status, qc_notes, completed_at, completed_by_staff_id,
  item:items(id, sku, final_title, ai_title, basic_title, website_title, brand, reporting_category, sub_category, status, review_return_reason, review_return_type, review_returned_at),
  station:photography_stations!photo_sessions_station_id_fkey(id, name, code)`
}

export function photoItemSelect() {
  return 'id, sku, barcode_number, rfid_tid, final_title, ai_title, basic_title, website_title, brand, reporting_category, sub_category, status, review_return_reason, review_return_type, review_returned_at'
}

export async function loadPhotoSession(
  supabase: SupabaseClient,
  companyId: string,
  sessionId: string
) {
  const { data, error } = await supabase
    .from('photo_sessions')
    .select(photoSessionSelect())
    .eq('company_id', companyId)
    .eq('id', sessionId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data
}

export async function findPhotoItemByScan(
  supabase: SupabaseClient,
  companyId: string,
  scanValue: string
) {
  const clean = scanValue.trim()
  const normalized = normalizePhotoIdentifier(clean)
  const safe = escapePostgrestOrValue(clean)
  const safeNormalized = escapePostgrestOrValue(normalized)

  const { data: directRows, error: directError } = await supabase
    .from('items')
    .select(photoItemSelect())
    .eq('company_id', companyId)
    .or(`sku.eq.${safe},barcode_number.eq.${safe},rfid_tid_normalized.eq.${safeNormalized}`)
    .limit(2)

  if (directError) throw new Error(directError.message)
  if ((directRows || []).length === 1) return (directRows?.[0] || null) as any
  if ((directRows || []).length > 1) {
    throw new Error('Scan matched more than one item. Open the item manually.')
  }

  const { data: identifierRows, error: identifierError } = await supabase
    .from('item_identifiers')
    .select('item_id')
    .eq('company_id', companyId)
    .eq('identifier_value_normalized', normalized)
    .eq('is_active', true)
    .limit(2)

  if (identifierError) throw new Error(identifierError.message)
  if ((identifierRows || []).length > 1) {
    throw new Error('Identifier matched more than one item. Open the item manually.')
  }

  const itemId = identifierRows?.[0]?.item_id
  if (!itemId) return null

  const { data: item, error: itemError } = await supabase
    .from('items')
    .select(photoItemSelect())
    .eq('company_id', companyId)
    .eq('id', itemId)
    .maybeSingle()

  if (itemError) throw new Error(itemError.message)
  return (item || null) as any
}

export async function startPhotoSessionForItem(params: {
  supabase: SupabaseClient
  companyId: string
  stationId: string
  itemId: string
  startMethod: PhotoStartMethod
  startedByUserId?: string | null
  startedByStaffId?: string | null
}) {
  const { data: session, error } = await params.supabase.rpc('start_photo_session', {
    p_company_id: params.companyId,
    p_station_id: params.stationId,
    p_item_id: params.itemId,
    p_start_method: params.startMethod,
    p_started_by_user_id: params.startedByUserId || null,
    p_started_by_staff_id: params.startedByStaffId || null,
  })

  if (error) throw new Error(error.message)

  const resolvedSession = Array.isArray(session) ? session[0] : session
  const sessionId = resolvedSession?.id

  if (!sessionId) return resolvedSession || session

  return (await loadPhotoSession(params.supabase, params.companyId, sessionId)) || resolvedSession
}

export async function designatePhotoMeasurementSource(params: {
  supabase: SupabaseClient
  companyId: string
  sessionId: string
  captureId: string
}) {
  const { error } = await params.supabase.rpc('try_designate_photo_measurement_source', {
    p_company_id: params.companyId,
    p_session_id: params.sessionId,
    p_capture_id: params.captureId,
  })

  if (error) console.warn('Photo measurement source designation skipped:', error.message)
}

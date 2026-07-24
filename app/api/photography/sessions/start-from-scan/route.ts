import { NextResponse } from 'next/server'
import {
  companyHasOperationalAccess,
  getSupabaseAdmin,
  requireCompanyAccess,
} from '@/lib/serverTenant'
import {
  findPhotoItemByScan,
  normalizePhotoIdentifier,
  startPhotoSessionForItem,
} from '@/lib/photographyServer'

function failure(status: number, message: string) {
  return NextResponse.json({ ok: false, message }, { status })
}

export async function POST(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member'])
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) {
    return failure(402, 'Company subscription is not active.')
  }

  const body = await request.json().catch(() => ({}))
  const stationId = String(body.station_id || '').trim()
  const scanValue = String(body.scan_value || '').trim()
  const staffId = String(body.staff_id || '').trim() || null

  if (!stationId) return failure(400, 'Station is required.')
  if (!scanValue) return failure(400, 'Scan value is required.')

  const supabase = getSupabaseAdmin()
  const item = await findPhotoItemByScan(supabase, access.company.id, scanValue)

  if (!item?.id) {
    return failure(404, `No item found for scan: ${scanValue}`)
  }

  const normalized = normalizePhotoIdentifier(scanValue)
  const startMethod =
    normalized === normalizePhotoIdentifier(item.rfid_tid || '') ? 'rfid_scan' : 'barcode_scan'

  const session = await startPhotoSessionForItem({
    supabase,
    companyId: access.company.id,
    stationId,
    itemId: item.id,
    startMethod,
    startedByUserId: access.user.id,
    startedByStaffId: staffId,
  })

  return NextResponse.json({
    ok: true,
    item,
    session,
    start_method: startMethod,
  })
}

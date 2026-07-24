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

function commandTypeForPolicy(policy: string) {
  if (policy === 'delete_source_when_product_photo_deleted') return 'delete_source_file'
  if (policy === 'move_source_to_trash_when_product_photo_deleted') return 'move_source_to_trash'
  if (policy === 'move_to_processed') return 'move_source_to_processed'
  return ''
}

export async function POST(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member'])
  if (!access.ok) return failure(access.status, access.message)
  if (!companyHasOperationalAccess(access.company)) {
    return failure(402, 'Company subscription is not active.')
  }

  const body = await request.json().catch(() => ({}))
  const itemImageId = text(body.item_image_id || body.itemImageId)
  const captureId = text(body.capture_id || body.captureId)

  if (!itemImageId && !captureId) return failure(400, 'Image or capture is required.')

  const supabase = getSupabaseAdmin()
  let capture: any = null

  if (captureId || itemImageId) {
    let query = supabase
      .from('photo_captures')
      .select(
        `id, company_id, station_id, session_id, item_id, item_image_id, source_id, sha256, original_filename, exif,
        source:photo_sources(id, source_file_policy)`
      )
      .eq('company_id', access.company.id)
      .limit(1)

    if (captureId) query = query.eq('id', captureId)
    else query = query.eq('item_image_id', itemImageId)

    const { data, error } = await query.maybeSingle()
    if (error) return failure(500, error.message)
    capture = data
  }

  const finalItemImageId = itemImageId || text(capture?.item_image_id)
  if (finalItemImageId) {
    const { error: imageError } = await supabase
      .from('item_images')
      .delete()
      .eq('company_id', access.company.id)
      .eq('id', finalItemImageId)

    if (imageError) return failure(500, imageError.message)
  }

  let queuedCommand = null
  if (capture?.id) {
    const { error: captureError } = await supabase
      .from('photo_captures')
      .update({
        capture_status: 'deleted',
        item_image_id: null,
      })
      .eq('company_id', access.company.id)
      .eq('id', capture.id)

    if (captureError) return failure(500, captureError.message)

    await supabase.rpc('mark_photo_measurement_source_stale', {
      p_company_id: access.company.id,
      p_capture_id: capture.id,
    })

    const source = Array.isArray(capture.source) ? capture.source[0] : capture.source
    const commandType = commandTypeForPolicy(String(source?.source_file_policy || ''))
    if (commandType && capture.source_id) {
      const { data: command, error: commandError } = await supabase
        .from('photo_worker_commands')
        .insert({
          company_id: access.company.id,
          station_id: capture.station_id || null,
          source_id: capture.source_id,
          capture_id: capture.id,
          command_type: commandType,
          created_by: access.user.id,
          payload: {
            remote_capture_id: capture.id,
            sha256: capture.sha256 || null,
            original_filename: capture.original_filename || null,
            storage_path: capture.exif?.storage_path || null,
          },
        })
        .select('id, command_type, status')
        .single()

      if (commandError) return failure(500, commandError.message)
      queuedCommand = command
    }
  }

  return NextResponse.json({
    ok: true,
    deleted_item_image_id: finalItemImageId || null,
    deleted_capture_id: capture?.id || null,
    queued_command: queuedCommand,
  })
}

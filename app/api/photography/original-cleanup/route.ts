import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/serverTenant'
import { loadCompanyPhotoSettings } from '@/lib/photoRetention'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function failure(status: number, message: string) {
  return NextResponse.json({ ok: false, message }, { status })
}

function text(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function authorised(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  return Boolean(process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`)
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) return failure(401, 'Unauthorised.')

  const supabase = getSupabaseAdmin()
  const now = new Date().toISOString()
  const url = new URL(request.url)
  const companyId = text(url.searchParams.get('company_id'))

  let settings = null
  if (companyId) {
    settings = await loadCompanyPhotoSettings(supabase, companyId)
  }

  const limit = settings?.cleanup_batch_limit || 200
  let query = supabase
    .from('item_images')
    .select(
      `id, company_id, item_id, original_url, processed_url,
      original_storage_bucket, original_storage_path, original_delete_after`
    )
    .not('original_url', 'is', null)
    .not('processed_url', 'is', null)
    .not('original_storage_path', 'is', null)
    .is('original_deleted_at', null)
    .lte('original_delete_after', now)
    .limit(limit)

  if (companyId) query = query.eq('company_id', companyId)

  const { data: rows, error } = await query
  if (error) return failure(500, error.message)

  const deleted: any[] = []
  const failed: any[] = []

  for (const row of rows || []) {
    const bucket = text(row.original_storage_bucket) || 'item-images'
    const path = text(row.original_storage_path)

    if (!row.processed_url || !path) {
      failed.push({ id: row.id, message: 'Safety check failed: missing processed image or original path.' })
      continue
    }

    const { error: removeError } = await supabase.storage.from(bucket).remove([path])
    if (removeError) {
      failed.push({ id: row.id, message: removeError.message })
      await supabase
        .from('item_images')
        .update({ original_retention_status: 'delete_failed' })
        .eq('id', row.id)
        .eq('company_id', row.company_id)
      continue
    }

    const { error: updateError } = await supabase
      .from('item_images')
      .update({
        original_url: null,
        original_deleted_at: now,
        original_retention_status: 'deleted',
      })
      .eq('id', row.id)
      .eq('company_id', row.company_id)
      .not('processed_url', 'is', null)

    if (updateError) {
      failed.push({ id: row.id, message: updateError.message })
      continue
    }

    deleted.push({ id: row.id, company_id: row.company_id, path })
  }

  return NextResponse.json({
    ok: failed.length === 0,
    checked: rows?.length || 0,
    deleted_count: deleted.length,
    failed_count: failed.length,
    deleted,
    failed,
  })
}

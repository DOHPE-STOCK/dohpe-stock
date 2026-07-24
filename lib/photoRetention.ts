export type PhotoRetentionSettings = {
  original_retention_days: number
  manual_upload_max_file_mb: number
  manual_upload_max_files: number
  station_upload_max_file_mb: number
  cleanup_batch_limit: number
  raw_storage_policy: 'local_only' | 'cloud_archive_opt_in'
}

export const DEFAULT_PHOTO_RETENTION_SETTINGS: PhotoRetentionSettings = {
  original_retention_days: 14,
  manual_upload_max_file_mb: 20,
  manual_upload_max_files: 20,
  station_upload_max_file_mb: 50,
  cleanup_batch_limit: 200,
  raw_storage_policy: 'local_only',
}

function numberInRange(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

export function mergePhotoRetentionSettings(row: any): PhotoRetentionSettings {
  return {
    original_retention_days: numberInRange(
      row?.original_retention_days,
      DEFAULT_PHOTO_RETENTION_SETTINGS.original_retention_days,
      1,
      3650
    ),
    manual_upload_max_file_mb: numberInRange(
      row?.manual_upload_max_file_mb,
      DEFAULT_PHOTO_RETENTION_SETTINGS.manual_upload_max_file_mb,
      1,
      200
    ),
    manual_upload_max_files: numberInRange(
      row?.manual_upload_max_files,
      DEFAULT_PHOTO_RETENTION_SETTINGS.manual_upload_max_files,
      1,
      200
    ),
    station_upload_max_file_mb: numberInRange(
      row?.station_upload_max_file_mb,
      DEFAULT_PHOTO_RETENTION_SETTINGS.station_upload_max_file_mb,
      1,
      500
    ),
    cleanup_batch_limit: numberInRange(
      row?.cleanup_batch_limit,
      DEFAULT_PHOTO_RETENTION_SETTINGS.cleanup_batch_limit,
      1,
      2000
    ),
    raw_storage_policy:
      row?.raw_storage_policy === 'cloud_archive_opt_in' ? 'cloud_archive_opt_in' : 'local_only',
  }
}

export async function loadCompanyPhotoSettings(supabase: any, companyId: string) {
  const { data, error } = await supabase
    .from('company_photo_settings')
    .select(
      'original_retention_days, manual_upload_max_file_mb, manual_upload_max_files, station_upload_max_file_mb, cleanup_batch_limit, raw_storage_policy'
    )
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return mergePhotoRetentionSettings(data)
}

export function originalDeleteAfterFrom(baseDate: string | Date = new Date(), retentionDays = 14) {
  const base = typeof baseDate === 'string' ? new Date(baseDate) : baseDate
  const safeBase = Number.isNaN(base.getTime()) ? new Date() : base
  const next = new Date(safeBase.getTime())
  next.setUTCDate(next.getUTCDate() + Math.max(1, Math.round(retentionDays)))
  return next.toISOString()
}

export function megabytesToBytes(megabytes: number) {
  return Math.max(1, Math.round(megabytes)) * 1024 * 1024
}

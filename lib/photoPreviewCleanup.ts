function text(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

type CleanupPreviewOptions = {
  supabase: any
  companyId?: string | null
  sessionId?: string | null
  captureIds?: string[]
  excludeRepresentationIds?: string[]
  olderThanHours?: number | null
  limit?: number
}

export type CleanupPreviewResult = {
  checked: number
  deleted_count: number
  skipped_protected_count: number
  failed_count: number
  deleted: Array<{ id: string; company_id: string; storage_path: string | null }>
  skipped_protected: Array<{ id: string; company_id: string; storage_path: string | null }>
  failed: Array<{ id: string; company_id: string; message: string }>
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map(text).filter(Boolean)))
}

function cutoffIso(olderThanHours: number) {
  return new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString()
}

export async function cleanupPhotoPreviewRepresentations({
  supabase,
  companyId,
  sessionId,
  captureIds = [],
  excludeRepresentationIds = [],
  olderThanHours = null,
  limit = 500,
}: CleanupPreviewOptions): Promise<CleanupPreviewResult> {
  const cleanCompanyId = text(companyId)
  const cleanSessionId = text(sessionId)
  const cleanCaptureIds = unique(captureIds)
  const excludedIds = new Set(unique(excludeRepresentationIds))

  let query = supabase
    .from('photo_capture_representations')
    .select('id, company_id, capture_id, item_id, session_id, status, storage_bucket, storage_path, public_url, created_at')
    .eq('status', 'preview')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (cleanCompanyId) query = query.eq('company_id', cleanCompanyId)
  if (cleanSessionId) query = query.eq('session_id', cleanSessionId)
  if (cleanCaptureIds.length > 0) query = query.in('capture_id', cleanCaptureIds)
  if (olderThanHours !== null && Number.isFinite(Number(olderThanHours))) {
    query = query.lte('created_at', cutoffIso(Math.max(1, Number(olderThanHours))))
  }

  const { data: rows, error } = await query
  if (error) throw new Error(error.message)

  const previewRows = (rows || []).filter((row: any) => !excludedIds.has(text(row.id)))
  const companies = unique(previewRows.map((row: any) => row.company_id))
  const itemIds = unique(previewRows.map((row: any) => row.item_id))
  const captureLookupIds = unique(previewRows.map((row: any) => row.capture_id))

  const protectedUrls = new Set<string>()
  const protectedPaths = new Set<string>()

  if (itemIds.length > 0) {
    let imageQuery = supabase
      .from('item_images')
      .select('company_id, item_id, original_url, processed_url, original_storage_path, processed_storage_path')
      .in('item_id', itemIds)

    if (companies.length === 1) imageQuery = imageQuery.eq('company_id', companies[0])
    else if (companies.length > 1) imageQuery = imageQuery.in('company_id', companies)

    const { data: itemImages, error: itemImagesError } = await imageQuery
    if (itemImagesError) throw new Error(itemImagesError.message)

    for (const image of itemImages || []) {
      const originalUrl = text(image.original_url)
      const processedUrl = text(image.processed_url)
      const originalPath = text(image.original_storage_path)
      const processedPath = text(image.processed_storage_path)
      if (originalUrl) protectedUrls.add(originalUrl)
      if (processedUrl) protectedUrls.add(processedUrl)
      if (originalPath) protectedPaths.add(originalPath)
      if (processedPath) protectedPaths.add(processedPath)
    }
  }

  if (captureLookupIds.length > 0) {
    let captureQuery = supabase
      .from('photo_captures')
      .select('company_id, item_image_id')
      .in('id', captureLookupIds)

    if (companies.length === 1) captureQuery = captureQuery.eq('company_id', companies[0])
    else if (companies.length > 1) captureQuery = captureQuery.in('company_id', companies)

    const { data: captures, error: capturesError } = await captureQuery
    if (capturesError) throw new Error(capturesError.message)

    const imageIds = unique((captures || []).map((capture: any) => capture.item_image_id))
    if (imageIds.length > 0) {
      let imageQuery = supabase
        .from('item_images')
        .select('company_id, id, original_url, processed_url, original_storage_path, processed_storage_path')
        .in('id', imageIds)

      if (companies.length === 1) imageQuery = imageQuery.eq('company_id', companies[0])
      else if (companies.length > 1) imageQuery = imageQuery.in('company_id', companies)

      const { data: itemImages, error: itemImagesError } = await imageQuery
      if (itemImagesError) throw new Error(itemImagesError.message)

      for (const image of itemImages || []) {
        const originalUrl = text(image.original_url)
        const processedUrl = text(image.processed_url)
        const originalPath = text(image.original_storage_path)
        const processedPath = text(image.processed_storage_path)
        if (originalUrl) protectedUrls.add(originalUrl)
        if (processedUrl) protectedUrls.add(processedUrl)
        if (originalPath) protectedPaths.add(originalPath)
        if (processedPath) protectedPaths.add(processedPath)
      }
    }
  }

  const deleted: CleanupPreviewResult['deleted'] = []
  const skippedProtected: CleanupPreviewResult['skipped_protected'] = []
  const failed: CleanupPreviewResult['failed'] = []

  for (const row of previewRows) {
    const bucket = text(row.storage_bucket) || 'item-images'
    const storagePath = text(row.storage_path)
    const publicUrl = text(row.public_url)

    if ((storagePath && protectedPaths.has(storagePath)) || (publicUrl && protectedUrls.has(publicUrl))) {
      skippedProtected.push({ id: row.id, company_id: row.company_id, storage_path: storagePath || null })
      continue
    }

    if (storagePath) {
      const { error: removeError } = await supabase.storage.from(bucket).remove([storagePath])
      if (removeError) {
        failed.push({ id: row.id, company_id: row.company_id, message: removeError.message })
        continue
      }
    }

    const { error: deleteError } = await supabase
      .from('photo_capture_representations')
      .delete()
      .eq('company_id', row.company_id)
      .eq('id', row.id)
      .eq('status', 'preview')

    if (deleteError) {
      failed.push({ id: row.id, company_id: row.company_id, message: deleteError.message })
      continue
    }

    deleted.push({ id: row.id, company_id: row.company_id, storage_path: storagePath || null })
  }

  return {
    checked: previewRows.length,
    deleted_count: deleted.length,
    skipped_protected_count: skippedProtected.length,
    failed_count: failed.length,
    deleted,
    skipped_protected: skippedProtected,
    failed,
  }
}

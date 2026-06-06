'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'

type ImportImage = {
  id: string
  group_id: string
  file_name: string
  file_url: string
  sort_order: number
  is_barcode_frame: boolean
  created_at: string
}

type ImportGroup = {
  id: string
  batch_id: string | null
  sku: string
  item_id: string | null
  status: string
  created_at: string
  approved_at: string | null
}

export default function PhotoImportGroupPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [group, setGroup] = useState<ImportGroup | null>(null)
  const [images, setImages] = useState<ImportImage[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [moveToSku, setMoveToSku] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetchGroup()
  }, [id])

  const selectedImages = useMemo(
    () => images.filter((img) => selectedIds.includes(img.id)),
    [images, selectedIds]
  )

  const itemPhotos = useMemo(
    () => images.filter((img) => !img.is_barcode_frame),
    [images]
  )

  const allItemPhotosSelected =
    itemPhotos.length > 0 &&
    itemPhotos.every((img) => selectedIds.includes(img.id))

  async function fetchGroup() {
    setBusy(true)
    setMessage('')

    const { data: groupData, error: groupError } = await supabase
      .from('photo_import_groups')
      .select(`
        id,
        batch_id,
        sku,
        item_id,
        status,
        created_at,
        approved_at
      `)
      .eq('id', id)
      .single()

    if (groupError) {
      setBusy(false)
      setMessage(groupError.message)
      return
    }

    const { data: imageData, error: imageError } = await supabase
      .from('photo_import_images')
      .select(`
        id,
        group_id,
        file_name,
        file_url,
        sort_order,
        is_barcode_frame,
        created_at
      `)
      .eq('group_id', id)
      .order('sort_order', { ascending: true })

    setBusy(false)

    if (imageError) {
      setMessage(imageError.message)
      return
    }

    setGroup(groupData as ImportGroup)
    setImages((imageData || []) as ImportImage[])

    const defaultSelected = (imageData || [])
      .filter((img: ImportImage) => !img.is_barcode_frame)
      .map((img: ImportImage) => img.id)

    setSelectedIds(defaultSelected)
  }

  function toggleImage(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id)
        ? prev.filter((imageId) => imageId !== id)
        : [...prev, id]
    )
  }

  function toggleAllItemPhotos() {
    if (allItemPhotosSelected) {
      setSelectedIds([])
      return
    }

    setSelectedIds(itemPhotos.map((img) => img.id))
  }

  function formatDate(value: string | null) {
    if (!value) return '-'

    return new Date(value).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  async function findItemBySku(sku: string) {
    const { data, error } = await supabase
      .from('items')
      .select('id, sku')
      .eq('sku', sku)
      .maybeSingle()

    if (error) {
      throw new Error(error.message)
    }

    return data
  }

  async function findOrCreateItemBySku(sku: string) {
    const existingItem = await findItemBySku(sku)

    if (existingItem) return existingItem

    const confirmed = window.confirm(
      `SKU ${sku} does not exist in items yet.\n\nCreate item now and attach photos?`
    )

    if (!confirmed) {
      throw new Error('Item does not exist. Approval cancelled.')
    }

    const { data: createdItem, error: createError } = await supabase
      .from('items')
      .insert({
        sku,
        status: 'working',
        stock_level: 1,
        location_status: 'stored',
        current_location: 'WAREHOUSE',
        current_bin: 'Default',
        ebay_status: 'not_listed',
        linnworks_status: 'not_synced',
        shopify_status: 'not_listed',
        square_status: 'not_listed',
        grailed_status: 'not_listed',
        vestiaire_collective_status: 'not_listed',
        whatnot_status: 'not_listed',
        loyverse_status: 'not_listed',
        vinted_status: 'not_listed',
        depop_status: 'not_listed',
        tiktok_shop_status: 'not_listed',
      })
      .select('id, sku')
      .single()

    if (createError) {
      throw new Error(createError.message)
    }

    return createdItem
  }

  async function findOrCreateImportGroupForSku(sku: string) {
    if (!group) throw new Error('No current import group loaded.')

    const existingItem = await findItemBySku(sku)

    const { data: existingGroup, error: existingGroupError } = await supabase
      .from('photo_import_groups')
      .select('id, sku, item_id, status')
      .eq('sku', sku)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingGroupError) {
      throw new Error(existingGroupError.message)
    }

    if (existingGroup) {
      return existingGroup
    }

    const { data: createdGroup, error: createGroupError } = await supabase
      .from('photo_import_groups')
      .insert({
        batch_id: group.batch_id,
        sku,
        item_id: existingItem?.id || null,
        status: 'pending',
      })
      .select('id, sku, item_id, status')
      .single()

    if (createGroupError) {
      throw new Error(createGroupError.message)
    }

    return createdGroup
  }

  async function moveSelectedImagesToSku() {
    if (!group) return

    const sku = moveToSku.trim()

    if (!/^\d{10}$/.test(sku)) {
      setMessage('Enter a valid 10-digit SKU.')
      return
    }

    if (selectedImages.length === 0) {
      setMessage('Select at least one image to move.')
      return
    }

    if (sku === group.sku) {
      setMessage('That is already the current SKU.')
      return
    }

    const confirmed = window.confirm(
      `Move ${selectedImages.length} selected image(s) from SKU ${group.sku} to SKU ${sku}?`
    )

    if (!confirmed) return

    setBusy(true)
    setMessage('Moving selected images...')

    try {
      const targetGroup = await findOrCreateImportGroupForSku(sku)

      const { count, error: countError } = await supabase
        .from('photo_import_images')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', targetGroup.id)

      if (countError) {
        throw new Error(countError.message)
      }

      const startingOrder = count || 0

      const sortedSelected = selectedImages.sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
      )

      for (let index = 0; index < sortedSelected.length; index++) {
        const image = sortedSelected[index]

        const { error: updateError } = await supabase
          .from('photo_import_images')
          .update({
            group_id: targetGroup.id,
            sort_order: startingOrder + index,
          })
          .eq('id', image.id)

        if (updateError) {
          throw new Error(updateError.message)
        }
      }

      setMoveToSku('')
      setSelectedIds([])
      setMessage(
        `Moved ${sortedSelected.length} image(s) to SKU ${sku}.`
      )

      await fetchGroup()
    } catch (error: any) {
      setMessage(error.message || 'Move failed.')
    } finally {
      setBusy(false)
    }
  }

  async function approveSelectedImages() {
    if (!group) return

    if (selectedImages.length === 0) {
      setMessage('Select at least one item photo to approve.')
      return
    }

    const confirmed = window.confirm(
      `Approve ${selectedImages.length} photo(s) for SKU ${group.sku}?`
    )

    if (!confirmed) return

    setBusy(true)
    setMessage('Approving photos...')

    try {
      const item = group.item_id
        ? { id: group.item_id, sku: group.sku }
        : await findOrCreateItemBySku(group.sku)

      const { count, error: countError } = await supabase
        .from('item_images')
        .select('*', { count: 'exact', head: true })
        .eq('item_id', item.id)

      if (countError) {
        throw new Error(countError.message)
      }

      const startingOrder = count || 0

      const imagesToInsert = selectedImages
        .filter((img) => !img.is_barcode_frame)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((img, index) => ({
          item_id: item.id,
          original_url: img.file_url,
          processed_url: img.file_url,
          image_order: startingOrder + index,
        }))

      if (imagesToInsert.length === 0) {
        throw new Error('Only barcode frames were selected. Select item photos.')
      }

      const { error: insertError } = await supabase
        .from('item_images')
        .insert(imagesToInsert)

      if (insertError) {
        throw new Error(insertError.message)
      }

      const approvedAt = new Date().toISOString()

      const { error: groupError } = await supabase
        .from('photo_import_groups')
        .update({
          item_id: item.id,
          status: 'approved',
          approved_at: approvedAt,
        })
        .eq('id', group.id)

      if (groupError) {
        throw new Error(groupError.message)
      }

      setMessage(`Approved ${imagesToInsert.length} photo(s) for SKU ${group.sku}.`)
      await fetchGroup()
    } catch (error: any) {
      setMessage(error.message || 'Approval failed.')
    } finally {
      setBusy(false)
    }
  }

  async function rejectGroup() {
    if (!group) return

    const confirmed = window.confirm(
      `Reject photo import group for SKU ${group.sku}? Photos will stay in storage, but this group will be hidden from pending imports.`
    )

    if (!confirmed) return

    setBusy(true)
    setMessage('Rejecting group...')

    const { error } = await supabase
      .from('photo_import_groups')
      .update({ status: 'rejected' })
      .eq('id', group.id)

    setBusy(false)

    if (error) {
      setMessage(error.message)
      return
    }

    router.push('/photo-imports')
  }

  if (!group) {
    return (
      <StaffPermissionGate permission="working">
        <main className="min-h-screen bg-neutral-950 text-white">
          <div className="p-6">Loading photo import group...</div>
        </main>
      </StaffPermissionGate>
    )
  }

  return (
    <StaffPermissionGate permission="working">
      <main className="min-h-screen bg-neutral-950 text-white">
        <div className="mx-auto max-w-7xl space-y-5 p-4">
          <header className="app-header rounded-3xl bg-black p-4 text-white shadow-2xl sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-black tracking-normal">Photo Import: {group.sku}</h1>

                <p className="text-sm text-neutral-300">
                  Review selected photos before attaching them to the item.
                </p>
              </div>

              <AppNav current="photo-imports" />
            </div>
          </header>

          {message && (
            <div className="rounded-xl border border-yellow-800 bg-yellow-950 p-3 text-sm text-yellow-300">
              {message}
            </div>
          )}

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-bold">SKU: {group.sku}</h2>

                  <span className="rounded-full border border-yellow-800 bg-yellow-950 px-2 py-1 text-xs font-bold uppercase text-yellow-300">
                    {group.status}
                  </span>
                </div>

                <div className="grid gap-2 text-sm text-neutral-300 sm:grid-cols-2">
                  <p>
                    <strong className="text-neutral-500">Created:</strong>{' '}
                    {formatDate(group.created_at)}
                  </p>

                  <p>
                    <strong className="text-neutral-500">Approved:</strong>{' '}
                    {formatDate(group.approved_at)}
                  </p>

                  <p>
                    <strong className="text-neutral-500">Item ID:</strong>{' '}
                    {group.item_id || 'Will match/create by SKU'}
                  </p>

                  <p>
                    <strong className="text-neutral-500">Selected:</strong>{' '}
                    {selectedImages.length} / {images.length}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={approveSelectedImages}
                  disabled={busy || group.status === 'approved'}
                  className="rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
                >
                  Approve Selected
                </button>

                <button
                  onClick={toggleAllItemPhotos}
                  disabled={busy}
                  className="rounded-xl border border-neutral-700 px-4 py-2 text-sm font-bold disabled:opacity-40"
                >
                  {allItemPhotosSelected ? 'Unselect All Photos' : 'Select All Photos'}
                </button>

                <button
                  onClick={rejectGroup}
                  disabled={busy || group.status === 'approved'}
                  className="rounded-xl border border-red-800 bg-red-950 px-4 py-2 text-sm font-bold text-red-300 disabled:opacity-40"
                >
                  Reject Group
                </button>

                <Link
                  href="/photo-imports"
                  className="rounded-xl border border-neutral-700 px-4 py-2 text-center text-sm font-bold"
                >
                  Back to Imports
                </Link>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            <div className="mb-3">
              <h2 className="text-lg font-semibold">Move Selected Images</h2>
              <p className="text-sm text-neutral-400">
                Use this if photos were assigned to the wrong SKU.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={moveToSku}
                onChange={(e) => setMoveToSku(e.target.value)}
                placeholder="Move selected to SKU"
                className="flex-1 rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2 text-sm outline-none focus:border-white"
              />

              <button
                onClick={moveSelectedImagesToSku}
                disabled={busy || selectedImages.length === 0}
                className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-black disabled:opacity-40"
              >
                Move Selected
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            <h2 className="mb-4 text-lg font-semibold">Images</h2>

            {images.length === 0 ? (
              <div className="rounded-xl border border-dashed border-neutral-800 p-8 text-center text-neutral-500">
                No images found for this group.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {images.map((image) => {
                  const selected = selectedIds.includes(image.id)

                  return (
                    <button
                      key={image.id}
                      type="button"
                      onClick={() => toggleImage(image.id)}
                      className={`overflow-hidden rounded-2xl border bg-neutral-950 text-left ${
                        selected ? 'border-white' : 'border-neutral-800'
                      }`}
                    >
                      <div className="relative aspect-square bg-neutral-800">
                        <img
                          src={image.file_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />

                        <div className="absolute left-2 top-2">
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-bold ${
                              selected
                                ? 'bg-white text-black'
                                : 'bg-black/70 text-white'
                            }`}
                          >
                            {selected ? 'Selected' : 'Not selected'}
                          </span>
                        </div>

                        {image.is_barcode_frame && (
                          <div className="absolute bottom-2 left-2">
                            <span className="rounded-full bg-blue-950 px-2 py-1 text-xs font-bold text-blue-300">
                              Barcode frame
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="space-y-1 p-3">
                        <p className="truncate text-sm font-bold">{image.file_name}</p>
                        <p className="text-xs text-neutral-500">
                          Order: {image.sort_order}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </StaffPermissionGate>
  )
}


'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import AppNav from '@/app/components/AppNav'
import { useStaff } from '@/app/context/StaffContext'

export default function PhotosPage() {
  const params = useParams()
  const id = params.id as string

  const { staff } = useStaff()

  const [item, setItem] = useState<any>(null)
  const [images, setImages] = useState<any[]>([])
  const [selectedImage, setSelectedImage] = useState<any>(null)

  const [uploading, setUploading] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)

  const [message, setMessage] = useState('')
  const [hasUnsavedChanges, setHasUnsavedChanges] =
    useState(false)

  const [zoom, setZoom] = useState(1)
  const [rotate, setRotate] = useState(0)
  const [offsetX, setOffsetX] = useState(0)
  const [offsetY, setOffsetY] = useState(0)

  useEffect(() => {
    fetchItem()
    fetchImages()
  }, [id])

  useEffect(() => {
    if (!message) return

    const timer = window.setTimeout(() => {
      setMessage('')
    }, 5000)

    return () => window.clearTimeout(timer)
  }, [message])

  async function touchItemLastSavedBy() {
    if (!staff) return

    await supabase
      .from('items')
      .update({
        last_saved_by: staff.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
  }

  async function fetchItem() {
    const { data } = await supabase
      .from('items')
      .select('*')
      .eq('id', id)
      .single()

    setItem(data)
  }

  async function fetchImages() {
    const { data } = await supabase
      .from('item_images')
      .select('*')
      .eq('item_id', id)
      .order('image_order', { ascending: true })

    const imageList = data || []

    setImages(imageList)

    if (imageList.length > 0) {
      const currentSelectedId = selectedImage?.id

      if (currentSelectedId) {
        const updatedSelected = imageList.find(
          (img) => img.id === currentSelectedId
        )

        setSelectedImage(updatedSelected || imageList[0])
      } else {
        setSelectedImage(imageList[0])
      }
    } else {
      setSelectedImage(null)
    }
  }

  function getImageUrl(image: any) {
    return image?.processed_url || image?.original_url || ''
  }

  function confirmNavigation(url: string) {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm(
        'You have unsaved photo edits. Leave without saving?'
      )

      if (!confirmed) return
    }

    window.location.href = url
  }

  async function uploadFiles(event: any) {
    const files = event.target.files

    if (!files || files.length === 0) return

    setUploading(true)
    setMessage('Uploading...')

    for (let i = 0; i < files.length; i++) {
      const file = files[i]

      const filename =
        `${id}/${Date.now()}-${file.name}`

      const storagePath = `originals/${filename}`

      const { error: uploadError } =
        await supabase.storage
          .from('item-images')
          .upload(storagePath, file)

      if (uploadError) {
        setMessage(uploadError.message)
        continue
      }

      const { data: publicUrlData } =
        supabase.storage
          .from('item-images')
          .getPublicUrl(storagePath)

      await supabase
        .from('item_images')
        .insert({
          item_id: id,
          original_url: publicUrlData.publicUrl,
          image_order: images.length + i + 1,
        })
    }

    await touchItemLastSavedBy()

    setUploading(false)

    setMessage(
      staff
        ? `Upload complete by ${staff.name}`
        : 'Upload complete'
    )

    await fetchImages()
  }

  async function deleteImage(image: any) {
    const confirmed = window.confirm(
      'Delete this image?'
    )

    if (!confirmed) return

    const { error } = await supabase
      .from('item_images')
      .delete()
      .eq('id', image.id)

    if (error) {
      setMessage(error.message)
      return
    }

    await touchItemLastSavedBy()

    if (selectedImage?.id === image.id) {
      setSelectedImage(null)
    }

    setMessage(
      staff
        ? `Image deleted by ${staff.name}`
        : 'Image deleted'
    )

    await fetchImages()
  }

  async function moveImage(
    image: any,
    direction: 'up' | 'down'
  ) {
    const currentIndex = images.findIndex(
      (img) => img.id === image.id
    )

    if (currentIndex === -1) return

    const targetIndex =
      direction === 'up'
        ? currentIndex - 1
        : currentIndex + 1

    if (
      targetIndex < 0 ||
      targetIndex >= images.length
    ) {
      return
    }

    const targetImage = images[targetIndex]

    await supabase
      .from('item_images')
      .update({
        image_order: targetImage.image_order,
      })
      .eq('id', image.id)

    await supabase
      .from('item_images')
      .update({
        image_order: image.image_order,
      })
      .eq('id', targetImage.id)

    await touchItemLastSavedBy()

    setMessage(
      staff
        ? `Image order updated by ${staff.name}`
        : 'Image order updated'
    )

    await fetchImages()
  }

  async function saveProcessedImage() {
    if (!selectedImage) return

    setSavingEdit(true)

    try {
      const sourceUrl =
        getImageUrl(selectedImage)

      const img = new Image()

      img.crossOrigin = 'anonymous'
      img.src = sourceUrl

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()

        img.onerror = () =>
          reject(
            new Error(
              'Could not load image for editing'
            )
          )
      })

      const size = 1600

      const canvas =
        document.createElement('canvas')

      canvas.width = size
      canvas.height = size

      const ctx = canvas.getContext('2d')

      if (!ctx) {
        throw new Error('Canvas error')
      }

      ctx.fillStyle = '#f4f4f4'
      ctx.fillRect(0, 0, size, size)

      ctx.save()

      ctx.translate(
        size / 2 + offsetX,
        size / 2 + offsetY
      )

      ctx.rotate((rotate * Math.PI) / 180)

      const baseScale = Math.max(
        size / img.naturalWidth,
        size / img.naturalHeight
      )

      const finalScale = baseScale * zoom

      ctx.drawImage(
        img,
        -(img.naturalWidth * finalScale) / 2,
        -(img.naturalHeight * finalScale) / 2,
        img.naturalWidth * finalScale,
        img.naturalHeight * finalScale
      )

      ctx.restore()

      const blob = await new Promise<Blob>(
        (resolve, reject) => {
          canvas.toBlob(
            (outputBlob) => {
              if (outputBlob) {
                resolve(outputBlob)
              } else {
                reject(
                  new Error(
                    'Could not export image'
                  )
                )
              }
            },
            'image/jpeg',
            0.85
          )
        }
      )

      const storagePath =
        `processed/${id}/${selectedImage.id}-${Date.now()}.jpg`

      const { error: uploadError } =
        await supabase.storage
          .from('item-images')
          .upload(storagePath, blob, {
            contentType: 'image/jpeg',
          })

      if (uploadError) {
        throw new Error(uploadError.message)
      }

      const { data: publicUrlData } =
        supabase.storage
          .from('item-images')
          .getPublicUrl(storagePath)

      const { error: updateError } =
        await supabase
          .from('item_images')
          .update({
            processed_url:
              publicUrlData.publicUrl,
          })
          .eq('id', selectedImage.id)

      if (updateError) {
        throw new Error(updateError.message)
      }

      const updatedSelectedImage = {
        ...selectedImage,
        processed_url: publicUrlData.publicUrl,
      }

      setSelectedImage(updatedSelectedImage)

      setImages((prev) =>
        prev.map((image) =>
          image.id === selectedImage.id
            ? updatedSelectedImage
            : image
        )
      )

      await touchItemLastSavedBy()

      setMessage(
        staff
          ? `Processed image saved by ${staff.name}`
          : 'Processed image saved'
      )

      setHasUnsavedChanges(false)
    } catch (error: any) {
      setMessage(error.message)
    } finally {
      setSavingEdit(false)
    }
  }

  const selectedImageUrl =
    getImageUrl(selectedImage)

  return (
    <main className="min-h-screen bg-zinc-950 p-5 text-white">
      <div className="mb-5 flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">
              Photos: {item?.sku || 'Loading...'}
            </h1>

            <p className="text-sm text-zinc-400">
              {images.length} image(s)
              {hasUnsavedChanges
                ? ' · Unsaved photo edits'
                : ''}
            </p>

            {staff && (
              <p className="mt-1 text-xs text-green-400">
                Active staff: {staff.name}
              </p>
            )}
          </div>

          <AppNav
            current={undefined}
            onNavigate={confirmNavigation}
          />
        </div>

        <div className="flex items-center gap-3">
          {message && (
            <span className="rounded-lg border border-yellow-700 bg-yellow-950 px-4 py-2 text-sm font-bold text-yellow-300">
              {message}
            </span>
          )}

          <button
            type="button"
            onClick={() =>
              confirmNavigation(`/items/${id}`)
            }
            className="rounded-lg bg-zinc-800 px-5 py-2 text-sm font-bold hover:bg-zinc-700"
          >
            Back to Item
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-zinc-300">
              Upload Images
            </h2>

            <label className="flex h-32 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-zinc-700 bg-zinc-950 text-center hover:border-white">
              <div>
                <p className="text-lg font-bold">
                  Click to upload photos
                </p>

                <p className="mt-1 text-sm text-zinc-400">
                  Multiple images supported
                </p>
              </div>

              <input
                type="file"
                multiple
                accept="image/*"
                onChange={uploadFiles}
                className="hidden"
              />
            </label>

            {uploading && (
              <p className="mt-3 text-sm text-yellow-400">
                Uploading...
              </p>
            )}
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-300">
                Gallery
              </h2>
            </div>

            {images.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-700 p-10 text-center text-zinc-500">
                No images uploaded yet
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
                {images.map((image, index) => {
                  const imageUrl =
                    getImageUrl(image)

                  const isSelected =
                    selectedImage?.id === image.id

                  return (
                    <div
                      key={image.id}
                      className={`relative overflow-hidden rounded-xl border bg-zinc-950 ${
                        isSelected
                          ? 'border-white'
                          : 'border-zinc-700'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedImage(image)
                        }
                        className="block w-full"
                      >
                        <img
                          src={imageUrl}
                          alt="Item photo"
                          className="aspect-square w-full object-cover"
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          deleteImage(image)
                        }
                        className="absolute right-2 top-2 rounded bg-red-600 px-2 py-1 text-xs font-black text-white shadow"
                        title="Delete image"
                      >
                        🗑
                      </button>

                      <div className="space-y-2 p-2 text-xs text-zinc-400">
                        <p>
                          Order:{' '}
                          {image.image_order}
                        </p>

                        <div className="grid grid-cols-2 gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              moveImage(
                                image,
                                'up'
                              )
                            }
                            disabled={index === 0}
                            className="rounded bg-zinc-800 px-2 py-1 text-white disabled:opacity-30"
                          >
                            ↑
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              moveImage(
                                image,
                                'down'
                              )
                            }
                            disabled={
                              index ===
                              images.length - 1
                            }
                            className="rounded bg-zinc-800 px-2 py-1 text-white disabled:opacity-30"
                          >
                            ↓
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">
              Crop / Rotate Editor
            </h2>

            {!selectedImage ? (
              <div className="flex h-80 items-center justify-center rounded-lg border border-dashed border-zinc-700 bg-zinc-950 text-center text-sm text-zinc-500">
                Select an image to edit
              </div>
            ) : (
              <>
                <div className="relative aspect-square overflow-hidden rounded-lg border border-zinc-700 bg-[#f4f4f4]">
                  <img
                    src={selectedImageUrl}
                    alt="Selected edit preview"
                    className="absolute left-1/2 top-1/2 max-h-none max-w-none"
                    style={{
                      transform: `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px)) rotate(${rotate}deg) scale(${zoom})`,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                </div>

                <div className="mt-4 space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold text-zinc-400">
                      Fine Rotate:{' '}
                      {rotate.toFixed(1)}°
                    </span>

                    <input
                      type="range"
                      min="-15"
                      max="15"
                      step="0.1"
                      value={rotate}
                      onChange={(e) => {
                        setRotate(
                          Number(e.target.value)
                        )

                        setHasUnsavedChanges(
                          true
                        )
                      }}
                      className="w-full"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs font-bold text-zinc-400">
                      Zoom
                    </span>

                    <input
                      type="range"
                      min="0.7"
                      max="2"
                      step="0.01"
                      value={zoom}
                      onChange={(e) => {
                        setZoom(
                          Number(e.target.value)
                        )

                        setHasUnsavedChanges(
                          true
                        )
                      }}
                      className="w-full"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-1 block text-xs font-bold text-zinc-400">
                        Move X
                      </span>

                      <input
                        type="range"
                        min="-150"
                        max="150"
                        step="1"
                        value={offsetX}
                        onChange={(e) => {
                          setOffsetX(
                            Number(e.target.value)
                          )

                          setHasUnsavedChanges(
                            true
                          )
                        }}
                        className="w-full"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-xs font-bold text-zinc-400">
                        Move Y
                      </span>

                      <input
                        type="range"
                        min="-150"
                        max="150"
                        step="1"
                        value={offsetY}
                        onChange={(e) => {
                          setOffsetY(
                            Number(e.target.value)
                          )

                          setHasUnsavedChanges(
                            true
                          )
                        }}
                        className="w-full"
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRotate(
                          rotate - 90
                        )

                        setHasUnsavedChanges(
                          true
                        )
                      }}
                      className="rounded-lg bg-zinc-800 px-3 py-2 text-sm font-bold hover:bg-zinc-700"
                    >
                      Rotate Left 90°
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setRotate(
                          rotate + 90
                        )

                        setHasUnsavedChanges(
                          true
                        )
                      }}
                      className="rounded-lg bg-zinc-800 px-3 py-2 text-sm font-bold hover:bg-zinc-700"
                    >
                      Rotate Right 90°
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setZoom(1)
                        setRotate(0)
                        setOffsetX(0)
                        setOffsetY(0)

                        setHasUnsavedChanges(
                          true
                        )
                      }}
                      className="rounded-lg bg-zinc-800 px-3 py-2 text-sm font-bold hover:bg-zinc-700"
                    >
                      Reset Edit
                    </button>

                    <button
                      type="button"
                      onClick={saveProcessedImage}
                      disabled={savingEdit}
                      className="rounded-lg bg-green-600 px-3 py-2 text-sm font-bold hover:bg-green-500 disabled:opacity-50"
                    >
                      {savingEdit
                        ? 'Saving...'
                        : 'Save Processed'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        </aside>
      </div>
    </main>
  )
}
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { useCompany } from '@/app/context/CompanyContext'

type ImportImage = {
  id: string
  file_url: string
  is_barcode_frame: boolean
  sort_order: number
}

type ImportGroup = {
  id: string
  batch_id: string | null
  sku: string
  item_id: string | null
  status: string
  created_at: string
  approved_at: string | null
  photo_import_images?: ImportImage[]
}

type StatusFilter = 'pending' | 'approved' | 'all'

export default function PhotoImportsPage() {
  const { activeCompanyId, schemaReady } = useCompany()
  const [groups, setGroups] = useState<ImportGroup[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchGroups()
  }, [statusFilter, activeCompanyId, schemaReady])

  async function fetchGroups() {
    setLoading(true)
    setMessage('')

    let query = supabase
      .from('photo_import_groups')
      .select(`
        id,
        batch_id,
        sku,
        item_id,
        status,
        created_at,
        approved_at,
        photo_import_images (
          id,
          file_url,
          is_barcode_frame,
          sort_order
        )
      `)
      .order('created_at', { ascending: false })

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter)
    }

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data, error } = await query

    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setGroups((data || []) as ImportGroup[])
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

  function getCounts(group: ImportGroup) {
    const images = group.photo_import_images || []
    const barcodeFrames = images.filter((img) => img.is_barcode_frame).length
    const itemPhotos = images.filter((img) => !img.is_barcode_frame).length

    return {
      total: images.length,
      barcodeFrames,
      itemPhotos,
    }
  }

  function statusClass(status: string) {
    if (status === 'approved') {
      return 'border-green-800 bg-green-950 text-green-300'
    }

    if (status === 'rejected') {
      return 'border-red-800 bg-red-950 text-red-300'
    }

    return 'border-yellow-800 bg-yellow-950 text-yellow-300'
  }

  return (
    <StaffPermissionGate permission="working">
      <main className="min-h-screen bg-neutral-950 p-5 text-white">
        <div className="app-header mb-5 flex flex-wrap items-start justify-between gap-4 rounded-3xl bg-black p-4 text-white shadow-2xl sm:p-5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
            <div>
              <h1 className="text-2xl font-black tracking-normal">Photo Imports</h1>

              <p className="text-sm text-neutral-300">
                Review barcode-first photo groups before attaching them to items.
              </p>
            </div>

            <AppNav current="photo-imports" />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {message && (
              <span className="rounded-lg border border-yellow-800 bg-yellow-950 px-4 py-2 text-sm font-bold text-yellow-300">
                {message}
              </span>
            )}

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-white"
            >
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="all">All</option>
            </select>

            <button
              onClick={fetchGroups}
              disabled={loading}
              className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        <section className="mb-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="text-lg font-semibold">Import Groups</h2>

          <p className="text-sm text-neutral-400">
            Pending groups are ready to be checked and approved.
          </p>
        </section>

        {groups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-900 p-8 text-center text-neutral-500">
            No photo import groups found.
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => {
              const counts = getCounts(group)
              const previewImage =
                (group.photo_import_images || [])
                  .filter((img) => !img.is_barcode_frame)
                  .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0] ||
                (group.photo_import_images || [])[0]

              return (
                <section
                  key={group.id}
                  className="w-full rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
                >
                  <div className="grid gap-4 lg:grid-cols-[110px_1fr_180px]">
                    <div className="h-28 w-28 overflow-hidden rounded-xl bg-neutral-800">
                      {previewImage?.file_url ? (
                        <img
                          src={previewImage.file_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-neutral-500">
                          No image
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-bold">SKU: {group.sku}</h2>

                        <span
                          className={`rounded-full border px-2 py-1 text-xs font-bold uppercase ${statusClass(
                            group.status
                          )}`}
                        >
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
                          {group.item_id || 'Will match by SKU'}
                        </p>

                        <p>
                          <strong className="text-neutral-500">Batch:</strong>{' '}
                          {group.batch_id || '-'}
                        </p>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-neutral-950 px-3 py-1 text-neutral-300">
                          Total images: {counts.total}
                        </span>

                        <span className="rounded-full bg-blue-950 px-3 py-1 text-blue-300">
                          Item photos: {counts.itemPhotos}
                        </span>

                        <span className="rounded-full bg-neutral-950 px-3 py-1 text-neutral-300">
                          Barcode frames: {counts.barcodeFrames}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col justify-center gap-2">
                      <Link
                        href={`/photo-imports/${group.id}`}
                        className="rounded-xl bg-white px-4 py-2 text-center text-sm font-bold text-black"
                      >
                        Open Group
                      </Link>
                    </div>
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </main>
    </StaffPermissionGate>
  )
}


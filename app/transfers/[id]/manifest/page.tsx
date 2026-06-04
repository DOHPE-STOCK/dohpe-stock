'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import QRCode from 'react-qr-code'
import { supabase } from '@/lib/supabase'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'

type TransferItem = {
  id: string
  sku: string
  status: string
  items?: {
    id: string
    reporting_category: string | null
  } | null
}

type Transfer = {
  id: string
  transfer_number: number
  from_location: string
  to_location: string
  status: string
  reason: string | null
  created_at: string
  stock_transfer_items: TransferItem[]
}

function formatTransferNumber(num: number) {
  return String(num).padStart(7, '0')
}

function isManifestItem(item: TransferItem) {
  return !['cancelled', 'canceled', 'missing'].includes(String(item.status || '').toLowerCase())
}

export default function TransferManifestPage() {
  const params = useParams()
  const id = params.id as string

  const [transfer, setTransfer] = useState<Transfer | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTransfer()
  }, [id])

  async function fetchTransfer() {
    setLoading(true)

    const { data } = await supabase
      .from('stock_transfers')
      .select(`
        id,
        transfer_number,
        from_location,
        to_location,
        status,
        reason,
        created_at,
        stock_transfer_items (
          id,
          sku,
          status,
          items (
            id,
            reporting_category
          )
        )
      `)
      .eq('id', id)
      .single()

    setTransfer(data as any)
    setLoading(false)

    setTimeout(() => {
      window.print()
    }, 700)
  }

  if (loading || !transfer) {
    return (
      <StaffPermissionGate permission="scanner">
        <main className="flex min-h-screen items-center justify-center bg-white text-black">
          Loading manifest...
        </main>
      </StaffPermissionGate>
    )
  }

  const transferUrl = `${window.location.origin}/transfers/${transfer.id}`
  const activeItems = (transfer.stock_transfer_items || []).filter(isManifestItem)
  const cancelledCount = (transfer.stock_transfer_items || []).length - activeItems.length
  const totalCount = activeItems.length

  const categoryCounts = activeItems.reduce(
    (acc: Record<string, number>, transferItem) => {
      const category = transferItem.items?.reporting_category || 'Uncategorised'
      acc[category] = (acc[category] || 0) + 1
      return acc
    },
    {}
  )

  const skuCounts = activeItems.reduce((acc: Record<string, number>, transferItem) => {
    acc[transferItem.sku] = (acc[transferItem.sku] || 0) + 1
    return acc
  }, {})

  const sortedCategoryCounts = Object.entries(categoryCounts).sort(([a], [b]) =>
    a.localeCompare(b)
  )

  const sortedSkuCounts = Object.entries(skuCounts).sort(([a], [b]) => a.localeCompare(b))

  return (
    <StaffPermissionGate permission="scanner">
      <main className="min-h-screen bg-white p-8 text-black">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8 flex items-start justify-between border-b-4 border-black pb-6">
            <div>
              <h1 className="text-5xl font-black tracking-tight">TRANSFER MANIFEST</h1>

              <p className="mt-4 text-3xl font-black">
                #{formatTransferNumber(transfer.transfer_number)}
              </p>

              <div className="mt-4 space-y-1 text-xl">
                <p>
                  <strong>FROM:</strong> {transfer.from_location}
                </p>

                <p>
                  <strong>TO:</strong> {transfer.to_location}
                </p>

                <p>
                  <strong>STATUS:</strong> {transfer.status}
                </p>

                {transfer.reason && (
                  <p>
                    <strong>REASON:</strong> {transfer.reason}
                  </p>
                )}

                <p className="text-3xl font-black">TOTAL ITEMS: {totalCount}</p>

                {cancelledCount > 0 && (
                  <p className="text-lg font-black text-red-700">
                    CANCELLED/REMOVED ITEMS EXCLUDED: {cancelledCount}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-xl border-4 border-black bg-white p-4">
              <QRCode value={transferUrl} size={180} />

              <p className="mt-3 text-center text-sm font-bold">Scan to open transfer</p>
            </div>
          </div>

          <section>
            <h2 className="mb-4 text-3xl font-black">Category Summary</h2>

            <div className="space-y-3">
              {sortedCategoryCounts.map(([category, count]) => (
                <div
                  key={category}
                  className="flex items-center justify-between border-2 border-black p-4"
                >
                  <p className="text-2xl font-black">{category}</p>
                  <p className="text-3xl font-black">{count}x</p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-8">
            <h2 className="mb-4 text-3xl font-black">SKU Pick List</h2>

            <div className="space-y-2">
              {sortedSkuCounts.map(([sku, count]) => (
                <div
                  key={sku}
                  className="flex items-center justify-between border-2 border-black p-3"
                >
                  <p className="text-xl font-black">{sku}</p>
                  <p className="text-2xl font-black">{count}x</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </StaffPermissionGate>
  )
}


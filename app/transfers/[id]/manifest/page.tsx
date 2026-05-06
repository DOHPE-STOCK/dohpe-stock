'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import QRCode from 'react-qr-code'
import { supabase } from '@/lib/supabase'

type TransferItem = {
  id: string
  sku: string
  status: string
  items?: {
    id: string
    brand: string | null
    reporting_category: string | null
    colour_primary: string | null
    tagged_size: string | null
    waist_in: string | number | null
    ai_title: string | null
    basic_title: string | null
  } | null
}

type Transfer = {
  id: string
  transfer_number: number
  from_location: string
  to_location: string
  created_at: string
  stock_transfer_items: TransferItem[]
}

function formatTransferNumber(num: number) {
  return String(num).padStart(7, '0')
}

function getSizeText(item: any) {
  if (
    item?.waist_in !== null &&
    item?.waist_in !== undefined &&
    item?.waist_in !== ''
  ) {
    return `W${item.waist_in}"`
  }

  return item?.tagged_size || ''
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
        created_at,
        stock_transfer_items (
          id,
          sku,
          status,
          items (
            id,
            brand,
            reporting_category,
            colour_primary,
            tagged_size,
            waist_in,
            ai_title,
            basic_title
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
      <main className="flex min-h-screen items-center justify-center bg-white text-black">
        Loading manifest...
      </main>
    )
  }

  const transferUrl = `${window.location.origin}/transfers/${transfer.id}`

  return (
    <main className="min-h-screen bg-white p-8 text-black">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-start justify-between border-b-4 border-black pb-6">
          <div>
            <h1 className="text-5xl font-black tracking-tight">
              TRANSFER MANIFEST
            </h1>

            <p className="mt-4 text-3xl font-black">
              #{formatTransferNumber(transfer.transfer_number)}
            </p>

            <div className="mt-4 space-y-1 text-lg">
              <p>
                <strong>FROM:</strong> {transfer.from_location}
              </p>

              <p>
                <strong>TO:</strong> {transfer.to_location}
              </p>

              <p>
                <strong>ITEM COUNT:</strong>{' '}
                {transfer.stock_transfer_items.length}
              </p>
            </div>
          </div>

          <div className="rounded-xl border-4 border-black bg-white p-4">
            <QRCode
              value={transferUrl}
              size={180}
            />

            <p className="mt-3 text-center text-sm font-bold">
              Scan to open transfer
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {transfer.stock_transfer_items.map((transferItem, index) => {
            const item = transferItem.items

            return (
              <div
                key={transferItem.id}
                className="grid grid-cols-[60px_160px_1fr_140px] gap-4 border border-black p-3"
              >
                <div className="flex items-center justify-center text-xl font-black">
                  {index + 1}
                </div>

                <div>
                  <p className="font-mono text-lg font-black">
                    {transferItem.sku}
                  </p>

                  <p className="mt-1 text-xs uppercase">
                    {transferItem.status}
                  </p>
                </div>

                <div className="min-w-0">
                  <p className="truncate text-lg font-bold">
                    {item?.ai_title ||
                      item?.basic_title ||
                      'Untitled Item'}
                  </p>

                  <p className="mt-1 text-sm">
                    {item?.brand || 'No brand'} ·{' '}
                    {item?.reporting_category || 'No category'} ·{' '}
                    {item?.colour_primary || 'No colour'} ·{' '}
                    {getSizeText(item) || 'No size'}
                  </p>
                </div>

                <div className="flex items-center justify-center">
                  <div className="h-10 w-10 rounded-full border-2 border-black" />
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-10 grid grid-cols-2 gap-8">
          <div>
            <p className="mb-12 text-sm font-bold">
              SENT BY:
            </p>

            <div className="border-b-2 border-black" />
          </div>

          <div>
            <p className="mb-12 text-sm font-bold">
              RECEIVED BY:
            </p>

            <div className="border-b-2 border-black" />
          </div>
        </div>
      </div>
    </main>
  )
}
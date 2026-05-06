'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import AppNav from '@/app/components/AppNav'
import { useStaff } from '@/app/context/StaffContext'

type TransferItem = {
  id: string
  item_id: string | null
  sku: string
  status: string
}

type Transfer = {
  id: string
  transfer_number: number
  from_location: string
  to_location: string
  status: string
  created_at: string
  sent_at: string | null
  received_at: string | null
  stock_transfer_items?: TransferItem[]
}

type TimePeriod = '7days' | 'month' | 'year'

export default function TransfersPage() {
  const { staff } = useStaff()

  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('month')

  useEffect(() => {
    fetchTransfers(timePeriod)
  }, [timePeriod])

  function getStartDate(period: TimePeriod) {
    const date = new Date()

    if (period === '7days') date.setDate(date.getDate() - 7)
    if (period === 'month') date.setMonth(date.getMonth() - 1)
    if (period === 'year') date.setFullYear(date.getFullYear() - 1)

    return date.toISOString()
  }

  function getPeriodLabel(period: TimePeriod) {
    if (period === '7days') return 'last 7 days'
    if (period === 'month') return 'last month'
    return 'last year'
  }

  async function fetchTransfers(period: TimePeriod = timePeriod) {
    setLoading(true)
    setMessage('')

    const { data, error } = await supabase
      .from('stock_transfers')
      .select(`
        id,
        transfer_number,
        from_location,
        to_location,
        status,
        created_at,
        sent_at,
        received_at,
        stock_transfer_items (
          id,
          item_id,
          sku,
          status
        )
      `)
      .gte('created_at', getStartDate(period))
      .order('created_at', { ascending: false })

    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setTransfers((data || []) as Transfer[])
  }

  function getCounts(transfer: Transfer) {
    const items = transfer.stock_transfer_items || []

    return {
      total: items.length,
      received: items.filter((item) => item.status === 'received').length,
      missing: items.filter((item) => item.status === 'missing').length,
      inTransfer: items.filter((item) => item.status === 'in_transfer').length,
    }
  }

  function statusClass(status: string) {
    if (status === 'received') {
      return 'bg-green-950 text-green-300 border-green-800'
    }

    if (status === 'part_received') {
      return 'bg-yellow-950 text-yellow-300 border-yellow-800'
    }

    if (status === 'cancelled') {
      return 'bg-red-950 text-red-300 border-red-800'
    }

    return 'bg-blue-950 text-blue-300 border-blue-800'
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

  async function markTransferReceived(transfer: Transfer) {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    const items = transfer.stock_transfer_items || []
    const receivableItems = items.filter((item) => item.status === 'in_transfer')

    if (receivableItems.length === 0) {
      setMessage('No in-transfer items to receive.')
      return
    }

    const confirmed = window.confirm(
      `Accept transfer #${transfer.transfer_number} by ${staff.name}?\n\nThis will mark ${receivableItems.length} item(s) as received into ${transfer.to_location}.`
    )

    if (!confirmed) return

    setLoading(true)
    setMessage('Receiving transfer...')

    const itemIds = receivableItems
      .map((item) => item.item_id)
      .filter(Boolean) as string[]

    const transferItemIds = receivableItems.map((item) => item.id)
    const receivedAt = new Date().toISOString()

    const { error: transferItemsError } = await supabase
      .from('stock_transfer_items')
      .update({
        status: 'received',
        received_at: receivedAt,
      })
      .in('id', transferItemIds)

    if (transferItemsError) {
      setLoading(false)
      setMessage(transferItemsError.message)
      return
    }

    if (itemIds.length > 0) {
      const { error: itemsError } = await supabase
        .from('items')
        .update({
          location_status: 'received',
          current_location: transfer.to_location,
          current_bin: transfer.to_location,
          last_saved_by: staff.id,
          updated_at: receivedAt,
        })
        .in('id', itemIds)

      if (itemsError) {
        setLoading(false)
        setMessage(itemsError.message)
        return
      }
    }

    const { error: transferError } = await supabase
      .from('stock_transfers')
      .update({
        status: 'received',
        received_at: receivedAt,
        received_by: staff.id,
      })
      .eq('id', transfer.id)

    if (transferError) {
      setLoading(false)
      setMessage(transferError.message)
      return
    }

    setMessage(`Transfer #${transfer.transfer_number} received by ${staff.name}.`)
    await fetchTransfers()
    setLoading(false)
  }

  return (
    <main className="min-h-screen bg-neutral-950 p-5 text-white">
      <div className="mb-5 flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">Stock Transfers</h1>

            <p className="text-sm text-neutral-400">
              View and receive warehouse/shop stock transfers.
            </p>

            {staff ? (
              <p className="mt-1 text-sm font-bold text-green-300">
                Active staff: {staff.name}
              </p>
            ) : (
              <p className="mt-1 text-sm font-bold text-yellow-300">
                No active staff selected
              </p>
            )}
          </div>

          <AppNav current="transfers" />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {message && (
            <span className="rounded-lg border border-yellow-800 bg-yellow-950 px-4 py-2 text-sm font-bold text-yellow-300">
              {message}
            </span>
          )}

          <select
            value={timePeriod}
            onChange={(e) => setTimePeriod(e.target.value as TimePeriod)}
            className="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-white"
          >
            <option value="7days">Last 7 days</option>
            <option value="month">Last month</option>
            <option value="year">Last year</option>
          </select>

          <button
            onClick={() => fetchTransfers()}
            disabled={loading}
            className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <section className="mb-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="text-lg font-semibold">Transfer History</h2>
        <p className="text-sm text-neutral-400">
          Showing transfers from the {getPeriodLabel(timePeriod)}.
        </p>
      </section>

      {transfers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-900 p-8 text-center text-neutral-500">
          No stock transfers found for the {getPeriodLabel(timePeriod)}.
        </div>
      ) : (
        <div className="space-y-3">
          {transfers.map((transfer) => {
            const counts = getCounts(transfer)
            const isReceived = transfer.status === 'received'

            return (
              <section
                key={transfer.id}
                className="w-full rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
              >
                <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
                  <div>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-bold">
                        Transfer #{transfer.transfer_number}
                      </h2>

                      <span
                        className={`rounded-full border px-2 py-1 text-xs font-bold uppercase ${statusClass(
                          transfer.status
                        )}`}
                      >
                        {transfer.status.replace('_', ' ')}
                      </span>
                    </div>

                    <div className="grid gap-2 text-sm text-neutral-300 sm:grid-cols-2">
                      <p>
                        <strong className="text-neutral-500">From:</strong>{' '}
                        {transfer.from_location}
                      </p>

                      <p>
                        <strong className="text-neutral-500">To:</strong>{' '}
                        {transfer.to_location}
                      </p>

                      <p>
                        <strong className="text-neutral-500">Created:</strong>{' '}
                        {formatDate(transfer.created_at)}
                      </p>

                      <p>
                        <strong className="text-neutral-500">Received:</strong>{' '}
                        {formatDate(transfer.received_at)}
                      </p>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-neutral-950 px-3 py-1 text-neutral-300">
                        Total: {counts.total}
                      </span>

                      <span className="rounded-full bg-blue-950 px-3 py-1 text-blue-300">
                        In transfer: {counts.inTransfer}
                      </span>

                      <span className="rounded-full bg-green-950 px-3 py-1 text-green-300">
                        Received: {counts.received}
                      </span>

                      {counts.missing > 0 && (
                        <span className="rounded-full bg-red-950 px-3 py-1 text-red-300">
                          Missing: {counts.missing}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col justify-center gap-2">
                    <Link
                      href={`/transfers/${transfer.id}`}
                      className="rounded-xl bg-white px-4 py-2 text-center text-sm font-bold text-black"
                    >
                      Open Transfer
                    </Link>

                    <button
                      onClick={() => markTransferReceived(transfer)}
                      disabled={
                        loading || !staff || isReceived || counts.inTransfer === 0
                      }
                      className="rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
                    >
                      Mark as Received
                    </button>
                  </div>
                </div>
              </section>
            )
          })}
        </div>
      )}
    </main>
  )
}
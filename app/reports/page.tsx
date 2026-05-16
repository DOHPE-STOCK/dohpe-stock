'use client'

import { useEffect, useMemo, useState } from 'react'
import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { supabase } from '@/lib/supabase'

type StaffUser = {
  id: string
  name: string
}

type ReviewItem = {
  id: string
  sku: string
  status: string
  sent_to_review_at: string | null
  sent_to_review_by: string | null
  last_saved_by: string | null
}

type StaffReportRow = {
  staffId: string
  staffName: string
  todayCount: number
  weekCount: number
  monthCount: number
  totalCount: number
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function startOfWeek() {
  const d = startOfToday()
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

function startOfMonth() {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

function formatDateTime(value: string | null) {
  if (!value) return '-'

  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function isOnOrAfter(value: string | null, date: Date) {
  if (!value) return false
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return false
  return parsed >= date
}

export default function ReportsPage() {
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([])
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [historyDays, setHistoryDays] = useState(14)

  useEffect(() => {
    fetchReports()
  }, [])

  async function fetchReports() {
    setLoading(true)
    setMessage('')

    const { data: staffData, error: staffError } = await supabase
      .from('staff_users')
      .select('id, name')
      .order('name', { ascending: true })

    if (staffError) {
      setMessage(staffError.message)
      setLoading(false)
      return
    }

    const { data: itemData, error: itemError } = await supabase
      .from('items')
      .select('id, sku, status, sent_to_review_at, sent_to_review_by, last_saved_by')
      .not('sent_to_review_at', 'is', null)
      .order('sent_to_review_at', { ascending: false })
      .limit(1000)

    if (itemError) {
      setMessage(itemError.message)
      setLoading(false)
      return
    }

    setStaffUsers(staffData || [])
    setReviewItems(itemData || [])
    setLoading(false)
  }

  const staffNameById = useMemo(() => {
    const map: Record<string, string> = {}

    for (const staff of staffUsers) {
      map[staff.id] = staff.name
    }

    return map
  }, [staffUsers])

  const staffReportRows = useMemo(() => {
    const today = startOfToday()
    const week = startOfWeek()
    const month = startOfMonth()

    const rows: Record<string, StaffReportRow> = {}

    for (const staff of staffUsers) {
      rows[staff.id] = {
        staffId: staff.id,
        staffName: staff.name,
        todayCount: 0,
        weekCount: 0,
        monthCount: 0,
        totalCount: 0,
      }
    }

    for (const item of reviewItems) {
      const staffId = item.sent_to_review_by || 'unknown'

      if (!rows[staffId]) {
        rows[staffId] = {
          staffId,
          staffName: staffNameById[staffId] || 'Unknown staff',
          todayCount: 0,
          weekCount: 0,
          monthCount: 0,
          totalCount: 0,
        }
      }

      rows[staffId].totalCount += 1

      if (isOnOrAfter(item.sent_to_review_at, today)) {
        rows[staffId].todayCount += 1
      }

      if (isOnOrAfter(item.sent_to_review_at, week)) {
        rows[staffId].weekCount += 1
      }

      if (isOnOrAfter(item.sent_to_review_at, month)) {
        rows[staffId].monthCount += 1
      }
    }

    return Object.values(rows)
      .filter((row) => row.totalCount > 0 || row.todayCount > 0)
      .sort((a, b) => b.todayCount - a.todayCount || b.weekCount - a.weekCount)
  }, [reviewItems, staffUsers, staffNameById])

  const historyItems = useMemo(() => {
    const since = new Date()
    since.setDate(since.getDate() - historyDays)
    since.setHours(0, 0, 0, 0)

    return reviewItems.filter((item) => isOnOrAfter(item.sent_to_review_at, since))
  }, [reviewItems, historyDays])

  const historyByDate = useMemo(() => {
    const grouped: Record<string, Record<string, number>> = {}

    for (const item of historyItems) {
      if (!item.sent_to_review_at) continue

      const dateKey = new Date(item.sent_to_review_at).toLocaleDateString('en-GB', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
      })

      const staffId = item.sent_to_review_by || 'unknown'
      const staffName = staffNameById[staffId] || 'Unknown staff'

      if (!grouped[dateKey]) grouped[dateKey] = {}
      grouped[dateKey][staffName] = (grouped[dateKey][staffName] || 0) + 1
    }

    return grouped
  }, [historyItems, staffNameById])

  const totalToday = staffReportRows.reduce((sum, row) => sum + row.todayCount, 0)
  const totalWeek = staffReportRows.reduce((sum, row) => sum + row.weekCount, 0)
  const totalMonth = staffReportRows.reduce((sum, row) => sum + row.monthCount, 0)

  return (
    <StaffPermissionGate permission="reports">
      <main className="min-h-screen bg-zinc-950 p-5 text-white">
        <div className="mb-5 flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold">Reports</h1>
              <p className="text-sm text-zinc-400">
                Staff output, sales reports, and profit/loss reports
              </p>
            </div>

            <AppNav current={undefined} />
          </div>

          <div className="flex items-center gap-3">
            {message && (
              <span className="rounded-lg border border-yellow-700 bg-yellow-950 px-4 py-2 text-sm font-bold text-yellow-300">
                {message}
              </span>
            )}

            <button
              onClick={fetchReports}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold hover:bg-blue-500"
            >
              Refresh
            </button>
          </div>
        </div>

        <section className="mb-5 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black">Staff Reports</h2>
              <p className="text-sm text-zinc-400">
                Counts items sent to review using sent_to_review_at and sent_to_review_by.
              </p>
            </div>

            <select
              value={historyDays}
              onChange={(event) => setHistoryDays(Number(event.target.value))}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-bold text-white"
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>

          {loading ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-8 text-center text-zinc-400">
              Loading reports...
            </div>
          ) : (
            <>
              <div className="mb-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <p className="text-xs font-bold uppercase text-zinc-500">Sent today</p>
                  <p className="mt-1 text-4xl font-black">{totalToday}</p>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <p className="text-xs font-bold uppercase text-zinc-500">Sent this week</p>
                  <p className="mt-1 text-4xl font-black">{totalWeek}</p>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <p className="text-xs font-bold uppercase text-zinc-500">Sent this month</p>
                  <p className="mt-1 text-4xl font-black">{totalMonth}</p>
                </div>
              </div>

              <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {staffReportRows.length === 0 ? (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm font-bold text-zinc-400">
                    No staff review history yet.
                  </div>
                ) : (
                  staffReportRows.map((row) => (
                    <div key={row.staffId} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="truncate text-lg font-black">{row.staffName}</p>
                        <span className="rounded-full bg-blue-950 px-3 py-1 text-xs font-black text-blue-300">
                          {row.todayCount} today
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-center text-xs font-bold">
                        <div className="rounded-lg bg-zinc-900 p-2">
                          <p className="text-zinc-500">Week</p>
                          <p className="text-lg text-white">{row.weekCount}</p>
                        </div>

                        <div className="rounded-lg bg-zinc-900 p-2">
                          <p className="text-zinc-500">Month</p>
                          <p className="text-lg text-white">{row.monthCount}</p>
                        </div>

                        <div className="rounded-lg bg-zinc-900 p-2">
                          <p className="text-zinc-500">Total</p>
                          <p className="text-lg text-white">{row.totalCount}</p>
                        </div>
                      </div>

                      <p className="mt-3 text-sm font-bold text-zinc-300">
                        {row.staffName} sent {row.todayCount} item{row.todayCount === 1 ? '' : 's'} for review today.
                      </p>
                    </div>
                  ))
                )}
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-zinc-500">
                  Review history
                </h3>

                {Object.keys(historyByDate).length === 0 ? (
                  <p className="text-sm font-bold text-zinc-500">No history for this period.</p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(historyByDate).map(([date, staffRows]) => (
                      <div key={date} className="rounded-lg bg-zinc-900 p-3">
                        <p className="mb-2 text-sm font-black text-white">{date}</p>

                        <div className="flex flex-wrap gap-2">
                          {Object.entries(staffRows).map(([staffName, count]) => (
                            <span
                              key={`${date}-${staffName}`}
                              className="rounded-lg bg-blue-950 px-3 py-2 text-xs font-black text-blue-300"
                            >
                              {staffName}: {count}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-zinc-500">
                  Latest review submissions
                </h3>

                <div className="space-y-2">
                  {historyItems.slice(0, 30).map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-zinc-900 p-3 text-sm"
                    >
                      <div>
                        <p className="font-black">SKU: {item.sku}</p>
                        <p className="text-xs font-bold text-zinc-500">
                          {staffNameById[item.sent_to_review_by || ''] || 'Unknown staff'} · {formatDateTime(item.sent_to_review_at)}
                        </p>
                      </div>

                      <p className="rounded-full bg-zinc-800 px-3 py-1 text-xs font-black text-zinc-300">
                        {item.status}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>

        <section className="mb-5 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-xl font-black">Sales Report</h2>
          <p className="mt-2 rounded-xl border border-dashed border-zinc-700 bg-zinc-950 p-6 text-sm font-bold text-zinc-500">
            Placeholder. Later this can show POS/eBay/Shopify/Vinted sales, revenue by channel, units sold, refunds, and sell-through.
          </p>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-xl font-black">Profit / Loss Report</h2>
          <p className="mt-2 rounded-xl border border-dashed border-zinc-700 bg-zinc-950 p-6 text-sm font-bold text-zinc-500">
            Placeholder. Later this can show gross profit, cost of goods sold, fees, wages, VAT estimate, and net profit.
          </p>
        </section>
      </main>
    </StaffPermissionGate>
  )
}
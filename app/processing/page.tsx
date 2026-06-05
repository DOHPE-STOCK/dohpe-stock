'use client'

import { useEffect, useMemo, useState } from 'react'
import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { useStaff } from '@/app/context/StaffContext'
import FinalisedPanel from '@/app/processing/components/FinalisedPanel'
import InboundPanel from '@/app/processing/components/InboundPanel'
import ReceivingPanel from '@/app/processing/components/ReceivingPanel'
import ReviewPanel from '@/app/processing/components/ReviewPanel'
import WorkingPanel from '@/app/processing/components/WorkingPanel'
import { supabase } from '@/lib/supabase'

type ProcessingStage = 'inbound' | 'receiving' | 'working' | 'review' | 'finalised'

type ProcessingItem = {
  id: string
  sku: string
  brand: string | null
  reporting_category: string | null
  sub_category: string | null
  item_type: string | null
  status: string | null
  stock_level: number | null
  selling_price: number | null
  updated_at: string | null
  sent_to_review_at?: string | null
  ebay_category_id?: string | null
  ebay_category_name?: string | null
}

const stages: Array<{
  key: ProcessingStage
  label: string
  description: string
}> = [
  {
    key: 'inbound',
    label: 'Inbound',
    description: 'Supplier emails, invoices, parsed line items, and batch creation.',
  },
  {
    key: 'receiving',
    label: 'Receiving',
    description: 'Confirm quantities, assign RFID tags, and prepare received goods.',
  },
  {
    key: 'working',
    label: 'Working',
    description: 'Items being photographed, catalogued, and edited.',
  },
  {
    key: 'review',
    label: 'Review',
    description: 'Finished catalogue work awaiting approval and marketplace checks.',
  },
  {
    key: 'finalised',
    label: 'Finalised',
    description: 'Approved items ready for labels, export, and onward listing work.',
  },
]

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

export default function ProcessingPage() {
  const { can } = useStaff()
  const [activeStage, setActiveStage] = useState<ProcessingStage>('inbound')
  const [items, setItems] = useState<ProcessingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [receivingBatchId, setReceivingBatchId] = useState('')

  useEffect(() => {
    fetchProcessingItems()
  }, [])

  useEffect(() => {
    function refreshOnFocus() {
      fetchProcessingItems()
    }

    window.addEventListener('focus', refreshOnFocus)
    return () => window.removeEventListener('focus', refreshOnFocus)
  }, [])

  const visibleStages = useMemo(() => {
    return stages.filter((stage) => {
      if (stage.key === 'review') return can('review')
      if (stage.key === 'finalised') return can('finalised')
      return can('working')
    })
  }, [can])

  useEffect(() => {
    if (visibleStages.some((stage) => stage.key === activeStage)) return
    setActiveStage(visibleStages[0]?.key || 'inbound')
  }, [activeStage, visibleStages])

  async function fetchProcessingItems() {
    setLoading(true)
    setMessage('')

    const { data, error } = await supabase
      .from('items')
      .select(
        `id, sku, brand, reporting_category, sub_category, item_type, status, stock_level,
        selling_price, updated_at, sent_to_review_at, ebay_category_id, ebay_category_name`
      )
      .in('status', ['working', 'review', 'finalised'])
      .order('updated_at', { ascending: false })

    if (error) {
      setMessage(error.message)
      setLoading(false)
      return
    }

    setItems((data || []) as ProcessingItem[])
    setLoading(false)
  }

  const itemsByStage = useMemo(() => {
    return {
      working: items.filter((item) => text(item.status) === 'working'),
      review: items.filter((item) => text(item.status) === 'review'),
      finalised: items.filter((item) => text(item.status) === 'finalised'),
    }
  }, [items])

  const activeMeta = stages.find((stage) => stage.key === activeStage) || stages[0]

  function stageCount(stage: ProcessingStage) {
    if (stage === 'working') return itemsByStage.working.length
    if (stage === 'review') return itemsByStage.review.length
    if (stage === 'finalised') return itemsByStage.finalised.length
    return 0
  }

  function renderStagePanel() {
    if (activeStage === 'inbound') {
      return (
        <InboundPanel
          onOpenReceiving={(batchId) => {
            setReceivingBatchId(batchId)
            setActiveStage('receiving')
          }}
        />
      )
    }

    if (activeStage === 'receiving') {
      return <ReceivingPanel selectedBatchId={receivingBatchId} onChanged={fetchProcessingItems} />
    }

    if (activeStage === 'working') return <WorkingPanel embedded onChanged={fetchProcessingItems} />
    if (activeStage === 'review') return <ReviewPanel embedded onChanged={fetchProcessingItems} />
    return <FinalisedPanel embedded />
  }

  return (
    <StaffPermissionGate permissions={['working', 'review', 'finalised']}>
      <main className="min-h-screen bg-zinc-950 p-5 text-white">
        <div className="app-header mb-5 flex flex-wrap items-start justify-between gap-4 rounded-3xl bg-black p-4 text-white shadow-2xl sm:p-5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
            <div>
              <h1 className="text-2xl font-black tracking-normal">Processing</h1>
              <p className="text-sm text-zinc-300">
                Inbound, Receiving, Working, Review, and Finalised in one workflow.
              </p>
            </div>

            <AppNav current="processing" />
          </div>

          <div className="flex items-center gap-3">
            {message && (
              <span className="rounded-lg border border-yellow-700 bg-yellow-950 px-4 py-2 text-sm font-bold text-yellow-300">
                {message}
              </span>
            )}

            <button
              type="button"
              onClick={fetchProcessingItems}
              className="rounded-xl bg-white px-5 py-2 text-sm font-black text-black hover:bg-zinc-200"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <aside className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3">
            <div className="space-y-2">
              {visibleStages.map((stage) => {
                const active = activeStage === stage.key
                const count = stageCount(stage.key)

                return (
                  <button
                    key={stage.key}
                    type="button"
                    onClick={() => setActiveStage(stage.key)}
                    className={`block w-full rounded-xl p-3 text-left ${
                      active
                        ? 'bg-emerald-600 text-white'
                        : 'bg-zinc-950 text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-black">{stage.label}</span>
                      {stage.key !== 'inbound' && stage.key !== 'receiving' && (
                        <span className="rounded-full bg-black/25 px-2 py-1 text-xs font-black">
                          {count}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-xs font-bold opacity-80">
                      {stage.description}
                    </span>
                  </button>
                )
              })}
            </div>
          </aside>

          <section className="min-w-0 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black">{activeMeta.label}</h2>
                <p className="text-sm font-bold text-zinc-400">{activeMeta.description}</p>
              </div>

              {loading && activeStage !== 'working' && activeStage !== 'review' && activeStage !== 'finalised' && (
                <span className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-black text-zinc-300">
                  Loading...
                </span>
              )}
            </div>

            {renderStagePanel()}
          </section>
        </div>
      </main>
    </StaffPermissionGate>
  )
}

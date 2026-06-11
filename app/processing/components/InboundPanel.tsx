'use client'

import { useEffect, useMemo, useState } from 'react'
import { useStaff } from '@/app/context/StaffContext'
import { supabase } from '@/lib/supabase'

type InboundBatch = {
  id: string
  batch_code: string
  supplier_name: string | null
  order_reference: string | null
  expected_quantity: number
  actual_quantity: number | null
  default_brand: string | null
  default_reporting_category: string | null
  default_sub_category: string | null
  default_item_type: string | null
  cost_price: number | null
  line_total?: number | null
  allocated_fees?: number | null
  allocated_shipping?: number | null
  allocated_discount?: number | null
  status: string
  created_at: string
}

type InboundPanelProps = {
  activeCompanyId?: string
  schemaReady?: boolean
  onOpenReceiving?: (batchId: string) => void
}

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-'
  return `£${Number(value).toFixed(2)}`
}

function makeBatchCode() {
  const now = new Date()
  const date = now.toISOString().slice(0, 10).replaceAll('-', '')
  const time = now.toTimeString().slice(0, 8).replaceAll(':', '')
  return `IN-${date}-${time}`
}

const linkedCategoryOptions = [
  'T-Shirt',
  'Long Sleeve T-Shirt',
  'Shirt',
  'Hoodie',
  'Sweatshirt',
  'Jacket',
  'Coat',
  'Fleece',
  'Knitwear',
  'Cardigan',
  'Polo Shirt',
  'Rugby Shirt',
  'Football Shirt',
  'Jersey',
  'Blazer',
  'Workwear Jacket',
  'Vest',
  'Tank Top',
  'Waistcoat',
  'Jeans',
  'Trousers',
  'Cargo Trousers',
  'Tracksuit Bottoms',
  'Pyjama Bottoms',
  'Jorts',
  'Shorts',
  'Skirt',
  'Dress',
  'Dungarees',
  'Overalls',
  'Boiler Suit',
  'Shoes',
  'Boots',
  'Trainers',
  'Hat',
  'Cap',
  'Beanie',
  'Bag',
  'Belt',
  'Scarf',
  'Tie',
  'Jewellery',
  'Sunglasses',
  'Accessories',
  'Other',
]

export default function InboundPanel({
  activeCompanyId = '',
  schemaReady = false,
  onOpenReceiving,
}: InboundPanelProps) {
  const { staff } = useStaff()
  const [batches, setBatches] = useState<InboundBatch[]>([])
  const [categoryOptions, setCategoryOptions] = useState<string[]>([])
  const [subCategoryRows, setSubCategoryRows] = useState<Array<{ category: string; subCategory: string }>>([])
  const [itemTypeOptions, setItemTypeOptions] = useState<string[]>([])
  const [entryMode, setEntryMode] = useState<'simple' | 'invoice'>('simple')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({
    supplier_name: '',
    order_reference: '',
    expected_quantity: '',
    actual_quantity: '',
    default_brand: '',
    default_reporting_category: '',
    default_sub_category: '',
    default_item_type: 'Clothing',
    cost_price: '',
    line_total: '',
    allocated_fees: '',
    allocated_shipping: '',
    allocated_discount: '',
    notes: '',
  })

  useEffect(() => {
    fetchBatches()
    fetchCategoryOptions()
  }, [activeCompanyId, schemaReady])

  const costSummary = useMemo(() => {
    const expectedQuantity = Number(form.expected_quantity) || 0
    const actualQuantity = Number(form.actual_quantity) || 0
    const quantity = actualQuantity || expectedQuantity
    const lineTotal = Number(form.line_total) || 0
    const fees = Number(form.allocated_fees) || 0
    const shipping = Number(form.allocated_shipping) || 0
    const discount = Number(form.allocated_discount) || 0
    const total = lineTotal + fees + shipping - discount
    const unit = quantity > 0 && total > 0 ? Number((total / quantity).toFixed(2)) : null

    return { quantity, lineTotal, fees, shipping, discount, total, unit }
  }, [form])

  const simpleUnitCost = useMemo(() => {
    const unit = Number(form.cost_price)
    return Number.isFinite(unit) && unit > 0 ? Number(unit.toFixed(2)) : null
  }, [form.cost_price])

  const subCategoryOptions = useMemo(() => {
    const selectedCategory = text(form.default_reporting_category).toLowerCase()

    if (!selectedCategory) return []

    return Array.from(
      new Set(
        subCategoryRows
          .filter((row) => row.category.toLowerCase() === selectedCategory)
          .map((row) => row.subCategory)
          .filter(Boolean)
      )
    ).sort()
  }, [form.default_reporting_category, subCategoryRows])

  async function fetchCategoryOptions() {
    let query = supabase
      .from('items')
      .select('reporting_category, sub_category, item_type')
      .limit(3000)

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data } = await query

    const rows = data || []
    setCategoryOptions(
      Array.from(new Set(rows.map((row: any) => text(row.reporting_category)).filter(Boolean))).sort()
    )
    setSubCategoryRows(
      rows
        .map((row: any) => ({
          category: text(row.reporting_category),
          subCategory: text(row.sub_category),
        }))
        .filter((row) => row.category && row.subCategory)
    )
    setItemTypeOptions(
      Array.from(new Set(rows.map((row: any) => text(row.item_type)).filter(Boolean))).sort()
    )
  }

  async function fetchBatches() {
    setMessage('')
    let query = supabase
      .from('inbound_batches')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30)

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data, error } = await query

    if (error) {
      setMessage(error.message)
      return
    }

    setBatches((data || []) as InboundBatch[])
  }

  function updateField(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function createBatch() {
    const expectedQuantity = Number(form.expected_quantity)
    const actualQuantity = text(form.actual_quantity) ? Number(form.actual_quantity) : null
    const moneyValues = [
      entryMode === 'simple' ? Number(form.cost_price || 0) : costSummary.lineTotal,
      entryMode === 'simple' ? 0 : costSummary.fees,
      entryMode === 'simple' ? 0 : costSummary.shipping,
      entryMode === 'simple' ? 0 : costSummary.discount,
    ]
    const unitCost = entryMode === 'simple' ? simpleUnitCost : costSummary.unit

    if (!Number.isInteger(expectedQuantity) || expectedQuantity <= 0) {
      setMessage('Expected quantity must be greater than 0.')
      return
    }

    if (actualQuantity !== null && (!Number.isInteger(actualQuantity) || actualQuantity < 0)) {
      setMessage('Actual quantity must be blank or a valid whole number.')
      return
    }

    if (moneyValues.some((value) => !Number.isFinite(value) || value < 0)) {
      setMessage('Line total, fees, shipping and discount must be valid positive numbers or blank.')
      return
    }

    setLoading(true)
    setMessage('Creating inbound batch...')

    const { data, error } = await supabase
      .from('inbound_batches')
      .insert({
        ...(schemaReady ? { company_id: activeCompanyId } : {}),
        batch_code: makeBatchCode(),
        supplier_name: text(form.supplier_name) || null,
        order_reference: text(form.order_reference) || null,
        source_type: entryMode === 'simple' ? 'manual_purchase' : 'manual_invoice_line',
        expected_quantity: expectedQuantity,
        actual_quantity: actualQuantity,
        default_brand: text(form.default_brand) || null,
        default_reporting_category: text(form.default_reporting_category) || null,
        default_sub_category: text(form.default_sub_category) || null,
        default_item_type: text(form.default_item_type) || null,
        line_total: entryMode === 'invoice' ? costSummary.lineTotal || null : null,
        allocated_fees: entryMode === 'invoice' ? costSummary.fees : 0,
        allocated_shipping: entryMode === 'invoice' ? costSummary.shipping : 0,
        allocated_discount: entryMode === 'invoice' ? costSummary.discount : 0,
        cost_price: unitCost,
        status: 'receiving',
        notes: text(form.notes) || null,
        created_by: staff?.id || null,
      })
      .select('*')
      .single()

    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage(`Created ${data.batch_code}.`)
    setForm({
      supplier_name: '',
      order_reference: '',
      expected_quantity: '',
      actual_quantity: '',
      default_brand: '',
      default_reporting_category: '',
      default_sub_category: '',
      default_item_type: 'Clothing',
      cost_price: '',
      line_total: '',
      allocated_fees: '',
      allocated_shipping: '',
      allocated_discount: '',
      notes: '',
    })
    fetchBatches()
    onOpenReceiving?.(data.id)
  }

  return (
    <div className="space-y-5">
      {message && (
        <div className="rounded-lg border border-yellow-700 bg-yellow-950 p-3 text-sm font-bold text-yellow-300">
          {message}
        </div>
      )}

      <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black">Create Inbound Batch</h3>
            <p className="text-sm font-bold text-zinc-400">
              Quick customer purchases use a unit cost. Invoice lines can include allocation later.
            </p>
          </div>

          <div className="flex rounded-xl p-1" style={{ backgroundColor: '#18181b', border: '1px solid #3f3f46' }}>
            {[
              ['simple', 'Quick line'],
              ['invoice', 'Invoice line'],
            ].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setEntryMode(mode as 'simple' | 'invoice')}
                className="rounded-lg px-3 py-2 text-xs font-black"
                style={{
                  backgroundColor: entryMode === mode ? '#16a34a' : '#18181b',
                  color: '#ffffff',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label>
            <span className="mb-1 block text-xs font-black uppercase text-zinc-500">Supplier</span>
            <input
              value={form.supplier_name}
              onChange={(event) => updateField('supplier_name', event.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            />
          </label>

          <label>
            <span className="mb-1 block text-xs font-black uppercase text-zinc-500">Order / invoice ref</span>
            <input
              value={form.order_reference}
              onChange={(event) => updateField('order_reference', event.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            />
          </label>

          <label>
            <span className="mb-1 block text-xs font-black uppercase text-zinc-500">Optional brand</span>
            <input
              value={form.default_brand}
              onChange={(event) => updateField('default_brand', event.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            />
          </label>

          <label>
            <span className="mb-1 block text-xs font-black uppercase text-zinc-500">Expected quantity</span>
            <input
              value={form.expected_quantity}
              onChange={(event) => updateField('expected_quantity', event.target.value)}
              inputMode="numeric"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            />
          </label>

          <label>
            <span className="mb-1 block text-xs font-black uppercase text-zinc-500">Actual quantity</span>
            <input
              value={form.actual_quantity}
              onChange={(event) => updateField('actual_quantity', event.target.value)}
              inputMode="numeric"
              placeholder="Optional"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            />
          </label>

          <label>
            <span className="mb-1 block text-xs font-black uppercase text-zinc-500">Item type</span>
            <select
              value={form.default_item_type}
              onChange={(event) => updateField('default_item_type', event.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            >
              <option value="">Choose item type...</option>
              {Array.from(new Set(['Clothing', 'Accessories', 'Footwear', ...itemTypeOptions])).map((itemType) => (
                <option key={itemType} value={itemType}>
                  {itemType}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="mb-1 block text-xs font-black uppercase text-zinc-500">Category default</span>
            <select
              value={form.default_reporting_category}
              onChange={(event) => updateField('default_reporting_category', event.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            >
              <option value="">Choose category...</option>
              {Array.from(new Set([...linkedCategoryOptions, ...categoryOptions])).map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="mb-1 block text-xs font-black uppercase text-zinc-500">Sub category default</span>
            <input
              value={form.default_sub_category}
              onChange={(event) => updateField('default_sub_category', event.target.value)}
              list="inbound-sub-category-options"
              placeholder="Type or select"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            />
            <datalist id="inbound-sub-category-options">
              {subCategoryOptions.map((subCategory) => (
                <option key={subCategory} value={subCategory} />
              ))}
            </datalist>
          </label>

          {entryMode === 'simple' && (
              <label>
                <span className="mb-1 block text-xs font-black uppercase text-zinc-500">Unit cost</span>
                <input
                  value={form.cost_price}
                  onChange={(event) => updateField('cost_price', event.target.value)}
                  inputMode="decimal"
                  placeholder="Cost per item"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
                />
              </label>
          )}
        </div>

        {entryMode === 'invoice' && (
          <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <h4 className="text-sm font-black uppercase text-zinc-300">Invoice cost allocation</h4>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <label>
                <span className="mb-1 block text-xs font-black uppercase text-zinc-500">Line total</span>
                <input
                  value={form.line_total}
                  onChange={(event) => updateField('line_total', event.target.value)}
                  inputMode="decimal"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-white"
                />
              </label>

              <label>
                <span className="mb-1 block text-xs font-black uppercase text-zinc-500">Fees share</span>
                <input
                  value={form.allocated_fees}
                  onChange={(event) => updateField('allocated_fees', event.target.value)}
                  inputMode="decimal"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-white"
                />
              </label>

              <label>
                <span className="mb-1 block text-xs font-black uppercase text-zinc-500">Shipping share</span>
                <input
                  value={form.allocated_shipping}
                  onChange={(event) => updateField('allocated_shipping', event.target.value)}
                  inputMode="decimal"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-white"
                />
              </label>

              <label>
                <span className="mb-1 block text-xs font-black uppercase text-zinc-500">Discount share</span>
                <input
                  value={form.allocated_discount}
                  onChange={(event) => updateField('allocated_discount', event.target.value)}
                  inputMode="decimal"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-white"
                />
              </label>
            </div>
            <p className="mt-3 text-sm font-bold text-zinc-300">
              Unit cost: <span className="text-white">{money(costSummary.unit)}</span>
              <span className="text-zinc-500">
                {' '}({costSummary.total.toFixed(2)} divided by {costSummary.quantity || 0})
              </span>
            </p>
          </div>
        )}

        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-black uppercase text-zinc-500">Notes</span>
          <textarea
            value={form.notes}
            onChange={(event) => updateField('notes', event.target.value)}
            rows={2}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
          />
        </label>

        <button
          type="button"
          onClick={createBatch}
          disabled={loading}
          className="mt-4 rounded-xl bg-green-600 px-5 py-3 text-sm font-black text-white hover:bg-green-500 disabled:opacity-40"
        >
          {loading ? 'Creating...' : 'Create Batch'}
        </button>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-black">Recent Inbound Batches</h3>
          <button
            type="button"
            onClick={fetchBatches}
            className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white hover:bg-zinc-700"
          >
            Refresh
          </button>
        </div>

        {batches.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center text-sm font-bold text-zinc-400">
            No inbound batches yet.
          </div>
        ) : (
          <div className="space-y-2">
            {batches.map((batch) => (
              <div
                key={batch.id}
                className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3 md:grid-cols-[1fr_auto] md:items-center"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-white">{batch.batch_code}</span>
                    <span className="rounded-full bg-zinc-800 px-2 py-1 text-xs font-black uppercase text-zinc-300">
                      {batch.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-bold text-zinc-400">
                    {batch.supplier_name || 'No supplier'} · {batch.order_reference || 'No ref'} · Expected {batch.expected_quantity}
                    {batch.actual_quantity !== null ? ` · Actual ${batch.actual_quantity}` : ''}
                    {batch.cost_price !== null ? ` · Unit cost ${money(batch.cost_price)}` : ''}
                  </p>
                  <p className="mt-1 text-xs font-bold text-zinc-500">
                    {[batch.default_brand, batch.default_reporting_category, batch.default_sub_category]
                      .filter(Boolean)
                      .join(' · ') || 'No defaults set'}
                  </p>
                </div>

                {batch.status === 'receiving' && (
                  <button
                    type="button"
                    onClick={() => onOpenReceiving?.(batch.id)}
                    className="rounded-lg bg-white px-4 py-2 text-sm font-black text-black hover:bg-zinc-200"
                  >
                    Receive
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

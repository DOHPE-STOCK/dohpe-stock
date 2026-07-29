'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { useCompany } from '@/app/context/CompanyContext'
import { useStaff } from '@/app/context/StaffContext'
import {
  findBestEbayCategoryMapping,
  mergeEbaySettings,
} from '@/lib/ebayIntegrationSettings'
import { isDigitalSkuType, normaliseSkuType, skuTypeLabel } from '@/lib/skuTypes'

const PHOTO_ORIGINAL_RETENTION_DAYS = 14

function originalDeleteAfterIso(days = PHOTO_ORIGINAL_RETENTION_DAYS) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

async function reserveGeneratedSkus(quantity: number): Promise<string[]> {
  const response = await fetch('/api/skus/generated', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quantity }),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok || result?.ok === false) {
    throw new Error(result?.message || 'Generated SKU reservation failed.')
  }

  const skus: string[] = Array.isArray(result.skus) ? result.skus.map((sku: any) => String(sku)) : []
  if (skus.length !== quantity) {
    throw new Error('Generated SKU reservation returned the wrong quantity.')
  }

  return skus
}

const reportingCategories = [
  'Accessories',
  'Bag',
  'Beanie',
  'Belt',
  'Blazer',
  'Boiler Suit',
  'Boots',
  'Cap',
  'Cardigan',
  'Cargo Trousers',
  'Coat',
  'Dress',
  'Dungarees',
  'Fleece',
  'Football Shirt',
  'Hat',
  'Hoodie',
  'Jacket',
  'Jeans',
  'Jersey',
  'Jewellery',
  'Jorts',
  'Knitwear',
  'Long Sleeve T-Shirt',
  'Military',
  'Outdoor',
  'Other',
  'Overalls',
  'Polo Shirt',
  'Pyjama Bottoms',
  'Pyjama Shirt',
  'Rugby Shirt',
  'Scarf',
  'Shirt',
  'Shoes',
  'Shorts',
  'Skirt',
  'Suiting',
  'Sunglasses',
  'Sweatshirt',
  'Swimwear',
  'T-Shirt',
  'Tank Top',
  'Tie',
  'Tracksuit Bottoms',
  'Trainers',
  'Trousers',
  'Vest',
  'Waistcoat',
  'Workwear Jacket',
]

const itemTypeOptions = ['Clothing', 'Accessories', 'Footwear', 'Other']

const clothingConditionOptions = [
  'New with tags',
  'New without tags',
  'Excellent',
  'Good',
  'Fair',
]

const conditionOptions = [
  ...clothingConditionOptions,
  'Very Good',
  'Used',
  'Like New',
  'New with imperfections',
  'Poor / For Repair',
]

const genderOptions = ['Male', 'Female', 'Unisex', 'Kids']

const vatRuleOptions = [
  { value: 'channel_default', label: 'Channel default' },
  { value: 'standard', label: 'Standard VAT' },
  { value: 'zero', label: 'Zero rated' },
  { value: 'exempt', label: 'Exempt' },
  { value: 'custom', label: 'Custom rate' },
]

const countryOptions = [
  'United Kingdom',
  'United States',
  'France',
  'Germany',
  'Italy',
  'Spain',
  'Portugal',
  'Netherlands',
  'Belgium',
  'Poland',
  'Romania',
  'Turkey',
  'China',
  'India',
  'Pakistan',
  'Bangladesh',
  'Vietnam',
  'Cambodia',
  'Indonesia',
  'Thailand',
  'Japan',
  'South Korea',
  'Mexico',
  'Canada',
  'Other',
]

const itemKindOptions = [
  { value: 'standard', label: 'Standard SKU' },
  { value: 'parent', label: 'Parent SKU' },
  { value: 'variation_child', label: 'Variation child SKU' },
  { value: 'composite', label: 'Composite / bundle SKU' },
]

const WAREHOUSE_LOCATION = 'LOCATION-1'
const DEFAULT_BIN = 'Default'

const materialOptions = [
  'Cotton',
  'Cotton / Polyester Mix',
  'Fine Cotton',
  'Polyester',
  'Denim',
  'Leather',
  'Wool',
  'Fleece',
  'Nylon',
  'Acrylic',
  'Corduroy',
  'Canvas',
  'Knit',
  'Jersey',
  'Linen',
  'Rayon',
  'Viscose',
  'Polyamide',
  'Elastane',
  'Spandex',
  'Silk',
  'Suede',
  'Mixed Fibres',
  'Unknown',
]

const sleevedTopMeasurements = [
  'pit_to_pit_in',
  'collar_to_hem_in',
  'pit_to_cuff_in',
]

const sleevelessTopMeasurements = ['pit_to_pit_in', 'collar_to_hem_in']

const bottomMeasurements = [
  'waist_in',
  'inside_leg_in',
  'rise_in',
  'hem_width_in',
]

const allMeasurementFields = [
  'pit_to_pit_in',
  'collar_to_hem_in',
  'pit_to_cuff_in',
  'sleeve_in',
  'waist_in',
  'inside_leg_in',
  'rise_in',
  'hem_width_in',
]

const CHANNEL_UPDATE_REGISTRY = [
  {
    key: 'linnworks',
    label: 'Linnworks',
    statusField: 'linnworks_status',
    updateHandler: 'linnworks',
    liveStatuses: ['synced', 'active', 'pending_update', 'failed'],
    isLive: (item: any) =>
      item?.linnworks_managed === true ||
      ['synced', 'active', 'pending_update', 'failed'].includes(String(item?.linnworks_status || '').toLowerCase()),
  },
  {
    key: 'ebay',
    label: 'eBay',
    statusField: 'ebay_status',
    updateHandler: 'ebay',
    liveStatuses: ['listed', 'active', 'pending_update', 'failed'],
  },
  { key: 'shopify', label: 'Shopify', statusField: 'shopify_status', updateHandler: null, liveStatuses: ['listed', 'synced', 'active', 'pending_update', 'failed'] },
  { key: 'square', label: 'Square', statusField: 'square_status', updateHandler: null, liveStatuses: ['listed', 'synced', 'active', 'pending_update', 'failed'] },
  { key: 'grailed', label: 'Grailed', statusField: 'grailed_status', updateHandler: null, liveStatuses: ['listed', 'synced', 'active', 'pending_update', 'failed'] },
  { key: 'vestiaire_collective', label: 'Vestiaire Collective', statusField: 'vestiaire_collective_status', updateHandler: null, liveStatuses: ['listed', 'synced', 'active', 'pending_update', 'failed'] },
  { key: 'whatnot', label: 'Whatnot', statusField: 'whatnot_status', updateHandler: null, liveStatuses: ['listed', 'synced', 'active', 'pending_update', 'failed'] },
  { key: 'vinted', label: 'Vinted', statusField: 'vinted_status', updateHandler: null, liveStatuses: ['listed', 'synced', 'active', 'pending_update', 'failed'] },
  { key: 'depop', label: 'Depop', statusField: 'depop_status', updateHandler: null, liveStatuses: ['listed', 'synced', 'active', 'pending_update', 'failed'] },
  { key: 'tiktok_shop', label: 'TikTok Shop', statusField: 'tiktok_shop_status', updateHandler: null, liveStatuses: ['listed', 'synced', 'active', 'pending_update', 'failed'] },
] as const

type ExportedChannel = {
  key: string
  label: string
  statusField: string
  supported: boolean
  updateHandler: string | null
}

type StockDetailRow = {
  id?: string
  location_name: string | null
  bin_code: string | null
  stock_level: number
  is_quarantine?: boolean
}

type StockDetailSummary = {
  physical_stock: number
  available_stock: number
  open_order_stock: number
  inbound_stock: number
  quarantine_stock: number
  stock_buffer: number
  max_channel_exposed_stock: number | null
  channel_exposed_stock: number
  location_rows: StockDetailRow[]
  negative_locations: StockDetailRow[]
}

type ChannelProgress = {
  open: boolean
  status: 'working' | 'success' | 'failed'
  title: string
  message: string
  details?: string[]
}

function channelPendingUpdates(channels: ExportedChannel[]) {
  return channels.reduce((updates: Record<string, unknown>, channel) => {
    updates[channel.statusField] = 'pending_update'
    return updates
  }, {})
}

const dataEntryFieldKeys = [
  'item_type',
  'sku',
  'barcode_number',
  'reporting_category',
  'sub_category',
  'brand',
  'gender',
  'tagged_size',
  'colour_primary',
  'colour_secondary',
  'condition',
  'material',
  'era',
  'style',
  'pit_to_pit_in',
  'collar_to_hem_in',
  'pit_to_cuff_in',
  'sleeve_in',
  'waist_in',
  'inside_leg_in',
  'rise_in',
  'hem_width_in',
  'weight_grams',
  'basic_title',
  'flaws',
] as const

const titleCaseItemDetailFields = new Set([
  'brand',
  'reporting_category',
  'sub_category',
  'colour_primary',
  'colour_secondary',
  'material',
  'era',
  'style',
  'flaws',
  'staff_notes',
])

const measurementMap: Record<string, string[]> = {
  'T-Shirt': sleevedTopMeasurements,
  'Long Sleeve T-Shirt': sleevedTopMeasurements,
  Shirt: sleevedTopMeasurements,
  Hoodie: sleevedTopMeasurements,
  Sweatshirt: sleevedTopMeasurements,
  Jacket: sleevedTopMeasurements,
  Coat: sleevedTopMeasurements,
  Fleece: sleevedTopMeasurements,
  Knitwear: sleevedTopMeasurements,
  Cardigan: sleevedTopMeasurements,
  'Polo Shirt': sleevedTopMeasurements,
  'Rugby Shirt': sleevedTopMeasurements,
  'Football Shirt': sleevedTopMeasurements,
  Jersey: sleevedTopMeasurements,
  Blazer: sleevedTopMeasurements,
  'Workwear Jacket': sleevedTopMeasurements,

  Vest: sleevelessTopMeasurements,
  'Tank Top': sleevelessTopMeasurements,
  Waistcoat: sleevelessTopMeasurements,

  Jeans: bottomMeasurements,
  Trousers: bottomMeasurements,
  'Cargo Trousers': bottomMeasurements,
  'Tracksuit Bottoms': bottomMeasurements,
  'Pyjama Bottoms': bottomMeasurements,
  Jorts: bottomMeasurements,

  Shorts: ['waist_in', 'rise_in', 'hem_width_in'],
  Skirt: ['waist_in', 'collar_to_hem_in'],
  Dress: ['pit_to_pit_in', 'collar_to_hem_in', 'pit_to_cuff_in', 'waist_in'],
  Dungarees: ['pit_to_pit_in', 'collar_to_hem_in', 'waist_in', 'inside_leg_in'],
  Overalls: ['pit_to_pit_in', 'collar_to_hem_in', 'waist_in', 'inside_leg_in'],
  'Boiler Suit': [
    'pit_to_pit_in',
    'collar_to_hem_in',
    'pit_to_cuff_in',
    'waist_in',
    'inside_leg_in',
  ],

  Shoes: [],
  Boots: [],
  Trainers: [],
  Hat: [],
  Cap: [],
  Beanie: [],
  Bag: [],
  Belt: [],
  Scarf: [],
  Tie: [],
  Jewellery: [],
  Sunglasses: [],
  Accessories: [],

  Other: [
    'pit_to_pit_in',
    'collar_to_hem_in',
    'pit_to_cuff_in',
    'waist_in',
    'inside_leg_in',
    'rise_in',
    'hem_width_in',
  ],
}

const measurementLabels: Record<string, string> = {
  pit_to_pit_in: 'Pit to Pit',
  collar_to_hem_in: 'Collar to Hem',
  pit_to_cuff_in: 'Pit to Cuff',
  sleeve_in: 'Sleeve',
  waist_in: 'Waist',
  inside_leg_in: 'Inside Leg',
  rise_in: 'Rise',
  hem_width_in: 'Leg Opening',
}

type PhotoStation = {
  id: string
  name: string
  code: string
  status: string
  active_photo_session_id?: string | null
  active_session?: any
}

type MeasurementSuggestion = {
  id: string
  measurement_type: string
  raw_value_mm?: number | string | null
  raw_value_in?: number | string | null
  proposed_value_in?: number | string | null
  accepted_value_in?: number | string | null
  confidence?: number | string | null
  status: string
  processing_version?: string | null
  created_at?: string | null
  capture?: any
  session?: any
}

type CompositionComponentRow = {
  id?: string
  component_item_id?: string
  component_sku: string
  quantity: string
  notes?: string
}

type ChildSkuRow = {
  id?: string
  sku: string
  size?: string
  colour?: string
  custom_name?: string
  custom_value?: string
}

function Field({ label, value, onChange, onKeyDown, inputId, placeholder }: any) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-400">{label}</span>

      <input
        id={inputId}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder || ''}
        className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-white"
      />
    </label>
  )
}

function SelectField({ label, value, onChange, options }: any) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-400">{label}</span>

      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-white"
      >
        <option value="">Select...</option>

        {options.map((option: any) => {
          const value = typeof option === 'string' ? option : option.value
          const label = typeof option === 'string' ? option : option.label

          return (
          <option key={value} value={value}>
            {label}
          </option>
          )
        })}
      </select>
    </label>
  )
}

function DatalistField({
  label,
  value,
  onChange,
  options,
  listId,
  placeholder,
}: any) {
  const [open, setOpen] = useState(false)
  const inputId = `${listId}-input`

  return (
    <div className="relative block">
      <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-zinc-400">
        {label}
      </label>

      <input
        id={inputId}
        value={value || ''}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder || 'Type or select'}
        autoComplete="off"
        className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-white"
      />

      {open && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-auto rounded-lg border border-zinc-600 bg-zinc-900 p-1 shadow-2xl"
          style={{ backgroundColor: '#18181b', color: '#f4f4f5' }}
        >
          {options.map((option: string) => {
            const selected = option === value

            return (
              <button
                key={option}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option)
                  setOpen(false)
                }}
                className={`block w-full rounded-md px-3 py-2 text-left text-sm ${
                  selected
                    ? 'bg-emerald-600 font-bold text-white'
                    : 'text-zinc-100 hover:bg-zinc-800 hover:text-white'
                }`}
                style={{
                  backgroundColor: selected ? '#059669' : '#18181b',
                  color: '#ffffff',
                }}
                onMouseEnter={(event) => {
                  if (!selected) event.currentTarget.style.backgroundColor = '#27272a'
                }}
                onMouseLeave={(event) => {
                  if (!selected) event.currentTarget.style.backgroundColor = '#18181b'
                }}
              >
                {option}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TextArea({ label, value, onChange }: any) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-400">{label}</span>

      <textarea
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="h-28 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm text-white outline-none focus:border-white"
      />
    </label>
  )
}

function PhotoPreview({
  itemId,
  refreshKey,
}: {
  itemId: string
  refreshKey: number
}) {
  const [images, setImages] = useState<any[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    fetchImages()
  }, [itemId, refreshKey])

  async function fetchImages() {
    const { data } = await supabase
      .from('item_images')
      .select('*')
      .eq('item_id', itemId)
      .order('image_order', { ascending: true })

    setImages(data || [])
  }

  if (images.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-zinc-700 bg-zinc-950 text-center text-sm text-zinc-500">
        No photos uploaded yet
      </div>
    )
  }

  const selectedImage = images[selectedIndex]
  const selectedImageUrl =
    selectedImage.processed_url || selectedImage.original_url

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950">
        <img
          src={selectedImageUrl}
          alt="Selected item photo"
          className="aspect-square w-full object-cover"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <a
          href={`/price-research/${itemId}`}
          className="rounded-lg bg-white px-3 py-2 text-center text-xs font-bold text-black"
        >
          Price Analysis
        </a>

        <a
          href={selectedImageUrl}
          download
          target="_blank"
          rel="noreferrer"
          className="rounded-lg bg-zinc-800 px-3 py-2 text-center text-xs font-bold text-white"
        >
          Download Image
        </a>
      </div>

      <div className="flex gap-2 overflow-x-auto">
        {images.map((image, index) => {
          const imageUrl = image.processed_url || image.original_url

          return (
            <button
              type="button"
              key={image.id}
              onClick={() => setSelectedIndex(index)}
              className={`shrink-0 rounded border ${
                selectedIndex === index ? 'border-white' : 'border-zinc-700'
              }`}
            >
              <img
                src={imageUrl}
                alt="Thumbnail"
                className="h-16 w-16 rounded object-cover"
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}


const MEASUREMENT_FIELDS = [
  'pit_to_pit_in',
  'collar_to_hem_in',
  'pit_to_cuff_in',
  'sleeve_in',
  'waist_in',
  'inside_leg_in',
  'rise_in',
  'hem_width_in',
]

function getExportTitle(item: any) {
  return item.final_title || item.ai_title || item.basic_title || item.website_title || item.sku
}

function getExportDescription(item: any) {
  return item.final_description || item.ai_description || item.basic_description || ''
}

function buildLinnworksPayload(item: any, processedImageUrls: string[]) {
  const payload: any = {
    id: item.id,
    sku: item.sku,
    barcode_number: item.barcode_number,
    sku_type: item.sku_type,
    linnworks_item_id: item.linnworks_item_id,

    title: getExportTitle(item),
    final_title: item.final_title,
    ai_title: item.ai_title,
    basic_title: item.basic_title,
    website_title: item.website_title,

    final_description: item.final_description,
    ai_description: item.ai_description,
    basic_description: item.basic_description,
    description: getExportDescription(item),

    brand: item.brand,
    item_type: item.item_type,
    reporting_category: item.reporting_category,
    tagged_size: item.tagged_size,
    size_label: item.size_label,
    condition: item.condition,

    material: item.material,
    colour_primary: item.colour_primary,
    colour_secondary: item.colour_secondary,
    style: item.style,
    sub_category: item.sub_category,
    sub_type: item.sub_category,
    era: item.era,
    gender: item.gender,
    flaws: item.flaws,

    selling_price: item.selling_price,
    cost_price: item.cost_price,
    stock_level: item.stock_level ?? 1,
    weight_grams: item.weight_grams,

    current_location: item.current_location,
    current_bin: item.current_bin,

    processed_image_urls: processedImageUrls,
  }

  for (const field of MEASUREMENT_FIELDS) {
    if (item[field] !== null && item[field] !== undefined && String(item[field]).trim() !== '') {
      payload[field] = item[field]
    }
  }

  if (item.measurements) {
    payload.measurements = item.measurements
  }

  return payload
}

export default function ItemPage() {
  const params = useParams()
  const id = params.id as string
  const { staff } = useStaff()
  const { activeCompanyId, schemaReady } = useCompany()

  const [item, setItem] = useState<any>(null)
  const [message, setMessage] = useState('')
  const [generatingAi, setGeneratingAi] = useState(false)
  const [processingImages, setProcessingImages] = useState(false)
  const [exportingLinnworks, setExportingLinnworks] = useState(false)
  const [channelProgress, setChannelProgress] = useState<ChannelProgress>({
    open: false,
    status: 'working',
    title: '',
    message: '',
  })
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [photoRefreshKey, setPhotoRefreshKey] = useState(0)
  const [ebayReadiness, setEbayReadiness] = useState<any>(null)
  const [showEbayHtmlPreview, setShowEbayHtmlPreview] = useState(false)
  const [ebayCategorySearch, setEbayCategorySearch] = useState('')
  const [ebayCategorySuggestions, setEbayCategorySuggestions] = useState<any[]>([])
  const [searchingEbayCategories, setSearchingEbayCategories] = useState(false)
  const [brandOptions, setBrandOptions] = useState<string[]>([])
  const [subCategoryOptions, setSubCategoryOptions] = useState<string[]>([])
  const [photoStations, setPhotoStations] = useState<PhotoStation[]>([])
  const [selectedPhotoStationId, setSelectedPhotoStationId] = useState('')
  const [photoStationMessage, setPhotoStationMessage] = useState('')
  const [photoSessionBusy, setPhotoSessionBusy] = useState(false)
  const [measurementSuggestions, setMeasurementSuggestions] = useState<MeasurementSuggestion[]>([])
  const [measurementSuggestionBusyId, setMeasurementSuggestionBusyId] = useState('')
  const [activeTab, setActiveTab] = useState<'catalogue' | 'internal'>('catalogue')
  const [dataEntryMode, setDataEntryMode] = useState(false)
  const [dataEntryIndex, setDataEntryIndex] = useState(0)
  const [catalogueNextScanOpen, setCatalogueNextScanOpen] = useState(false)
  const [catalogueNextScanValue, setCatalogueNextScanValue] = useState('')
  const [catalogueNextScanBusy, setCatalogueNextScanBusy] = useState(false)
  const [compositionComponents, setCompositionComponents] = useState<CompositionComponentRow[]>([])
  const [childSkuRows, setChildSkuRows] = useState<ChildSkuRow[]>([])
  const [componentMessage, setComponentMessage] = useState('')
  const [stockDetails, setStockDetails] = useState<StockDetailSummary | null>(null)
  const [stockDetailsMessage, setStockDetailsMessage] = useState('')
  const [locationLabels, setLocationLabels] = useState<Record<string, string>>({})

  const originalItemRef = useRef<any>(null)
  const autoStartPhotoRef = useRef(false)
  const autoOpenDataEntryRef = useRef(false)
  const catalogueNextScanInputRef = useRef<HTMLInputElement | null>(null)
  const dataEntrySnapshotRef = useRef('')
  const dataEntryHadUnsavedRef = useRef(false)
  const autoSuggestedEbayCategoryRef = useRef('')

  useEffect(() => {
    fetchItem()
  }, [id, activeCompanyId, schemaReady])

  useEffect(() => {
    fetchPhotoStations()
    fetchBrandOptions()
  }, [activeCompanyId, schemaReady])

  useEffect(() => {
    fetchMeasurementSuggestions()
    fetchCompositionComponents()
    fetchChildSkuRows()
  }, [id, activeCompanyId, schemaReady])

  useEffect(() => {
    fetchStockDetails()
    fetchLocationLabels()
  }, [id, item?.sku, activeCompanyId, schemaReady])

  useEffect(() => {
    fetchSubCategoryOptions(item?.reporting_category)
  }, [item?.reporting_category])

  useEffect(() => {
    if (!item?.id || photoStations.length === 0 || autoStartPhotoRef.current) return

    const params = new URLSearchParams(window.location.search)
    if (params.get('start_photo') !== '1') return

    autoStartPhotoRef.current = true
    const calibrationPrompt = params.get('calibration_prompt') === '1'
    startPhotoSession({ askOpenMode: false, askStationChoice: false, calibrationPrompt })
    params.delete('start_photo')
    params.delete('calibration_prompt')
    const nextQuery = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`)
  }, [item?.id, photoStations.length])

  useEffect(() => {
    if (!item?.id || autoOpenDataEntryRef.current) return

    const params = new URLSearchParams(window.location.search)
    if (params.get('catalogue') !== '1' && params.get('data_entry') !== '1') return

    autoOpenDataEntryRef.current = true
    const inboundStartField = ['reporting_category', 'sub_category', 'brand'].find(
      (field) => !text(item?.[field])
    )
    const startField = item?.inbound_batch_id || item?.inbound_batch_code
      ? inboundStartField || 'gender'
      : 'brand'
    const startIndex = dataEntryFieldKeys.findIndex((field) => field === startField)

    dataEntrySnapshotRef.current = JSON.stringify(item)
    dataEntryHadUnsavedRef.current = hasUnsavedChanges
    setDataEntryIndex(startIndex >= 0 ? startIndex : 0)
    setDataEntryMode(true)
    window.setTimeout(
      () => document.getElementById(`data-entry-${startField}`)?.focus(),
      0
    )

    params.delete('catalogue')
    params.delete('data_entry')
    const nextQuery = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`)
  }, [item?.id])

  useEffect(() => {
    if (!message) return

    const timer = window.setTimeout(() => {
      setMessage('')
    }, 5000)

    return () => window.clearTimeout(timer)
  }, [message])

  useEffect(() => {
    if (!item?.sku) return
    checkEbayReadiness(item.sku)
  }, [item?.sku])

  useEffect(() => {
    if (!item?.id || text(item.ebay_category_id)) return
    if (!['review', 'finalised'].includes(text(item.status).toLowerCase())) return

    const suggestionKey = [
      item.id,
      item.item_type,
      item.gender,
      item.reporting_category,
      item.sub_category,
    ].map(text).join('|')

    if (autoSuggestedEbayCategoryRef.current === suggestionKey) return
    if (!text(item.reporting_category) && !text(item.sub_category)) return

    autoSuggestedEbayCategoryRef.current = suggestionKey

    const timer = window.setTimeout(async () => {
      try {
        const mappedCategory = await fetchMappedEbayCategory(item)
        if (mappedCategory) {
          const updatedItem = {
            ...item,
            ebay_category_id: mappedCategory.id,
            ebay_category_name: mappedCategory.name,
          }
          setItem(updatedItem)
          setHasUnsavedChanges(
            JSON.stringify(originalItemRef.current) !== JSON.stringify(updatedItem)
          )
          return
        }

        const suggestions = await fetchEbayCategorySuggestions(ebayCategoryQuery(item))
        if (!suggestions[0]) return
        const category = ebayCategoryFromSuggestion(suggestions[0])
        if (!category.id) return

        const updatedItem = {
          ...item,
          ebay_category_id: category.id,
          ebay_category_name: category.name,
        }
        setItem(updatedItem)
        setHasUnsavedChanges(
          JSON.stringify(originalItemRef.current) !== JSON.stringify(updatedItem)
        )
      } catch {
        // Automatic suggestion is convenience-only; manual category search remains available.
      }
    }, 700)

    return () => window.clearTimeout(timer)
  }, [item?.id, item?.status, item?.item_type, item?.gender, item?.reporting_category, item?.sub_category, item?.ebay_category_id])

  async function fetchItem() {
    let query = supabase
      .from('items')
      .select('*')
      .eq('id', id)

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data, error } = await query.single()

    if (error) {
      setMessage(error.message)
      return
    }

    let hydratedItem: any = data

    if (!text(hydratedItem.barcode_number)) {
      let identifierQuery = supabase
        .from('item_identifiers')
        .select('identifier_value')
        .eq('item_id', id)
        .eq('identifier_type', 'barcode')
        .eq('is_active', true)
        .limit(1)

      if (schemaReady) identifierQuery = identifierQuery.eq('company_id', activeCompanyId)

      const { data: barcodeIdentifier } = await identifierQuery.maybeSingle()

      if (barcodeIdentifier?.identifier_value) {
        hydratedItem = {
          ...hydratedItem,
          barcode_number: barcodeIdentifier.identifier_value,
        }
      } else if (/^\d+$/.test(text(hydratedItem.sku)) && !isDigitalSkuType(hydratedItem.sku_type)) {
        hydratedItem = {
          ...hydratedItem,
          barcode_number: hydratedItem.sku,
        }
      }
    }

    setItem(hydratedItem)
    originalItemRef.current = hydratedItem
    setHasUnsavedChanges(false)
  }

  async function fetchCompositionComponents() {
    if (!id) return

    try {
      setComponentMessage('')

      let query = supabase
        .from('item_composition_components')
        .select(
          `id, component_item_id, quantity, notes,
          component:items!item_composition_components_component_item_id_fkey(id, sku, final_title, basic_title, brand)`
        )
        .eq('composite_item_id', id)
        .order('created_at', { ascending: true })

      if (schemaReady) query = query.eq('company_id', activeCompanyId)

      const { data, error } = await query

      if (error) {
        setCompositionComponents([])
        setComponentMessage(error.message)
        return
      }

      setCompositionComponents(
        (data || []).map((row: any) => ({
          id: row.id,
          component_item_id: row.component_item_id,
          component_sku: row.component?.sku || '',
          quantity: String(row.quantity || 1),
          notes: row.notes || '',
        }))
      )
    } catch (error: any) {
      setCompositionComponents([])
      setComponentMessage(error.message || 'Composite components could not be loaded.')
    }
  }

  async function fetchChildSkuRows() {
    if (!id) return

    try {
      let query = supabase
        .from('items')
        .select('id, sku, variation_options')
        .eq('parent_item_id', id)
        .order('sku', { ascending: true })

      if (schemaReady) query = query.eq('company_id', activeCompanyId)

      const { data, error } = await query

      if (error) {
        setChildSkuRows([])
        return
      }

      setChildSkuRows(
        (data || []).map((row: any) => ({
          id: row.id,
          sku: row.sku || '',
          size: row.variation_options?.size || '',
          colour: row.variation_options?.colour || '',
          custom_name: row.variation_options?.custom_name || '',
          custom_value: row.variation_options?.custom_value || '',
        }))
      )
    } catch {
      setChildSkuRows([])
    }
  }

  async function fetchSubCategoryOptions(category: string | null | undefined) {
    const selectedCategory = text(category)

    if (!selectedCategory) {
      setSubCategoryOptions([])
      return
    }

    let query = supabase
      .from('items')
      .select('sub_category')
      .eq('reporting_category', selectedCategory)
      .not('sub_category', 'is', null)
      .limit(500)

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data } = await query

    setSubCategoryOptions(normaliseOptionList((data || []).map((row: any) => row.sub_category)))
  }

  async function fetchBrandOptions() {
    let query = supabase
      .from('items')
      .select('brand')
      .not('brand', 'is', null)
      .limit(1000)

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data } = await query

    setBrandOptions(normaliseOptionList((data || []).map((row: any) => row.brand)))
  }

  async function fetchPhotoStations() {
    if (schemaReady && !activeCompanyId) return

    try {
      setPhotoStationMessage('')
      const response = await fetch('/api/photography/stations')
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        setPhotoStations([])
        setPhotoStationMessage(data?.message || 'Photography stations could not be loaded.')
        return
      }

      const stations = (data.stations || []) as PhotoStation[]
      setPhotoStations(stations)
      setPhotoStationMessage(stations.length === 0 ? 'No photography station found for this company.' : '')

      setSelectedPhotoStationId((current) => {
        if (current && stations.some((station) => station.id === current)) return current
        return stations[0]?.id || ''
      })
    } catch (error: any) {
      setPhotoStations([])
      setPhotoStationMessage(error.message || 'Photography stations could not be loaded.')
    }
  }

  async function fetchMeasurementSuggestions() {
    if (!id) return

    try {
      const response = await fetch(
        `/api/photography/measurement-suggestions?item_id=${encodeURIComponent(id)}`
      )
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        setMeasurementSuggestions([])
        return
      }

      setMeasurementSuggestions((data.suggestions || []) as MeasurementSuggestion[])
    } catch {
      setMeasurementSuggestions([])
    }
  }

  async function startPhotoSession(
    options: { askOpenMode?: boolean; askStationChoice?: boolean; calibrationPrompt?: boolean } = {}
  ) {
    if (!item?.id) return
    if (photoStations.length === 0) {
      setMessage('No photography station found. Run the photography SQL migration first.')
      return
    }

    let stationId = selectedPhotoStationId || photoStations[0]?.id || ''

    if (photoStations.length > 1 && options.askStationChoice !== false) {
      const stationList = photoStations
        .map((station, index) => `${index + 1}. ${station.name}`)
        .join('\n')
      const choice = window.prompt(`Choose photography station:\n\n${stationList}`, '1')
      if (choice === null) return

      const selectedIndex = Number(choice) - 1
      const selectedStation = photoStations[selectedIndex]

      if (!selectedStation) {
        setMessage('Photo session cancelled. Station choice was not valid.')
        return
      }

      stationId = selectedStation.id
    }

    const openInNewWindow = options.askOpenMode
      ? window.confirm('Open Photo Monitor in a new window?\n\nOK = new window\nCancel = use this window')
      : true

    if (!stationId) {
      setMessage('No photography station selected.')
      return
    }

    if (photoSessionMatchesItem) {
      openPhotoMonitorWindow(stationId, openInNewWindow, { calibrationPrompt: options.calibrationPrompt === true })
      return
    }

    setSelectedPhotoStationId(stationId)
    setPhotoSessionBusy(true)
    setMessage('Starting photo session...')

    try {
      const response = await fetch('/api/photography/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          station_id: stationId,
          item_id: item.id,
          start_method: 'manual_button',
          staff_id: staff?.id || null,
        }),
      })

      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Photo session failed to start.')
      }

      await fetchPhotoStations()
      setMessage(`Photo session active for ${item.sku}.`)
      openPhotoMonitorWindow(stationId, openInNewWindow, { calibrationPrompt: options.calibrationPrompt === true })
    } catch (error: any) {
      setMessage(error.message || 'Photo session failed to start.')
    } finally {
      setPhotoSessionBusy(false)
    }
  }

  async function checkEbayReadiness(skuOverride?: string) {
    const sku = text(skuOverride || item?.sku)
    if (!sku) return

    try {
      const response = await fetch(`/api/integrations/ebay/listing-readiness?sku=${encodeURIComponent(sku)}`)
      const data = await response.json()

      setEbayReadiness(data)
    } catch (error: any) {
      setEbayReadiness({
        ok: false,
        ready: false,
        message: error.message || 'Could not check eBay readiness.',
      })
    }
  }

  async function getImageCount() {
    const { count } = await supabase
      .from('item_images')
      .select('*', { count: 'exact', head: true })
      .eq('item_id', id)

    return count || 0
  }

  async function getFirstTwoImageUrls() {
    const { data } = await supabase
      .from('item_images')
      .select('*')
      .eq('item_id', id)
      .order('image_order', { ascending: true })
      .limit(2)

    if (!data || data.length === 0) return []

    return data
      .map((image) => image.processed_url || image.original_url)
      .filter(Boolean)
  }


  async function getProcessedImageUrls() {
    const { data, error } = await supabase
      .from('item_images')
      .select('processed_url, original_url, image_order')
      .eq('item_id', id)
      .order('image_order', { ascending: true })

    if (error) {
      throw new Error(error.message)
    }

    return (data || [])
      .map((image) => image.processed_url || image.original_url)
      .filter(Boolean)
  }

  function blankToNull(value: any) {
    return value === '' ||
      value === null ||
      value === undefined ||
      String(value).trim() === ''
      ? null
      : value
  }

  function hasValue(value: any) {
    return !(
      value === '' ||
      value === null ||
      value === undefined ||
      String(value).trim() === ''
    )
  }

  function cleanNumber(value: any) {
    const cleaned = blankToNull(value)
    if (cleaned === null) return null

    const numberValue = Number(cleaned)
    return Number.isFinite(numberValue) ? numberValue : cleaned
  }

  function text(value: any) {
    if (value === null || value === undefined) return ''
    return String(value).trim()
  }

  function titleCaseWords(value: any) {
    return text(value)
      .toLowerCase()
      .replace(/\b([a-z])/g, (match) => match.toUpperCase())
  }

  function titleCaseTypedValue(value: any) {
    return String(value ?? '')
      .toLowerCase()
      .replace(/\b([a-z])/g, (match) => match.toUpperCase())
  }

  function displayLocationName(value: any) {
    const clean = text(value)
    const key = canonicalLocationKey(clean)
    const matchedKey = Object.keys(locationLabels).find(
      (locationKey) => canonicalLocationKey(locationKey) === key
    )
    return matchedKey ? locationLabels[matchedKey] || matchedKey : clean || '-'
  }

  function formatStockQuantity(value: any) {
    const numeric = Number(value || 0)
    return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2)
  }

  async function fetchLocationLabels() {
    if (!schemaReady || !activeCompanyId) return

    const { data, error } = await supabase
      .from('locations')
      .select('name, label')
      .eq('company_id', activeCompanyId)
      .eq('is_active', true)

    if (error) return

    const nextLabels: Record<string, string> = {}
    ;(data || []).forEach((row: any) => {
      const name = text(row.name)
      if (name) nextLabels[name] = text(row.label) || name
    })
    setLocationLabels(nextLabels)
  }

  async function fetchStockDetails() {
    if (!id || !schemaReady || !activeCompanyId) return

    try {
      setStockDetailsMessage('')
      const response = await fetch(`/api/stock/diagnostics?item_id=${encodeURIComponent(id)}&limit=1`)
      const payload = await response.json().catch(() => null)

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.message || payload?.error || 'Stock details failed to load.')
      }

      setStockDetails(payload.summaries?.[0] || null)
    } catch (error: any) {
      setStockDetails(null)
      setStockDetailsMessage(error.message || 'Stock details could not be loaded.')
    }
  }

  function normaliseOptionList(values: any[]) {
    const byKey = new Map<string, string>()

    for (const value of values) {
      const display = titleCaseWords(value)
      const key = display.toLowerCase()
      if (display && !byKey.has(key)) byKey.set(key, display)
    }

    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b))
  }

  function itemDetailValue(field: string, value: any) {
    if (!titleCaseItemDetailFields.has(field)) return value
    return titleCaseTypedValue(value)
  }

  function cleanTags(value: any) {
    const rawTags = Array.isArray(value)
      ? value
      : String(value || '')
          .split(',')

    return Array.from(
      new Set(
        rawTags
          .map((tag: any) => String(tag || '').replace(/^#+/, '').trim())
          .filter(Boolean)
      )
    ).slice(0, 10)
  }

  function tagsText(value: any) {
    return cleanTags(value).join(', ')
  }

  function openPhotoMonitorWindow(
    stationId: string,
    newWindow = true,
    options: { calibrationPrompt?: boolean } = {}
  ) {
    const query = new URLSearchParams({ station: stationId })
    if (options.calibrationPrompt) query.set('calibration_prompt', '1')
    const url = `/processing/photo-monitor?${query.toString()}`
    if (!newWindow) {
      window.location.href = url
      return
    }

    const monitor = window.open(url, 'loopbase-photo-monitor')
    monitor?.focus()
  }

  function normalizeScanIdentifier(value: string) {
    return value.trim().replace(/\s+/g, '').toUpperCase()
  }

  function escapePostgrestOrValue(value: string) {
    return value
      .replaceAll('\\', '\\\\')
      .replaceAll('%', '\\%')
      .replaceAll('_', '\\_')
      .replaceAll(',', '\\,')
  }

  async function findItemByCatalogueScan(scanValue: string) {
    const clean = text(scanValue)
    const normalized = normalizeScanIdentifier(clean)
    const safe = escapePostgrestOrValue(clean)
    const safeNormalized = escapePostgrestOrValue(normalized)

    let directQuery = supabase
      .from('items')
      .select('id, sku, barcode_number, rfid_tid_normalized')
      .or(`sku.eq.${safe},barcode_number.eq.${safe},rfid_tid_normalized.eq.${safeNormalized}`)
      .limit(2)

    if (schemaReady) directQuery = directQuery.eq('company_id', activeCompanyId)

    const { data: directRows, error: directError } = await directQuery
    if (directError) throw new Error(directError.message)
    if ((directRows || []).length === 1) return directRows?.[0] || null
    if ((directRows || []).length > 1) {
      throw new Error('Scan matched more than one item. Open it from Search/Create.')
    }

    let identifierQuery = supabase
      .from('item_identifiers')
      .select('item_id')
      .eq('identifier_value_normalized', normalized)
      .eq('is_active', true)
      .limit(2)

    if (schemaReady) identifierQuery = identifierQuery.eq('company_id', activeCompanyId)

    const { data: identifierRows, error: identifierError } = await identifierQuery
    if (identifierError) throw new Error(identifierError.message)
    if ((identifierRows || []).length > 1) {
      throw new Error('Identifier matched more than one item. Open it from Search/Create.')
    }

    const itemId = identifierRows?.[0]?.item_id
    if (!itemId) return null

    let itemQuery = supabase
      .from('items')
      .select('id, sku, barcode_number')
      .eq('id', itemId)

    if (schemaReady) itemQuery = itemQuery.eq('company_id', activeCompanyId)

    const { data: foundItem, error: itemError } = await itemQuery.maybeSingle()
    if (itemError) throw new Error(itemError.message)
    return foundItem || null
  }

  async function createCatalogueItemFromScan(scanValue: string) {
    if (!staff) throw new Error('No active staff selected. Go to staff PIN screen first.')

    const sku = text(scanValue).toUpperCase()
    if (!sku) throw new Error('Scan value is blank.')

    const now = new Date().toISOString()
    const { data: createdItem, error } = await supabase
      .from('items')
      .insert({
        ...(schemaReady ? { company_id: activeCompanyId } : {}),
        sku,
        status: 'working',
        stock_level: 1,
        sku_type: 'standard',
        location_status: 'stored',
        current_location: WAREHOUSE_LOCATION,
        current_bin: DEFAULT_BIN,
        loan_status: 'not_on_loan',
        ebay_status: 'not_listed',
        linnworks_status: 'not_synced',
        shopify_status: 'not_listed',
        square_status: 'not_listed',
        grailed_status: 'not_listed',
        vestiaire_collective_status: 'not_listed',
        whatnot_status: 'not_listed',
        vinted_status: 'not_listed',
        depop_status: 'not_listed',
        tiktok_shop_status: 'not_listed',
        last_saved_by: staff.id,
        updated_at: now,
      })
      .select('id, sku, barcode_number')
      .single()

    if (error) throw new Error(error.message)

    const response = await fetch('/api/items/stock-location', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        item_id: createdItem.id,
        sku: createdItem.sku,
        location_name: WAREHOUSE_LOCATION,
        bin_code: DEFAULT_BIN,
        stock_level: 1,
        source: 'catalogue_scan_create',
        company_id: schemaReady ? activeCompanyId : null,
      }),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok || result?.ok === false) {
      throw new Error(result?.error || 'Created item, but stock-location row failed.')
    }

    return createdItem
  }

  async function handleCatalogueNextScan() {
    const scan = text(catalogueNextScanValue)
    if (!scan) return

    if (hasUnsavedChanges) {
      setMessage('Unsaved changes. Save or send to review before scanning the next item.')
      setCatalogueNextScanOpen(false)
      return
    }

    setCatalogueNextScanBusy(true)
    setMessage('')

    try {
      let nextItem = await findItemByCatalogueScan(scan)

      if (!nextItem?.id) {
        const confirmed = window.confirm(
          `Item ${scan} is not in the system.\n\nCreate it and start a photo/catalogue session?`
        )

        if (!confirmed) {
          setCatalogueNextScanValue('')
          window.setTimeout(() => catalogueNextScanInputRef.current?.focus(), 50)
          return
        }

        nextItem = await createCatalogueItemFromScan(scan)
      }

      window.location.href = `/items/${nextItem.id}?catalogue=1&start_photo=1`
    } catch (error: any) {
      setMessage(error.message || 'Could not open next catalogue item.')
      setCatalogueNextScanValue('')
      window.setTimeout(() => catalogueNextScanInputRef.current?.focus(), 50)
    } finally {
      setCatalogueNextScanBusy(false)
    }
  }

  function ebayCategoryQuery(source: any = item) {
    return [
      text(source?.gender),
      text(source?.sub_category),
      text(source?.reporting_category),
      text(source?.item_type),
    ]
      .filter(Boolean)
      .join(' ')
  }

  function ebayCategoryFromSuggestion(suggestion: any) {
    return {
      id: text(suggestion?.category?.categoryId),
      name: text(suggestion?.category?.categoryName),
      ancestors: Array.isArray(suggestion?.categoryTreeNodeAncestors)
        ? suggestion.categoryTreeNodeAncestors
        : [],
    }
  }

  function ebayCategoryPath(suggestion: any) {
    const category = ebayCategoryFromSuggestion(suggestion)
    const ancestors = category.ancestors
      .slice()
      .sort((a: any, b: any) => Number(a.categoryTreeNodeLevel || 0) - Number(b.categoryTreeNodeLevel || 0))
      .map((ancestor: any) => text(ancestor.categoryName))
      .filter(Boolean)

    return [...ancestors, category.name].filter(Boolean).join(' > ')
  }

  async function fetchEbayCategorySuggestions(query: string) {
    const q = text(query)
    if (!q) return []

    const response = await fetch(
      `/api/integrations/ebay/category-suggestions?q=${encodeURIComponent(q)}`
    )
    const data = await response.json()

    if (!response.ok || data?.ok === false) {
      throw new Error(data?.message || 'Could not search eBay categories.')
    }

    return Array.isArray(data?.suggestions) ? data.suggestions : []
  }

  async function fetchMappedEbayCategory(source: any = item) {
    if (text(source?.ebay_category_id)) return null

    let query = supabase
      .from('integration_settings')
      .select('settings')
      .eq('channel', 'ebay')

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data, error } = await query.maybeSingle()

    if (error) throw new Error(error.message)

    const settings = mergeEbaySettings(data?.settings || {})
    const mapping = findBestEbayCategoryMapping(source, settings.category_mappings)
    if (!mapping?.ebay_category_id) return null

    return {
      id: text(mapping.ebay_category_id),
      name: text(mapping.ebay_category_name),
      mapped: true,
    }
  }

  function applyEbayCategorySuggestion(suggestion: any) {
    const category = ebayCategoryFromSuggestion(suggestion)
    if (!category.id) return

    const updatedItem = {
      ...item,
      ebay_category_id: category.id,
      ebay_category_name: category.name,
    }

    setItem(updatedItem)
    setHasUnsavedChanges(
      JSON.stringify(originalItemRef.current) !== JSON.stringify(updatedItem)
    )
    setMessage(`Selected eBay category ${category.name || category.id}. Save item to keep it.`)
  }

  function clearEbayCategory() {
    const updatedItem = {
      ...item,
      ebay_category_id: '',
      ebay_category_name: '',
    }

    setItem(updatedItem)
    setHasUnsavedChanges(
      JSON.stringify(originalItemRef.current) !== JSON.stringify(updatedItem)
    )
  }

  async function searchEbayCategories(queryOverride?: string) {
    const query = text(queryOverride || ebayCategorySearch || ebayCategoryQuery())
    if (!query) {
      setMessage('Enter an eBay category search term first.')
      return
    }

    setSearchingEbayCategories(true)
    setMessage('Searching eBay categories...')

    try {
      setEbayCategorySearch(query)
      const suggestions = await fetchEbayCategorySuggestions(query)
      setEbayCategorySuggestions(suggestions)
      setMessage(`Loaded ${suggestions.length} eBay category suggestion(s).`)
    } catch (error: any) {
      setMessage(error.message || 'Could not search eBay categories.')
    } finally {
      setSearchingEbayCategories(false)
    }
  }

  async function suggestEbayCategory() {
    const query = ebayCategoryQuery()
    if (!query) {
      setMessage('Add category fields before suggesting an eBay category.')
      return
    }

    setSearchingEbayCategories(true)
    setMessage('Finding best eBay category...')

    try {
      const mappedCategory = await fetchMappedEbayCategory(item)
      if (mappedCategory) {
        const updatedItem = {
          ...item,
          ebay_category_id: mappedCategory.id,
          ebay_category_name: mappedCategory.name,
        }

        setItem(updatedItem)
        setHasUnsavedChanges(
          JSON.stringify(originalItemRef.current) !== JSON.stringify(updatedItem)
        )
        setMessage(`Selected mapped eBay category ${mappedCategory.name || mappedCategory.id}. Save item to keep it.`)
        return
      }

      const suggestions = await fetchEbayCategorySuggestions(query)
      setEbayCategorySearch(query)
      setEbayCategorySuggestions(suggestions)

      if (suggestions[0]) {
        applyEbayCategorySuggestion(suggestions[0])
      } else {
        setMessage('No eBay category suggestions found.')
      }
    } catch (error: any) {
      setMessage(error.message || 'Could not suggest eBay category.')
    } finally {
      setSearchingEbayCategories(false)
    }
  }

  async function bestEbayCategoryForReview(source: any) {
    if (text(source?.ebay_category_id)) return null

    const mappedCategory = await fetchMappedEbayCategory(source)
    if (mappedCategory) return mappedCategory

    const query = ebayCategoryQuery(source)
    if (!query) return null

    const suggestions = await fetchEbayCategorySuggestions(query)
    const suggestion = suggestions[0]
    if (!suggestion) return null

    return ebayCategoryFromSuggestion(suggestion)
  }

  function canonicalLocationKey(value: string | null | undefined) {
    const key = text(value).toUpperCase().replace(/[\s_]+/g, '-')
    if (key === 'WAREHOUSE') return 'LOCATION-1'
    if (key === 'SHOP-1') return 'LOCATION-2'
    if (key === 'SHOP-2') return 'LOCATION-3'
    if (key === 'SHOP-3') return 'LOCATION-4'
    if (key === 'SHOP-4') return 'LOCATION-5'
    return key
  }

  async function upsertPrimaryStockLocation(savedItem: any) {
    const locationName = canonicalLocationKey(savedItem.current_location) || WAREHOUSE_LOCATION
    const binCode = text(savedItem.current_bin) || DEFAULT_BIN
    const stockLevel = Number(savedItem.stock_level || 0)
    const response = await fetch('/api/items/stock-location', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        item_id: id,
        sku: savedItem.sku,
        location_name: locationName,
        bin_code: binCode,
        stock_level: stockLevel,
        source: 'item_edit_stock_level',
        company_id: schemaReady ? activeCompanyId : null,
      }),
    })

    const result = await response.json()

    if (!response.ok || result?.ok === false) {
      throw new Error(result?.error || 'Stock location update failed.')
    }
  }

  function updateReportingCategory(newCategory: string) {
    if (!item) return
    const formattedCategory = itemDetailValue('reporting_category', newCategory)

    const allowedMeasurements = measurementMap[formattedCategory] || []
    const measurementsToClear = allMeasurementFields.filter(
      (field) => !allowedMeasurements.includes(field) && hasValue(item[field])
    )

    if (measurementsToClear.length > 0) {
      const labels = measurementsToClear.map(
        (field) => measurementLabels[field] || field
      )

      const confirmed = window.confirm(
        `Changing category to ${formattedCategory || 'blank'} will remove these measurement value(s):\n\n${labels.join(
          ', '
        )}\n\nContinue?`
      )

      if (!confirmed) return
    }

    const updatedItem: any = {
      ...item,
      reporting_category: formattedCategory,
    }

    for (const field of measurementsToClear) {
      updatedItem[field] = null
    }

    setItem(updatedItem)
    setHasUnsavedChanges(
      JSON.stringify(originalItemRef.current) !== JSON.stringify(updatedItem)
    )
  }

  async function createProcessedBlob(imageUrl: string) {
    const response = await fetch(imageUrl)
    const blob = await response.blob()

    const bitmap = await createImageBitmap(blob)

    const maxSize = 1600
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')

    if (!ctx) {
      throw new Error('Could not process image.')
    }

    ctx.drawImage(bitmap, 0, 0, width, height)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (processedBlob) => {
          if (!processedBlob) {
            reject(new Error('Could not create processed image.'))
            return
          }

          resolve(processedBlob)
        },
        'image/jpeg',
        0.85
      )
    })
  }

  async function ensureProcessedImages() {
    const { data, error } = await supabase
      .from('item_images')
      .select('*')
      .eq('item_id', id)
      .order('image_order', { ascending: true })

    if (error) {
      throw new Error(error.message)
    }

    const images = data || []

    for (const image of images) {
      const existingProcessedUrl = String(image.processed_url || '').trim()
      const originalUrl = String(image.original_url || '').trim()
      const hasGenuineProcessedImage = existingProcessedUrl && (!originalUrl || existingProcessedUrl !== originalUrl)

      if (hasGenuineProcessedImage) {
        const retentionUpdate: Record<string, unknown> = {}
        if (originalUrl && !image.original_delete_after) {
          retentionUpdate.original_delete_after = originalDeleteAfterIso()
          retentionUpdate.original_retention_status = 'cleanup_scheduled'
        }
        if (!image.baseline_processed_url) {
          retentionUpdate.baseline_processed_url = existingProcessedUrl
          retentionUpdate.baseline_processed_storage_bucket = image.processed_storage_bucket || 'item-images'
          retentionUpdate.baseline_processed_storage_path = image.processed_storage_path || null
          retentionUpdate.baseline_processed_file_size_bytes = image.processed_file_size_bytes || null
          retentionUpdate.baseline_processed_created_at = new Date().toISOString()
        }

        if (Object.keys(retentionUpdate).length > 0) {
          const { error: updateError } = await supabase
            .from('item_images')
            .update(retentionUpdate)
            .eq('id', image.id)

          if (updateError) {
            throw new Error(updateError.message)
          }
        }
        continue
      }

      const sourceUrl = originalUrl || existingProcessedUrl

      if (!sourceUrl) continue

      const processedBlob = await createProcessedBlob(sourceUrl)
      const path = `processed/${id}/${image.id}.jpg`

      const { error: uploadError } = await supabase.storage
        .from('item-images')
        .upload(path, processedBlob, {
          contentType: 'image/jpeg',
          cacheControl: '0',
          upsert: true,
        })

      if (uploadError) {
        throw new Error(uploadError.message)
      }

      const { data: publicUrlData } = supabase.storage
        .from('item-images')
        .getPublicUrl(path)

      const processedUrl = publicUrlData.publicUrl

      const imageUpdate: Record<string, unknown> = {
        processed_url: processedUrl,
        processed_storage_bucket: 'item-images',
        processed_storage_path: path,
        processed_file_size_bytes: processedBlob.size,
        original_delete_after: originalDeleteAfterIso(),
        original_retention_status: 'cleanup_scheduled',
      }

      if (!image.baseline_processed_url) {
        imageUpdate.baseline_processed_url = processedUrl
        imageUpdate.baseline_processed_storage_bucket = 'item-images'
        imageUpdate.baseline_processed_storage_path = path
        imageUpdate.baseline_processed_file_size_bytes = processedBlob.size
        imageUpdate.baseline_processed_created_at = new Date().toISOString()
      }

      const { error: updateError } = await supabase
        .from('item_images')
        .update(imageUpdate)
        .eq('id', image.id)

      if (updateError) {
        throw new Error(updateError.message)
      }
    }

    setPhotoRefreshKey((current) => current + 1)
  }

  function missingFinaliseFields(itemToCheck: any, imageCount: number) {
    const isDigitalSku = isDigitalSkuType(itemToCheck?.sku_type)

    const required = isDigitalSku
      ? [
          ['brand', 'Brand'],
          ['reporting_category', 'Reporting Category'],
          ['sub_category', 'Sub Category'],
          ['selling_price', 'Sale Price'],
        ]
      : [
          ['reporting_category', 'Category'],
          ['cost_price', 'Cost Price'],
          ['selling_price', 'Sale Price'],
          ['brand', 'Brand'],
          ['ai_title', 'AI Marketplace Title'],
          ['ai_description', 'AI Description'],
          ['website_title', 'Website Title'],
        ]

    const missing = required
      .filter(([key]) => {
        if (key === 'sub_category') return !itemToCheck.sub_category
        return !itemToCheck[key]
      })
      .map(([_, label]) => label)

    if (!isDigitalSku && imageCount < 1) {
      missing.push('Image')
    }

    return missing
  }

  async function requestAiCopy(itemForCopy: any) {
    const imageUrls = await getFirstTwoImageUrls()
    const response = await fetch('/api/generate-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: itemForCopy, imageUrls }),
    })

    const result = await response.json()

    if (!response.ok) {
      throw new Error(result.error || 'AI generation failed')
    }

    return {
      ai_title: result.ai_title || '',
      ai_description: result.ai_description || '',
      website_title: result.website_title || '',
      marketplace_tags: cleanTags(result.marketplace_tags),
    }
  }

  async function syncItemIdentifiers(savedItem: any) {
    const companyId = schemaReady ? activeCompanyId : savedItem.company_id
    const identifiers = [
      { type: 'sku', value: text(savedItem.sku) },
      { type: 'barcode', value: text(savedItem.barcode_number) },
    ].filter((identifier) => identifier.value)

    if (companyId) {
      await supabase
        .from('item_identifiers')
        .update({ is_active: false })
        .eq('company_id', companyId)
        .eq('item_id', id)
        .in('identifier_type', ['sku', 'barcode'])
    }

    for (const identifier of identifiers) {
      const normalized = identifier.value.toUpperCase().replace(/\s+/g, '')
      const row: Record<string, unknown> = {
        item_id: id,
        sku: savedItem.sku,
        identifier_type: identifier.type,
        identifier_value: identifier.value,
        identifier_value_normalized: normalized,
        is_active: true,
        assigned_by: staff?.id || null,
      }

      if (companyId) row.company_id = companyId

      let existingQuery = supabase
        .from('item_identifiers')
        .select('id')
        .eq('item_id', id)
        .eq('identifier_type', identifier.type)
        .eq('identifier_value_normalized', normalized)
        .limit(1)

      if (companyId) existingQuery = existingQuery.eq('company_id', companyId)

      const { data: existing, error: existingError } = await existingQuery.maybeSingle()
      if (existingError) throw new Error(existingError.message)

      if (existing?.id) {
        const { error } = await supabase
          .from('item_identifiers')
          .update(row)
          .eq('id', existing.id)

        if (error) throw new Error(error.message)
      } else {
        const { error } = await supabase
          .from('item_identifiers')
          .insert(row)

        if (error) throw new Error(error.message)
      }
    }
  }

  async function generateBarcodeNumber() {
    if (!item) return

    try {
      const [candidate] = await reserveGeneratedSkus(1)
      if (!candidate) throw new Error('Generated SKU reservation returned no barcode.')
      updateField('barcode_number', candidate)
      setMessage('Generated barcode. Save item to keep it.')
    } catch (error: any) {
      setMessage(error?.message || 'Could not generate a unique barcode. Try again.')
    }
  }

  async function resolveComponentItemId(component: CompositionComponentRow) {
    if (component.component_item_id) return component.component_item_id

    const cleanSku = text(component.component_sku)
    if (!cleanSku) return ''

    let query = supabase
      .from('items')
      .select('id')
      .eq('sku', cleanSku)
      .neq('id', id)
      .limit(1)

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data, error } = await query.maybeSingle()
    if (error) throw new Error(error.message)
    if (!data?.id) throw new Error(`Component SKU ${cleanSku} was not found for this company.`)

    return data.id
  }

  async function saveCompositionComponents(savedItem: any) {
    const cleaned = compositionComponents
      .map((component) => ({
        ...component,
        component_sku: text(component.component_sku),
        quantity: String(component.quantity || '').trim(),
      }))
      .filter((component) => component.component_sku)

    let deleteQuery = supabase
      .from('item_composition_components')
      .delete()
      .eq('composite_item_id', id)

    if (schemaReady) deleteQuery = deleteQuery.eq('company_id', activeCompanyId)

    const { error: deleteError } = await deleteQuery
    if (deleteError) throw new Error(deleteError.message)

    if (cleaned.length === 0) {
      setCompositionComponents([])
      return
    }

    const rows = []

    for (const component of cleaned) {
      const componentItemId = await resolveComponentItemId(component)
      const quantity = Number(component.quantity)

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(`Component quantity for ${component.component_sku} must be greater than 0.`)
      }

      rows.push({
        company_id: schemaReady ? activeCompanyId : savedItem.company_id,
        composite_item_id: id,
        component_item_id: componentItemId,
        quantity,
        notes: text(component.notes) || null,
      })
    }

    const { error: insertError } = await supabase
      .from('item_composition_components')
      .insert(rows)

    if (insertError) throw new Error(insertError.message)

    await fetchCompositionComponents()
  }

  async function saveChildSkuRows(savedItem: any) {
    const cleaned = childSkuRows
      .map((child) => ({
        ...child,
        sku: text(child.sku).toUpperCase(),
        size: text(child.size),
        colour: text(child.colour),
        custom_name: text(child.custom_name),
        custom_value: text(child.custom_value),
      }))
      .filter((child) => child.sku)

    let existingQuery = supabase
      .from('items')
      .select('id')
      .eq('parent_item_id', id)

    if (schemaReady) existingQuery = existingQuery.eq('company_id', activeCompanyId)

    const { data: existingRows, error: existingError } = await existingQuery
    if (existingError) throw new Error(existingError.message)

    const keepIds = new Set(cleaned.map((child) => child.id).filter(Boolean))
    const removeIds = (existingRows || [])
      .map((row: any) => row.id)
      .filter((childId: string) => !keepIds.has(childId))

    if (removeIds.length > 0) {
      let clearQuery = supabase
        .from('items')
        .update({
          parent_item_id: null,
          item_kind: 'standard',
          variation_options: {},
          updated_at: new Date().toISOString(),
        })
        .in('id', removeIds)

      if (schemaReady) clearQuery = clearQuery.eq('company_id', activeCompanyId)

      const { error } = await clearQuery
      if (error) throw new Error(error.message)
    }

    for (const child of cleaned) {
      const variationOptions = {
        size: child.size || null,
        colour: child.colour || null,
        custom_name: child.custom_name || null,
        custom_value: child.custom_value || null,
      }

      if (child.id) {
        let updateQuery = supabase
          .from('items')
          .update({
            sku: child.sku,
            parent_item_id: id,
            item_kind: 'variation_child',
            variation_group_key: text(savedItem.sku) || null,
            variation_options: variationOptions,
            updated_at: new Date().toISOString(),
          })
          .eq('id', child.id)

        if (schemaReady) updateQuery = updateQuery.eq('company_id', activeCompanyId)

        const { error } = await updateQuery
        if (error) throw new Error(error.message)
        continue
      }

      let matchQuery = supabase
        .from('items')
        .select('id')
        .eq('sku', child.sku)
        .neq('id', id)
        .limit(1)

      if (schemaReady) matchQuery = matchQuery.eq('company_id', activeCompanyId)

      const { data: matchedChild, error: matchError } = await matchQuery.maybeSingle()
      if (matchError) throw new Error(matchError.message)

      if (matchedChild?.id) {
        let linkQuery = supabase
          .from('items')
          .update({
            parent_item_id: id,
            item_kind: 'variation_child',
            variation_group_key: text(savedItem.sku) || null,
            variation_options: variationOptions,
            updated_at: new Date().toISOString(),
          })
          .eq('id', matchedChild.id)

        if (schemaReady) linkQuery = linkQuery.eq('company_id', activeCompanyId)

        const { error: linkError } = await linkQuery
        if (linkError) throw new Error(linkError.message)
        continue
      }

      const now = new Date().toISOString()
      const childInsert: Record<string, unknown> = {
        ...(schemaReady ? { company_id: activeCompanyId } : {}),
        sku: child.sku,
        status: savedItem.status || 'working',
        stock_level: 0,
        sku_type: 'standard',
        location_status: 'stored',
        current_location: canonicalLocationKey(savedItem.current_location) || WAREHOUSE_LOCATION,
        current_bin: text(savedItem.current_bin) || DEFAULT_BIN,
        loan_status: 'not_on_loan',
        ebay_status: 'not_listed',
        linnworks_status: 'not_synced',
        shopify_status: 'not_listed',
        square_status: 'not_listed',
        grailed_status: 'not_listed',
        vestiaire_collective_status: 'not_listed',
        whatnot_status: 'not_listed',
        vinted_status: 'not_listed',
        depop_status: 'not_listed',
        tiktok_shop_status: 'not_listed',
        parent_item_id: id,
        item_kind: 'variation_child',
        variation_group_key: text(savedItem.sku) || null,
        variation_options: variationOptions,
        brand: blankToNull(savedItem.brand),
        reporting_category: blankToNull(savedItem.reporting_category),
        sub_category: blankToNull(savedItem.sub_category),
        sub_type: blankToNull(savedItem.sub_category),
        item_type: blankToNull(savedItem.item_type),
        gender: blankToNull(savedItem.gender),
        condition: blankToNull(savedItem.condition),
        material: blankToNull(savedItem.material),
        colour_primary: child.colour || blankToNull(savedItem.colour_primary),
        colour_secondary: blankToNull(savedItem.colour_secondary),
        tagged_size: child.size || blankToNull(savedItem.tagged_size),
        era: blankToNull(savedItem.era),
        style: blankToNull(savedItem.style),
        flaws: blankToNull(savedItem.flaws),
        cost_price: blankToNull(savedItem.cost_price),
        selling_price: blankToNull(savedItem.selling_price),
        hs_code: blankToNull(savedItem.hs_code),
        country_of_origin: blankToNull(savedItem.country_of_origin),
        composition: blankToNull(savedItem.composition),
        shipping_size_identifier: blankToNull(savedItem.shipping_size_identifier),
        package_weight_grams: blankToNull(savedItem.package_weight_grams),
        package_length_cm: blankToNull(savedItem.package_length_cm),
        package_width_cm: blankToNull(savedItem.package_width_cm),
        package_height_cm: blankToNull(savedItem.package_height_cm),
        vat_rule: savedItem.vat_rule || 'channel_default',
        vat_rate: savedItem.vat_rule === 'custom' ? blankToNull(savedItem.vat_rate) : null,
        last_saved_by: staff?.id || null,
        updated_at: now,
      }

      const { data: createdChild, error: createError } = await supabase
        .from('items')
        .insert(childInsert)
        .select('id, sku')
        .single()

      if (createError) throw new Error(createError.message)

      const childStockRow: Record<string, unknown> = {
        ...(schemaReady ? { company_id: activeCompanyId } : {}),
        item_id: createdChild.id,
        sku: createdChild.sku,
        location_name: canonicalLocationKey(savedItem.current_location) || WAREHOUSE_LOCATION,
        location_id: null,
        bin_code: text(savedItem.current_bin) || DEFAULT_BIN,
        stock_level: 0,
        source: 'variation_child_created',
        updated_at: now,
      }

      const { error: stockError } = await supabase
        .from('item_stock_locations')
        .upsert(childStockRow, { onConflict: 'company_id,item_id,location_name,bin_code' })

      if (stockError) throw new Error(stockError.message)

      const childIdentifierRow: Record<string, unknown> = {
        ...(schemaReady ? { company_id: activeCompanyId } : {}),
        item_id: createdChild.id,
        sku: createdChild.sku,
        identifier_type: 'sku',
        identifier_value: createdChild.sku,
        identifier_value_normalized: createdChild.sku.toUpperCase().replace(/\s+/g, ''),
        is_active: true,
        assigned_by: staff?.id || null,
      }

      const { error: identifierError } = await supabase
        .from('item_identifiers')
        .insert(childIdentifierRow)

      if (identifierError) throw new Error(identifierError.message)
    }

    if (cleaned.length > 0) {
      let parentQuery = supabase
        .from('items')
        .update({
          item_kind: 'parent',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)

      if (schemaReady) parentQuery = parentQuery.eq('company_id', activeCompanyId)

      const { error } = await parentQuery
      if (error) throw new Error(error.message)
    }

    await fetchChildSkuRows()
  }

  function needsAiCopy(itemToCheck: any) {
    return !text(itemToCheck?.ai_title) || !text(itemToCheck?.ai_description) || !text(itemToCheck?.website_title)
  }

  async function generateAiCopy() {
    if (!item) return

    setGeneratingAi(true)

    try {
      const generated = await requestAiCopy(item)
      const updatedItem = {
        ...item,
        ...generated,
      }

      setItem(updatedItem)
      setHasUnsavedChanges(
        JSON.stringify(originalItemRef.current) !== JSON.stringify(updatedItem)
      )
      setMessage('AI copy generated')
    } catch (error: any) {
      setMessage(error.message)
    } finally {
      setGeneratingAi(false)
    }
  }

  function finishChannelProgress(progress: Omit<ChannelProgress, 'open'>) {
    setChannelProgress({ ...progress, open: true })

    if (progress.status === 'success') {
      window.setTimeout(() => {
        setChannelProgress((current) =>
          current.status === 'success' ? { ...current, open: false } : current
        )
      }, 1500)
    }
  }

  async function exportItemToLinnworks(itemToExport: any) {
    setExportingLinnworks(true)

    try {
      const processedImageUrls = await getProcessedImageUrls()

      await supabase
        .from('items')
        .update({
          linnworks_status: 'pending',
          linnworks_sync_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq(schemaReady ? 'company_id' : 'id', schemaReady ? activeCompanyId : id)

      const response = await fetch('/api/integrations/linnworks/export-item', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildLinnworksPayload(itemToExport, processedImageUrls)),
      })

      const data = await response.json()

      if (!response.ok || !data.ok) {
        throw new Error(data.message || 'Linnworks export failed.')
      }

      const exportedItem = {
        ...itemToExport,
        linnworks_status: 'synced',
        linnworks_managed: true,
        linnworks_item_id: data.linnworks_item_id,
        linnworks_item_number: data.linnworks_item_number,
        linnworks_synced_at: new Date().toISOString(),
        linnworks_sync_error: null,
        updated_at: new Date().toISOString(),
      }

      const { error: updateError } = await supabase
        .from('items')
        .update({
          linnworks_status: exportedItem.linnworks_status,
          linnworks_managed: exportedItem.linnworks_managed,
          linnworks_item_id: exportedItem.linnworks_item_id,
          linnworks_item_number: exportedItem.linnworks_item_number,
          linnworks_synced_at: exportedItem.linnworks_synced_at,
          linnworks_sync_error: null,
          updated_at: exportedItem.updated_at,
        })
        .eq('id', id)
        .eq(schemaReady ? 'company_id' : 'id', schemaReady ? activeCompanyId : id)

      if (updateError) {
        throw new Error(updateError.message)
      }

      return exportedItem
    } catch (error: any) {
      await supabase
        .from('items')
        .update({
          linnworks_status: 'failed',
          linnworks_sync_error: error.message || 'Unknown export error.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq(schemaReady ? 'company_id' : 'id', schemaReady ? activeCompanyId : id)

      throw error
    } finally {
      setExportingLinnworks(false)
    }
  }

  function exportedChannelsForItem(source: any) {
    return CHANNEL_UPDATE_REGISTRY.filter((channel) => {
      if ('isLive' in channel && channel.isLive?.(source)) return true
      const status = text(source?.[channel.statusField]).toLowerCase()
      return channel.liveStatuses.includes(status as any)
    }).map((channel): ExportedChannel => ({
      key: channel.key,
      label: channel.label,
      statusField: channel.statusField,
      supported: Boolean(channel.updateHandler),
      updateHandler: channel.updateHandler,
    }))
  }

  function changedVariationRestrictedFields() {
    const restrictedFields = [
      ['item_type', 'Item type'],
      ['reporting_category', 'Category'],
      ['sub_category', 'Sub category'],
      ['gender', 'Gender'],
      ['condition', 'Condition'],
      ['brand', 'Brand'],
      ['colour_primary', 'Primary colour'],
      ['colour_secondary', 'Secondary colour'],
      ['tagged_size', 'Tagged size'],
      ['material', 'Material'],
      ['era', 'Era'],
      ['style', 'Style'],
      ['ebay_category_id', 'eBay category'],
      ['ebay_category_name', 'eBay category name'],
    ]

    return restrictedFields
      .filter(([field]) => text(originalItemRef.current?.[field]) !== text(item?.[field]))
      .map(([, label]) => label)
  }

  function shouldWarnEbayVariationLock() {
    const ebayStatus = text(originalItemRef.current?.ebay_status).toLowerCase()
    const isEbayListed = ['listed', 'active', 'pending_update', 'failed'].includes(ebayStatus)
    const hasChildVariations = childSkuRows.length > 0 || text(item?.item_kind) === 'parent' || text(item?.sku_type) === 'parent_child'

    return isEbayListed && hasChildVariations
  }

  async function exportItemToEbay(itemToExport: any) {
    await supabase
      .from('items')
      .update({
        ebay_status: 'pending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq(schemaReady ? 'company_id' : 'id', schemaReady ? activeCompanyId : id)

    const readinessResponse = await fetch(
      `/api/integrations/ebay/listing-readiness?sku=${encodeURIComponent(itemToExport.sku)}`
    )
    const readiness = await readinessResponse.json()
    if (!readinessResponse.ok || !readiness?.ok) {
      throw new Error(readiness?.message || 'eBay readiness check failed.')
    }

    const draftResponse = await fetch('/api/integrations/ebay/shadow-draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ readiness }),
    })
    const draft = await draftResponse.json()
    if (!draftResponse.ok || !draft?.ok) {
      throw new Error(draft?.message || 'Could not save eBay draft.')
    }

    const publishResponse = await fetch('/api/integrations/ebay/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sku: itemToExport.sku }),
    })
    const published = await publishResponse.json()
    if (!publishResponse.ok || !published?.ok) {
      throw new Error(published?.message || 'Could not update eBay listing.')
    }

    const exportedItem = {
      ...itemToExport,
      ebay_status: 'listed',
      ebay_sync_error: null,
      channel_pending_update_at: null,
      updated_at: new Date().toISOString(),
    }

    setEbayReadiness(readiness)
    return exportedItem
  }

  async function offerExportUpdatesAfterFinalisedSave(savedItem: any, previouslyExportedChannels: ReturnType<typeof exportedChannelsForItem>) {
    const supportedChannels = previouslyExportedChannels.filter((channel) => channel.supported)

    if (previouslyExportedChannels.length === 0) return savedItem

    async function markPendingUpdate() {
      const updates = {
        ...channelPendingUpdates(previouslyExportedChannels),
        channel_pending_update_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      await supabase
        .from('items')
        .update(updates)
        .eq('id', id)
        .eq(schemaReady ? 'company_id' : 'id', schemaReady ? activeCompanyId : id)

      const pendingItem = { ...savedItem, ...updates }
      setItem(pendingItem)
      originalItemRef.current = pendingItem
      setHasUnsavedChanges(false)
      setMessage('Saved item. Published channel changes are marked as pending update.')
      return pendingItem
    }

    if (supportedChannels.length === 0) return markPendingUpdate()

    const supportedText = supportedChannels.map((channel) => channel.label).join(', ')
    const promptLines = [
      `Saved ${savedItem.sku}.`,
      '',
      `Export updated details to: ${supportedText}?`,
    ]

    if (!window.confirm(promptLines.join('\n'))) {
      return markPendingUpdate()
    }

    let nextItem = savedItem
    const results: string[] = []
    const failures: string[] = []
    setChannelProgress({
      open: true,
      status: 'working',
      title: 'Publishing item updates',
      message: `${savedItem.sku} to ${supportedText}`,
    })

    for (const channel of supportedChannels) {
      try {
        if (channel.updateHandler === 'linnworks') {
          nextItem = await exportItemToLinnworks(nextItem)
        }

        if (channel.updateHandler === 'ebay') {
          nextItem = await exportItemToEbay(nextItem)
        }

        results.push(`${channel.label}: complete`)
      } catch (error: any) {
        const errorMessage = error.message || 'Unknown error'
        failures.push(`${channel.label}: ${errorMessage}`)
        if (channel.updateHandler === 'ebay') {
          await supabase
            .from('items')
            .update({
              ebay_status: 'failed',
              ebay_sync_error: errorMessage,
              updated_at: new Date().toISOString(),
            })
            .eq('id', id)
            .eq(schemaReady ? 'company_id' : 'id', schemaReady ? activeCompanyId : id)

          nextItem = {
            ...nextItem,
            ebay_status: 'failed',
            ebay_sync_error: errorMessage,
          }
        }

        results.push(`${channel.label}: failed - ${errorMessage}`)
      }
    }

    setItem(nextItem)
    originalItemRef.current = nextItem
    setHasUnsavedChanges(false)
    finishChannelProgress({
      status: failures.length > 0 ? 'failed' : 'success',
      title: failures.length > 0 ? 'Channel update failed' : 'Channel update complete',
      message: results.join(' - '),
      details: failures,
    })

    return nextItem
  }

  async function saveItem(options: { promptChannelExport?: boolean } = {}) {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return null
    }

    const hadUnsavedChanges = hasUnsavedChanges
    const previouslyExportedChannels =
      options.promptChannelExport && hadUnsavedChanges && text(originalItemRef.current?.status).toLowerCase() === 'finalised'
        ? exportedChannelsForItem(originalItemRef.current)
        : []

    const oldStockLevel = cleanNumber(originalItemRef.current?.stock_level)
    const newStockLevel = cleanNumber(item.stock_level)

    const stockLevelChanged =
      String(oldStockLevel ?? '') !== String(newStockLevel ?? '')

    const priceChanged =
      String(originalItemRef.current?.cost_price || '') !==
        String(item.cost_price || '') ||
      String(originalItemRef.current?.selling_price || '') !==
        String(item.selling_price || '')

    const isLinnworksManaged =
      originalItemRef.current?.linnworks_managed === true || item.linnworks_managed === true

    const skuChanged =
      text(originalItemRef.current?.sku).toUpperCase() !== text(item.sku).toUpperCase()

    const variationRestrictedChanges = shouldWarnEbayVariationLock()
      ? changedVariationRestrictedFields()
      : []

    if (variationRestrictedChanges.length > 0) {
      const confirmed = window.confirm(
        `This SKU appears to be an eBay variation/parent listing.\n\nIf any variation has already recorded a purchase on eBay, eBay permanently locks some variation-specific fields. Price and quantity can usually still be updated, but these edits may require creating a new eBay listing:\n\n${variationRestrictedChanges.join(', ')}\n\nSave these changes in Loopbase anyway?`
      )

      if (!confirmed) return null
    }

    if (skuChanged && isLinnworksManaged) {
      const confirmed = window.confirm(
        'This item is already managed by Linnworks. Linnworks may not allow the SKU/item number to be changed safely.\n\nSave the SKU change in Loopbase anyway?'
      )

      if (!confirmed) return null
    }

    const shouldQueueStockSync = stockLevelChanged && isLinnworksManaged

    const cleanedItem = {
      ...item,
      sku: text(item.sku).toUpperCase(),
      barcode_number: blankToNull(item.barcode_number),
      status: item.status === 'processed' ? 'finalised' : item.status,

      cost_price: blankToNull(item.cost_price),
      selling_price: blankToNull(item.selling_price),
      stock_level: newStockLevel,
      sku_type: item.sku_type || 'standard',
      item_type: blankToNull(item.item_type),
      sub_category: blankToNull(item.sub_category),
      sub_type: blankToNull(item.sub_category),

      waist_in: blankToNull(item.waist_in),
      inside_leg_in: blankToNull(item.inside_leg_in),
      rise_in: blankToNull(item.rise_in),
      hem_width_in: blankToNull(item.hem_width_in),

      pit_to_pit_in: blankToNull(item.pit_to_pit_in),
      collar_to_hem_in: blankToNull(item.collar_to_hem_in),
      pit_to_cuff_in: blankToNull(item.pit_to_cuff_in),
      sleeve_in: blankToNull(item.sleeve_in),

      weight_grams: blankToNull(item.weight_grams),
      marketplace_tags: cleanTags(item.marketplace_tags),
      hs_code: blankToNull(item.hs_code),
      country_of_origin: blankToNull(item.country_of_origin),
      composition: blankToNull(item.composition),
      shipping_size_identifier: blankToNull(item.shipping_size_identifier),
      package_length_cm: blankToNull(item.package_length_cm),
      package_width_cm: blankToNull(item.package_width_cm),
      package_height_cm: blankToNull(item.package_height_cm),
      package_weight_grams: blankToNull(item.package_weight_grams),
      vat_rule: item.vat_rule || 'channel_default',
      vat_rate: item.vat_rule === 'custom' ? blankToNull(item.vat_rate) : null,
      stock_buffer: cleanNumber(item.stock_buffer) ?? 0,
      max_channel_exposed_stock: blankToNull(item.max_channel_exposed_stock),
      minimum_stock_alert_level: blankToNull(item.minimum_stock_alert_level),
      pick_policy: item.pick_policy || 'company_default',
      item_kind: compositionComponents.some((component) => text(component.component_sku))
        ? 'composite'
        : normaliseSkuType(item.sku_type) === 'composite'
          ? 'composite'
        : normaliseSkuType(item.sku_type) === 'parent_child'
          ? 'parent'
          : item.item_kind || 'standard',
      variation_group_key: blankToNull(item.variation_group_key),
      variation_options: item.variation_options && typeof item.variation_options === 'object'
        ? item.variation_options
        : {},
      extended_properties: item.extended_properties && typeof item.extended_properties === 'object'
        ? item.extended_properties
        : {},
      location_status: item.location_status || 'stored',
      current_location: canonicalLocationKey(item.current_location) || WAREHOUSE_LOCATION,
      current_bin: text(item.current_bin) || DEFAULT_BIN,

      last_saved_by: staff.id,
      ...(priceChanged ? { priced_by: staff.id } : {}),
      ...(shouldQueueStockSync
        ? {
            linnworks_location_sync_status: 'pending',
            linnworks_sync_error: null,
          }
        : {}),
    }

    const { error } = await supabase
      .from('items')
      .update(cleanedItem)
      .eq('id', id)
      .eq(schemaReady ? 'company_id' : 'id', schemaReady ? activeCompanyId : id)

    if (error) {
      setMessage(error.message)
      return null
    }

    let savedItem = cleanedItem

    try {
      await upsertPrimaryStockLocation(cleanedItem)
      await syncItemIdentifiers(cleanedItem)
      await saveCompositionComponents(cleanedItem)
      await saveChildSkuRows(cleanedItem)
    } catch (stockError: any) {
      setMessage(`Saved item, but linked stock/identifier/composite/child SKU row failed: ${stockError.message}`)
      originalItemRef.current = cleanedItem
      setItem(cleanedItem)
      setHasUnsavedChanges(false)
      return cleanedItem
    }

    if (shouldQueueStockSync) {
      const { error: queueError } = await supabase
        .from('linnworks_sync_queue')
        .insert({
          item_id: id,
          sku: cleanedItem.sku,
          action: 'update_stock',
          payload: {
            sku: cleanedItem.sku,
            stock_level: newStockLevel,
            location: cleanedItem.current_location || 'Default',
            bin: cleanedItem.current_bin || 'Default',
            reason: 'manual_item_edit_stock_level',
            changed_by: staff.name,
            changed_at: new Date().toISOString(),
          },
          status: 'pending',
        })

      if (queueError) {
        setMessage(`Saved item, but Linnworks queue failed: ${queueError.message}`)
        originalItemRef.current = cleanedItem
        setItem(cleanedItem)
        setHasUnsavedChanges(false)
        return cleanedItem
      }
    }

    originalItemRef.current = savedItem
    setItem(savedItem)
    setHasUnsavedChanges(false)
    fetchStockDetails()

    if (stockLevelChanged && !isLinnworksManaged) {
      setMessage(
        `Saved by ${staff.name}. Stock was saved locally. Linnworks stock sync will happen after this item is exported/synced.`
      )
    } else {
      setMessage(
        shouldQueueStockSync
          ? `Saved by ${staff.name}. Linnworks stock sync queued.`
          : `Saved by ${staff.name}`
      )
    }

    if (options.promptChannelExport && hadUnsavedChanges && previouslyExportedChannels.length > 0) {
      return offerExportUpdatesAfterFinalisedSave(savedItem, previouslyExportedChannels)
    }

    return savedItem
  }

  async function sendToReview() {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    const confirmed = window.confirm(
      'Send this SKU to review? It will move from Working into Review.'
    )

    if (!confirmed) return

    const now = new Date().toISOString()
    const savedItem = await saveItem()

    if (!savedItem) return

    let updatedItem = {
      ...savedItem,
      status: 'review',
      location_status: savedItem.location_status || 'stored',
      current_location: savedItem.current_location || WAREHOUSE_LOCATION,
      current_bin: savedItem.current_bin || DEFAULT_BIN,
      last_saved_by: staff.id,
      sent_to_review_by: staff.id,
      sent_to_review_at: now,
      review_return_reason: null,
      review_return_type: null,
      review_returned_at: null,
      review_returned_by: null,
      updated_at: now,
    }

    try {
      if (needsAiCopy(updatedItem)) {
        const generated = await requestAiCopy(updatedItem)
        updatedItem = {
          ...updatedItem,
          ai_title: updatedItem.ai_title || generated.ai_title,
          ai_description: updatedItem.ai_description || generated.ai_description,
          website_title: updatedItem.website_title || generated.website_title,
        }
      }
    } catch {
      // AI copy is useful, but review should not be blocked if generation fails.
    }

    try {
      const suggestedCategory = await bestEbayCategoryForReview(updatedItem)
      if (suggestedCategory?.id) {
        updatedItem = {
          ...updatedItem,
          ebay_category_id: suggestedCategory.id,
          ebay_category_name: suggestedCategory.name,
        }
      }
    } catch {
      // Category suggestion is helpful metadata, not a blocker for review.
    }

    const { error } = await supabase
      .from('items')
      .update(updatedItem)
      .eq('id', id)
      .eq(schemaReady ? 'company_id' : 'id', schemaReady ? activeCompanyId : id)

    if (error) {
      setMessage(error.message)
      return
    }

    setItem(updatedItem)
    originalItemRef.current = updatedItem
    setHasUnsavedChanges(false)
    setDataEntryMode(false)
    setCatalogueNextScanValue('')
    setCatalogueNextScanOpen(true)
    setMessage(`SKU ${updatedItem.sku} sent to review. Scan the next item to continue.`)
    window.setTimeout(() => catalogueNextScanInputRef.current?.focus(), 100)
  }

  async function finaliseItem() {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    if (!item) return

    const isDigitalSku = isDigitalSkuType(item.sku_type)
    const imageCount = isDigitalSku ? 0 : await getImageCount()
    const missing = missingFinaliseFields(item, imageCount)

    if (missing.length > 0) {
      window.alert(
        `Cannot finalise SKU ${item.sku}. Missing: ${missing.join(', ')}`
      )
      return
    }

    if (isDigitalSku) {
      const confirmed = window.confirm(
        `Finalise digital SKU ${item.sku}?\n\nThis will save the item and mark it as finalised.`
      )

      if (!confirmed) return

      const exportNow = window.confirm(
        `Export ${item.sku} to Linnworks now?\n\nYes = finalise and export now.\nNo = finalise locally only.`
      )

      setProcessingImages(true)
      setMessage(exportNow ? 'Saving and exporting digital SKU...' : 'Saving digital SKU...')

      try {
        const savedItem = await saveItem()

        if (!savedItem) return

        let updatedItem = {
          ...savedItem,
          status: 'finalised',
          last_saved_by: staff.id,
          updated_at: new Date().toISOString(),
        }

        const { error } = await supabase
          .from('items')
          .update(updatedItem)
          .eq('id', id)
          .eq(schemaReady ? 'company_id' : 'id', schemaReady ? activeCompanyId : id)

        if (error) {
          setMessage(error.message)
          return
        }

        if (exportNow) {
          try {
            updatedItem = await exportItemToLinnworks(updatedItem)
            setMessage(`Digital SKU ${item.sku} finalised and exported to Linnworks.`)
          } catch (error: any) {
            setMessage(
              `Digital SKU finalised locally, but Linnworks export failed: ${
                error.message || 'Unknown export error.'
              }`
            )
          }
        } else {
          setMessage(`Digital SKU ${item.sku} finalised locally. Not exported to Linnworks.`)
        }

        setItem(updatedItem)
        originalItemRef.current = updatedItem
        setHasUnsavedChanges(false)
        window.location.href = '/'
      } catch (error: any) {
        setMessage(error.message || 'Finalise failed.')
      } finally {
        setProcessingImages(false)
      }

      return
    }

    const confirmed = window.confirm(
      `Finalise SKU ${item.sku}?\n\nThis will save the item, create/overwrite processed image URLs, and move it to Review.`
    )

    if (!confirmed) return

    setProcessingImages(true)
    setMessage('Saving and processing images...')

    try {
      const savedItem = await saveItem()

      if (!savedItem) return

      await ensureProcessedImages()

      const updatedItem = {
        ...savedItem,
        status: 'finalised',
        last_saved_by: staff.id,
        updated_at: new Date().toISOString(),
      }

      const { error } = await supabase
        .from('items')
        .update(updatedItem)
        .eq('id', id)
        .eq(schemaReady ? 'company_id' : 'id', schemaReady ? activeCompanyId : id)

      if (error) {
        setMessage(error.message)
        return
      }

      setItem(updatedItem)
      originalItemRef.current = updatedItem
      setHasUnsavedChanges(false)
      window.location.href = '/review'
    } catch (error: any) {
      setMessage(error.message || 'Finalise failed.')
    } finally {
      setProcessingImages(false)
    }
  }

  function updateField(field: string, value: any) {
    const nextValue = itemDetailValue(field, value)
    const updatedItem = {
      ...item,
      [field]: nextValue,
    }

    setItem(updatedItem)

    setHasUnsavedChanges(
      JSON.stringify(originalItemRef.current) !== JSON.stringify(updatedItem)
    )
  }

  function latestSuggestionForField(field: string) {
    return measurementSuggestions.find(
      (suggestion) =>
        suggestion.measurement_type === field &&
        ['suggested', 'low_confidence'].includes(String(suggestion.status || ''))
    )
  }

  async function applyMeasurementSuggestion(
    suggestion: MeasurementSuggestion,
    action: 'accepted' | 'edited' | 'rejected',
    value?: unknown
  ) {
    const hadUnsavedChanges = hasUnsavedChanges
    setMeasurementSuggestionBusyId(suggestion.id)
    setMessage('')

    try {
      const acceptedValue =
        action === 'edited'
          ? value
          : action === 'accepted'
            ? suggestion.proposed_value_in
            : null

      const response = await fetch('/api/photography/measurement-suggestions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: suggestion.id,
          action,
          accepted_value_in: acceptedValue,
          staff_id: staff?.id || null,
        }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not update measurement suggestion.')
      }

      if (data.applied_field) {
        const updatedItem = {
          ...item,
          [data.applied_field]: data.applied_value,
        }
        setItem(updatedItem)
        if (hadUnsavedChanges) {
          setHasUnsavedChanges(
            JSON.stringify(originalItemRef.current) !== JSON.stringify(updatedItem)
          )
        } else {
          originalItemRef.current = updatedItem
          setHasUnsavedChanges(false)
        }
      }

      await fetchMeasurementSuggestions()
      setMessage(
        action === 'rejected'
          ? 'Measurement suggestion rejected.'
          : `${measurementLabels[suggestion.measurement_type] || 'Measurement'} applied.`
      )
    } catch (error: any) {
      setMessage(error.message || 'Could not update measurement suggestion.')
    } finally {
      setMeasurementSuggestionBusyId('')
    }
  }

  function updateSubCategory(value: string) {
    const nextValue = itemDetailValue('sub_category', value)
    const updatedItem = {
      ...item,
      sub_category: nextValue,
      sub_type: nextValue,
    }

    setItem(updatedItem)

    setHasUnsavedChanges(
      JSON.stringify(originalItemRef.current) !== JSON.stringify(updatedItem)
    )
  }

  function confirmNavigation(url: string) {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm(
        'You have unsaved changes. Leave without saving?'
      )

      if (!confirmed) return
    }

    window.location.href = url
  }

  if (!item) {
    return (
      <StaffPermissionGate permission="working">
        <main className="min-h-screen bg-zinc-950 p-6 text-white">
          Loading...
        </main>
      </StaffPermissionGate>
    )
  }

  const visibleMeasurements = measurementMap[item.reporting_category] || []
  const visibleConditionOptions =
    item.item_type === 'Clothing' ? clothingConditionOptions : conditionOptions
  const ebayPreviewHtml = ebayReadiness?.listing_draft?.description_html || ''
  const selectedPhotoStation =
    photoStations.find((station) => station.id === selectedPhotoStationId) || photoStations[0] || null
  const activePhotoSession = selectedPhotoStation?.active_session || null
  const photoSessionMatchesItem = activePhotoSession?.item_id === item.id
  const reviewReturnLabel =
    item.review_return_type === 'needs_reshoot'
      ? 'Needs reshoot'
      : item.review_return_type === 'needs_edit'
        ? 'Needs edit'
        : item.review_return_reason
          ? 'Returned from review'
          : ''
  const dataEntryFields = dataEntryFieldKeys
    .filter((field) => {
      if (allMeasurementFields.includes(field)) return visibleMeasurements.includes(field)
      return true
    })
    .map((field) => ({
      key: field,
      label:
        field === 'sku'
          ? 'SKU'
          : field === 'barcode_number'
            ? 'Barcode'
            : measurementLabels[field] ||
              field
                .replace(/_/g, ' ')
                .replace(/\b\w/g, (letter) => letter.toUpperCase()),
    }))
  const activeDataEntryField = dataEntryFields[dataEntryIndex] || dataEntryFields[0]
  const activeDataEntrySuggestions =
    activeDataEntryField?.key === 'brand'
      ? brandOptions
      : activeDataEntryField?.key === 'reporting_category'
        ? reportingCategories
        : activeDataEntryField?.key === 'sub_category'
          ? subCategoryOptions
          : []

  function initialDataEntryIndex() {
    if (item?.inbound_batch_id || item?.inbound_batch_code) {
      const firstMissingInboundDefault = ['reporting_category', 'sub_category', 'brand'].find(
        (field) => !text(item?.[field])
      )

      if (firstMissingInboundDefault) {
        const index = dataEntryFields.findIndex((field) => field.key === firstMissingInboundDefault)
        return index >= 0 ? index : 0
      }

      const afterBrandIndex = dataEntryFields.findIndex((field) => field.key === 'gender')
      return afterBrandIndex >= 0 ? afterBrandIndex : 0
    }

    const brandIndex = dataEntryFields.findIndex((field) => field.key === 'brand')
    return brandIndex >= 0 ? brandIndex : 0
  }

  function moveDataEntry(delta: number) {
    setDataEntryIndex((current) => {
      const next = Math.min(Math.max(current + delta, 0), dataEntryFields.length - 1)
      window.setTimeout(() => document.getElementById(`data-entry-${dataEntryFields[next]?.key}`)?.focus(), 0)
      return next
    })
  }

  function handleDataEntryKeyDown(event: any) {
    if (event.key !== 'Enter' && event.key !== 'Tab') return
    event.preventDefault()
    moveDataEntry(event.shiftKey ? -1 : 1)
  }

  function closeDataEntryMode() {
    const currentSnapshot = JSON.stringify(item)
    setDataEntryMode(false)
    if (currentSnapshot === dataEntrySnapshotRef.current) {
      setHasUnsavedChanges(dataEntryHadUnsavedRef.current)
      return
    }

    setHasUnsavedChanges(
      JSON.stringify(originalItemRef.current) !== currentSnapshot
    )
  }

  return (
    <StaffPermissionGate permission="working">
      <main className="min-h-screen bg-zinc-950 p-5 text-white">
        <div className="app-header mb-4 flex flex-col gap-2 rounded-3xl bg-black p-3 text-white shadow-2xl sm:p-4">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-black tracking-normal">SKU: {item.sku}</h1>

              <p className="text-sm text-zinc-300">
                Status: {item.status}
                {item.sku_type ? ` · ${skuTypeLabel(item.sku_type)} SKU` : ''}
                {item.linnworks_managed ? ' · Linnworks synced' : ''}
                {hasUnsavedChanges ? ' · Unsaved changes' : ''}
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

            <AppNav current={undefined} onNavigate={confirmNavigation} />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {message && (
              <span className="mr-auto rounded-lg border border-yellow-700 bg-yellow-950 px-4 py-2 text-sm font-bold text-yellow-300">
                {message}
              </span>
            )}

            <button
              type="button"
              onClick={() => startPhotoSession({ askOpenMode: true, askStationChoice: true })}
              disabled={photoSessionBusy || photoStations.length === 0}
              title={photoStations.length === 0 ? photoStationMessage || 'No photography station found.' : ''}
              className={`rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-40 ${
                photoSessionMatchesItem ? 'bg-green-700' : 'bg-emerald-600 hover:bg-emerald-500'
              }`}
            >
              {photoSessionBusy
                ? 'Starting...'
                : photoSessionMatchesItem
                  ? 'Session Active'
                  : item.review_return_type === 'needs_reshoot'
                    ? 'Start Reshoot'
                    : 'Start Photo Session'}
            </button>

            <button
              onClick={() => saveItem({ promptChannelExport: true })}
              disabled={!staff || processingImages || exportingLinnworks}
              className="rounded-xl bg-green-600 px-4 py-2 text-sm font-black text-white hover:bg-green-500 disabled:opacity-40"
            >
              Save Item
            </button>

            {!isDigitalSkuType(item.sku_type) && (
              <button
                onClick={sendToReview}
                disabled={!staff || processingImages || exportingLinnworks}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
              >
                Send to Review
              </button>
            )}

            <button
              onClick={finaliseItem}
              disabled={!staff || processingImages || exportingLinnworks}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              {processingImages ? 'Finalising...' : 'Finalise'}
            </button>
          </div>
        </div>

        {item.review_return_reason && (
          <div className="mb-5 rounded-xl border border-yellow-600 bg-yellow-950 px-4 py-3 text-sm font-bold text-yellow-100">
            <span className="font-black">{reviewReturnLabel}:</span> {item.review_return_reason}
          </div>
        )}

        {channelProgress.open && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4">
            <div className="w-full max-w-md rounded-2xl border border-neutral-700 bg-neutral-950 p-5 text-white shadow-2xl">
              <div className="flex items-start gap-3">
                <div
                  className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black ${
                    channelProgress.status === 'success'
                      ? 'bg-emerald-500 text-black'
                      : channelProgress.status === 'failed'
                        ? 'bg-red-600 text-white'
                        : 'bg-blue-600 text-white'
                  }`}
                >
                  {channelProgress.status === 'success' ? '✓' : channelProgress.status === 'failed' ? '!' : '...'}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-black text-white">{channelProgress.title}</h2>
                  <p className="mt-1 text-sm font-bold text-neutral-300">{channelProgress.message}</p>
                  {channelProgress.details && channelProgress.details.length > 0 && (
                    <div className="mt-3 max-h-40 overflow-auto rounded-xl border border-neutral-800 bg-black p-3 text-xs font-bold leading-5 text-red-200">
                      {channelProgress.details.map((detail, index) => (
                        <p key={`${detail}-${index}`}>{detail}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {channelProgress.status === 'failed' && (
                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setChannelProgress((current) => ({ ...current, open: false }))}
                    className="rounded-lg bg-white px-4 py-2 text-sm font-black text-black hover:bg-neutral-200"
                  >
                    Acknowledge
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {catalogueNextScanOpen && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4">
            <section className="w-full max-w-xl rounded-2xl border border-emerald-700 bg-zinc-950 p-5 shadow-2xl">
              <div className="mb-4">
                <p className="text-xs font-black uppercase tracking-wide text-emerald-300">
                  Catalogue Session
                </p>
                <h2 className="text-2xl font-black text-white">Scan next item</h2>
                <p className="mt-1 text-sm font-bold text-zinc-400">
                  This item has been saved and sent to review. Scan the next SKU, barcode, or RFID to continue.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  ref={catalogueNextScanInputRef}
                  value={catalogueNextScanValue}
                  onChange={(event) => setCatalogueNextScanValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleCatalogueNextScan()
                  }}
                  disabled={catalogueNextScanBusy}
                  autoFocus
                  className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-white px-4 py-3 text-lg font-black text-zinc-950 outline-none focus:border-emerald-400 disabled:opacity-50"
                  placeholder="Scan next item"
                />

                <button
                  type="button"
                  onClick={handleCatalogueNextScan}
                  disabled={catalogueNextScanBusy || !catalogueNextScanValue.trim()}
                  className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-40"
                >
                  {catalogueNextScanBusy ? 'Opening...' : 'Open'}
                </button>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setCatalogueNextScanOpen(false)
                    window.location.href = '/'
                  }}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-black text-white hover:border-white"
                >
                  Quit
                </button>
              </div>
            </section>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {[
              { key: 'catalogue', label: 'Catalogue' },
              { key: 'internal', label: 'Internal / Logistics' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key as any)}
                className={`rounded-lg px-4 py-2 text-sm font-black ${
                  activeTab === tab.key
                    ? 'bg-emerald-600 text-white'
                    : 'bg-zinc-800 text-white hover:bg-zinc-700'
                }`}
              >
                {tab.label}
              </button>
            ))}

            <button
              type="button"
              onClick={() => {
                const nextIndex = initialDataEntryIndex()
                const nextField = dataEntryFields[nextIndex]
                dataEntrySnapshotRef.current = JSON.stringify(item)
                dataEntryHadUnsavedRef.current = hasUnsavedChanges
                setDataEntryIndex(nextIndex)
                setDataEntryMode(true)
                window.setTimeout(
                  () => document.getElementById(`data-entry-${nextField?.key || 'brand'}`)?.focus(),
                  0
                )
              }}
              className={`rounded-lg px-4 py-2 text-sm font-black text-white ${
                dataEntryMode ? 'bg-emerald-600' : 'bg-zinc-800 hover:bg-zinc-700'
              }`}
            >
              Data Entry
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowEbayHtmlPreview(true)}
            disabled={!ebayPreviewHtml}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            HTML Preview
          </button>
        </div>

        {dataEntryMode && activeDataEntryField && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <section className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-emerald-700 bg-zinc-950 shadow-2xl">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800 bg-emerald-950 p-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-emerald-300">
                    Data Entry Mode
                  </p>
                  <h2 className="text-2xl font-black text-white">
                    {activeDataEntryField.label}
                  </h2>
                  <p className="mt-1 text-xs font-bold text-emerald-100">
                    {dataEntryIndex + 1} / {dataEntryFields.length} · Enter or Tab moves next. Shift+Tab moves back.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => moveDataEntry(-1)}
                    className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-black text-white disabled:opacity-40"
                    disabled={dataEntryIndex === 0}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => moveDataEntry(1)}
                    className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-black text-white disabled:opacity-40"
                    disabled={dataEntryIndex >= dataEntryFields.length - 1}
                  >
                    Next
                  </button>
                  <button
                    type="button"
                    onClick={closeDataEntryMode}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-500"
                  >
                    Submit
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto p-4">
                <div className="rounded-xl border border-emerald-700 bg-black p-4">
                  <label
                    htmlFor={`data-entry-${activeDataEntryField.key}`}
                    className="mb-2 block text-xs font-black uppercase tracking-wide text-emerald-300"
                  >
                    Current Field
                  </label>
                  <input
                    id={`data-entry-${activeDataEntryField.key}`}
                    list={activeDataEntrySuggestions.length > 0 ? 'data-entry-field-suggestions' : undefined}
                    value={item[activeDataEntryField.key] || ''}
                    onChange={(event) => {
                      if (activeDataEntryField.key === 'reporting_category') {
                        updateReportingCategory(event.target.value)
                      } else if (activeDataEntryField.key === 'sub_category') {
                        updateSubCategory(event.target.value)
                      } else {
                        updateField(activeDataEntryField.key, event.target.value)
                      }
                    }}
                    onKeyDown={handleDataEntryKeyDown}
                    autoFocus
                    className="h-20 w-full rounded-xl border-2 border-emerald-400 bg-white px-4 text-3xl font-black text-zinc-950 outline-none focus:border-white"
                  />

                  {activeDataEntrySuggestions.length > 0 && (
                    <datalist id="data-entry-field-suggestions">
                      {activeDataEntrySuggestions.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  )}
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                  {dataEntryFields.map((field, index) => {
                    const active = index === dataEntryIndex

                    return (
                      <button
                        key={field.key}
                        type="button"
                        onClick={() => {
                          setDataEntryIndex(index)
                          window.setTimeout(
                            () => document.getElementById(`data-entry-${field.key}`)?.focus(),
                            0
                          )
                        }}
                        className={`min-h-20 rounded-xl border p-3 text-left ${
                          active
                            ? 'border-emerald-300 bg-emerald-600'
                            : 'border-zinc-800 bg-zinc-900 hover:border-zinc-600'
                        }`}
                      >
                        <span className={`block text-[11px] font-black uppercase tracking-wide ${
                          active ? 'text-white' : 'text-zinc-400'
                        }`}>
                          {field.label}
                        </span>
                        <span className={`mt-2 block truncate text-sm font-black ${
                          active ? 'text-white' : 'text-zinc-100'
                        }`}>
                          {text(item[field.key]) || '-'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'catalogue' ? (
        <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">
                Item Details
              </h2>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <SelectField
                  label="Item Type"
                  value={item.item_type}
                  onChange={(v: string) => updateField('item_type', v)}
                  options={itemTypeOptions}
                />

                <DatalistField
                  label="Reporting Category"
                  value={item.reporting_category}
                  onChange={(v: string) => updateReportingCategory(v)}
                  options={reportingCategories}
                  listId="reporting-categories"
                  placeholder="Type or select category"
                />

                <DatalistField
                  label="Sub Category"
                  value={item.sub_category || ''}
                  onChange={(v: string) => updateSubCategory(v)}
                  options={subCategoryOptions}
                  listId="sub-categories"
                  placeholder="Type or select sub category"
                />

                <DatalistField
                  label="Brand"
                  value={item.brand || ''}
                  onChange={(v: string) => updateField('brand', v)}
                  options={brandOptions}
                  listId="brand-options"
                  placeholder="Type or select brand"
                />

                <SelectField
                  label="Gender"
                  value={item.gender}
                  onChange={(v: string) => updateField('gender', v)}
                  options={genderOptions}
                />

                <Field
                  label="Tagged Size"
                  value={item.tagged_size}
                  onChange={(v: string) => updateField('tagged_size', v)}
                />

                <Field
                  label="Primary Colour"
                  value={item.colour_primary}
                  onChange={(v: string) => updateField('colour_primary', v)}
                />

                <Field
                  label="Secondary Colour"
                  value={item.colour_secondary}
                  onChange={(v: string) => updateField('colour_secondary', v)}
                />

                <SelectField
                  label="Condition"
                  value={item.condition}
                  onChange={(v: string) => updateField('condition', v)}
                  options={visibleConditionOptions}
                />

                <DatalistField
                  label="Material"
                  value={item.material}
                  onChange={(v: string) => updateField('material', v)}
                  options={materialOptions}
                  listId="material-options"
                  placeholder="Type or select material"
                />

                <Field
                  label="Era"
                  value={item.era}
                  onChange={(v: string) => updateField('era', v)}
                />

                <Field
                  label="Style"
                  value={item.style}
                  onChange={(v: string) => updateField('style', v)}
                />

                <Field
                  label="Staff Notes"
                  value={item.staff_notes}
                  onChange={(v: string) => updateField('staff_notes', v)}
                />
              </div>
            </section>

            {item.status === 'review' && (
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-300">
                    eBay Category
                  </h2>
                  <p className="mt-1 text-xs font-bold text-zinc-500">
                    Suggested from item type, gender, category, and sub category. Override before listing if needed.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={suggestEbayCategory}
                  disabled={searchingEbayCategories}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-black text-white hover:bg-zinc-800 disabled:opacity-40"
                >
                  {searchingEbayCategories ? 'Searching' : 'Suggest'}
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_160px]">
                <Field
                  label="Current eBay Category"
                  value={
                    item.ebay_category_id
                      ? `${item.ebay_category_name || 'eBay category'} (${item.ebay_category_id})`
                      : ''
                  }
                  onChange={() => {}}
                />

                <button
                  type="button"
                  onClick={clearEbayCategory}
                  className="mt-5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-black text-white hover:bg-zinc-800"
                >
                  Clear Category
                </button>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-[1fr_140px]">
                <input
                  value={ebayCategorySearch || ebayCategoryQuery()}
                  onChange={(event) => setEbayCategorySearch(event.target.value)}
                  placeholder="Search eBay categories"
                  className="h-10 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm font-bold text-white outline-none focus:border-white"
                />

                <button
                  type="button"
                  onClick={() => searchEbayCategories()}
                  disabled={searchingEbayCategories}
                  className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-black text-white hover:bg-zinc-700 disabled:opacity-40"
                >
                  Search
                </button>
              </div>

              {ebayCategorySuggestions.length > 0 && (
                <div className="mt-3 max-h-64 overflow-auto rounded-xl border border-zinc-800 bg-zinc-950 p-2">
                  {ebayCategorySuggestions.map((suggestion, index) => {
                    const category = ebayCategoryFromSuggestion(suggestion)
                    const path = ebayCategoryPath(suggestion)

                    return (
                      <button
                        key={`${category.id}-${index}`}
                        type="button"
                        onClick={() => applyEbayCategorySuggestion(suggestion)}
                        className="block w-full rounded-lg px-3 py-2 text-left hover:bg-zinc-800"
                      >
                        <span className="block text-sm font-black text-white">
                          {category.name || 'Unnamed category'} ({category.id})
                        </span>
                        {path && (
                          <span className="mt-1 block text-xs font-bold text-zinc-500">
                            {path}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </section>
            )}

            {visibleMeasurements.length > 0 && (
              <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">
                  Measurements - Inches
                </h2>

                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  {visibleMeasurements.map((field) => {
                    const suggestion = latestSuggestionForField(field)
                    const busySuggestion = suggestion?.id === measurementSuggestionBusyId
                    const confidence =
                      suggestion?.confidence === null || suggestion?.confidence === undefined
                        ? null
                        : Math.round(Number(suggestion.confidence) * 100)

                    return (
                      <div key={field} className="space-y-2">
                        <Field
                          label={measurementLabels[field]}
                          value={item[field]}
                          onChange={(v: string) => updateField(field, v)}
                        />

                        {suggestion && (
                          <div className="rounded-lg border border-emerald-900 bg-emerald-950/50 p-2">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-[10px] font-black uppercase tracking-wide text-emerald-300">
                                  Photo suggestion
                                </p>
                                <p className="mt-0.5 text-sm font-black text-white">
                                  {suggestion.proposed_value_in || suggestion.raw_value_in || '-'}"
                                </p>
                              </div>
                              {confidence !== null && Number.isFinite(confidence) && (
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-black ${
                                    confidence >= 80
                                      ? 'bg-green-600 text-white'
                                      : confidence >= 55
                                        ? 'bg-yellow-600 text-black'
                                        : 'bg-red-700 text-white'
                                  }`}
                                >
                                  {confidence}%
                                </span>
                              )}
                            </div>

                            <div className="mt-2 grid grid-cols-3 gap-1">
                              <button
                                type="button"
                                onClick={() => applyMeasurementSuggestion(suggestion, 'accepted')}
                                disabled={busySuggestion}
                                className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-black text-white disabled:opacity-50"
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                onClick={() => applyMeasurementSuggestion(suggestion, 'edited', item[field])}
                                disabled={busySuggestion || !String(item[field] || '').trim()}
                                className="rounded bg-zinc-700 px-2 py-1 text-[10px] font-black text-white disabled:opacity-50"
                                title="Save the currently typed value against this suggestion."
                              >
                                Use Field
                              </button>
                              <button
                                type="button"
                                onClick={() => applyMeasurementSuggestion(suggestion, 'rejected')}
                                disabled={busySuggestion}
                                className="rounded bg-red-700 px-2 py-1 text-[10px] font-black text-white disabled:opacity-50"
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}

                  <Field
                    label="Weight (g)"
                    value={item.weight_grams}
                    onChange={(v: string) => updateField('weight_grams', v)}
                  />
                </div>
              </section>
            )}

            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-300">
                  Descriptions / AI Copy
                </h2>

                <button
                  type="button"
                  onClick={generateAiCopy}
                  disabled={generatingAi}
                  className="rounded-lg bg-purple-600 px-4 py-2 text-xs font-bold"
                >
                  {generatingAi ? 'Generating...' : 'Generate AI Copy'}
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="space-y-3">
                    <Field
                      label="Basic Title"
                      value={item.basic_title}
                      onChange={(v: string) => updateField('basic_title', v)}
                    />

                    <Field
                      label="Flaws"
                      value={item.flaws}
                      onChange={(v: string) => updateField('flaws', v)}
                    />
                  </div>

                  <TextArea
                    label="Basic Description"
                    value={item.basic_description}
                    onChange={(v: string) => updateField('basic_description', v)}
                  />
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="space-y-3">
                    <Field
                      label="AI Marketplace Title"
                      value={item.ai_title}
                      onChange={(v: string) => updateField('ai_title', v)}
                    />

                    <Field
                      label="Website Title"
                      value={item.website_title}
                      onChange={(v: string) => updateField('website_title', v)}
                    />
                  </div>

                  <TextArea
                    label="AI Description"
                    value={item.ai_description}
                    onChange={(v: string) => updateField('ai_description', v)}
                  />
                </div>

                <TextArea
                  label="AI Marketplace Tags"
                  value={tagsText(item.marketplace_tags)}
                  onChange={(v: string) => updateField('marketplace_tags', cleanTags(v))}
                />
              </div>
            </section>
          </div>

          <aside className="space-y-4">
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">
                Photos
              </h2>

              <PhotoPreview itemId={id} refreshKey={photoRefreshKey} />

              <button
                type="button"
                onClick={() => confirmNavigation(`/items/${id}/photos`)}
                className="mt-3 block w-full rounded-lg bg-blue-600 px-4 py-2 text-center text-sm font-bold"
              >
                Upload / Edit Photos
              </button>
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">
                Pricing / Status
              </h2>

              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Cost Price (£)"
                  value={item.cost_price}
                  onChange={(v: string) => updateField('cost_price', v)}
                />

                <Field
                  label="Selling Price (£)"
                  value={item.selling_price}
                  onChange={(v: string) => updateField('selling_price', v)}
                />

                <Field
                  label="Stock Level"
                  value={item.stock_level}
                  onChange={(v: string) => updateField('stock_level', v)}
                />

                <Field
                  label="Status"
                  value={item.status}
                  onChange={(v: string) => updateField('status', v)}
                />
              </div>
            </section>

          </aside>
        </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
            <div className="space-y-4">
              <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">
                  SKU / Identifiers
                </h2>

                <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_1fr]">
                  <Field
                    label="SKU"
                    value={item.sku}
                    onChange={(v: string) => updateField('sku', v)}
                  />

                  <div>
                    <Field
                      label="Barcode"
                      value={item.barcode_number}
                      onChange={(v: string) => updateField('barcode_number', v)}
                      placeholder="Scan or type barcode"
                    />
                    <button
                      type="button"
                      onClick={generateBarcodeNumber}
                      className="mt-2 rounded-lg bg-zinc-800 px-3 py-2 text-xs font-black text-white hover:bg-zinc-700"
                    >
                      Generate Barcode
                    </button>
                  </div>

                  <Field
                    label="Variation Group"
                    value={item.variation_group_key}
                    onChange={(v: string) => updateField('variation_group_key', v)}
                    placeholder="e.g. CARHARTT-JACKET"
                  />
                </div>

                <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs font-bold text-zinc-400">
                  SKU and barcode are unique identifiers for this company. Changing SKU after external export can be risky where a channel does not support SKU rename.
                </p>
              </section>

              <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-300">
                      Stock Controls
                    </h2>
                    <p className="mt-1 text-xs font-bold text-zinc-500">
                      Availability, channel exposure and bin-level stock for this SKU.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={fetchStockDetails}
                    className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-black text-white hover:bg-zinc-800"
                  >
                    Refresh Stock
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  {[
                    ['Level', stockDetails?.physical_stock ?? item.stock_level ?? 0],
                    ['Available', stockDetails?.available_stock ?? item.stock_level ?? 0],
                    ['Open Orders', stockDetails?.open_order_stock ?? 0],
                    ['Channel Exposed', stockDetails?.channel_exposed_stock ?? item.stock_level ?? 0],
                    ['Inbound', stockDetails?.inbound_stock ?? 0],
                    ['Quarantine', stockDetails?.quarantine_stock ?? 0],
                    ['Buffer', stockDetails?.stock_buffer ?? item.stock_buffer ?? 0],
                    ['Negative Bins', stockDetails?.negative_locations?.length ?? 0],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                      <p className="text-[11px] font-black uppercase text-zinc-500">{label}</p>
                      <p className="mt-1 text-lg font-black text-white">{formatStockQuantity(value)}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <Field
                    label="Buffer Level"
                    value={item.stock_buffer}
                    onChange={(v: string) => updateField('stock_buffer', v)}
                    placeholder="0"
                  />

                  <Field
                    label="Maximum Exposed"
                    value={item.max_channel_exposed_stock}
                    onChange={(v: string) => updateField('max_channel_exposed_stock', v)}
                    placeholder="Blank = no cap"
                  />

                  <Field
                    label="Minimum Alert Level"
                    value={item.minimum_stock_alert_level}
                    onChange={(v: string) => updateField('minimum_stock_alert_level', v)}
                    placeholder="Optional"
                  />

                  <SelectField
                    label="Pick Policy"
                    value={item.pick_policy || 'company_default'}
                    onChange={(v: string) => updateField('pick_policy', v)}
                    options={[
                      { value: 'company_default', label: 'Company Default' },
                      { value: 'require_bin_scan', label: 'Require Bin Scan' },
                      { value: 'scan_if_multiple_bins', label: 'Scan If Multiple Bins' },
                      { value: 'no_scan', label: 'No Scan Required' },
                    ]}
                  />
                </div>

                {stockDetailsMessage && (
                  <p className="mt-3 rounded-lg border border-yellow-800 bg-yellow-950 p-3 text-xs font-bold text-yellow-200">
                    {stockDetailsMessage}
                  </p>
                )}

                <div className="mt-4 overflow-hidden rounded-lg border border-zinc-800">
                  <div className="grid grid-cols-[1.2fr_1fr_80px_90px] gap-2 bg-zinc-950 px-3 py-2 text-[11px] font-black uppercase text-zinc-500">
                    <span>Location</span>
                    <span>Bin</span>
                    <span className="text-right">Qty</span>
                    <span className="text-right">Type</span>
                  </div>

                  {(stockDetails?.location_rows || []).length === 0 ? (
                    <p className="px-3 py-4 text-sm font-bold text-zinc-500">
                      No stock-location rows found yet.
                    </p>
                  ) : (
                    <div className="divide-y divide-zinc-800">
                      {(stockDetails?.location_rows || [])
                        .slice()
                        .sort((a, b) => {
                          const locationCompare = displayLocationName(a.location_name).localeCompare(
                            displayLocationName(b.location_name),
                            undefined,
                            { numeric: true, sensitivity: 'base' }
                          )
                          if (locationCompare !== 0) return locationCompare
                          return text(a.bin_code).localeCompare(text(b.bin_code), undefined, {
                            numeric: true,
                            sensitivity: 'base',
                          })
                        })
                        .map((row, index) => (
                          <div
                            key={row.id || `${row.location_name}-${row.bin_code}-${index}`}
                            className="grid grid-cols-[1.2fr_1fr_80px_90px] gap-2 px-3 py-2 text-sm font-bold"
                          >
                            <span>{displayLocationName(row.location_name)}</span>
                            <span className="text-zinc-300">{row.bin_code || 'Default'}</span>
                            <span className={`text-right ${Number(row.stock_level || 0) < 0 ? 'text-red-300' : 'text-white'}`}>
                              {formatStockQuantity(row.stock_level)}
                            </span>
                            <span className="text-right text-xs uppercase text-zinc-500">
                              {row.is_quarantine ? 'Quarantine' : 'Stock'}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">
                  Customs / Shipping
                </h2>

                <div className="grid gap-3 md:grid-cols-4">
                  <Field
                    label="HS Code"
                    value={item.hs_code}
                    onChange={(v: string) => updateField('hs_code', v)}
                  />

                  <DatalistField
                    label="Country of Origin"
                    value={item.country_of_origin || ''}
                    onChange={(v: string) => updateField('country_of_origin', v)}
                    options={countryOptions}
                    listId="country-origin-options"
                    placeholder="Select or type country"
                  />

                  <Field
                    label="Shipping Size ID"
                    value={item.shipping_size_identifier}
                    onChange={(v: string) => updateField('shipping_size_identifier', v)}
                    placeholder="Small parcel, RM Large Letter..."
                  />

                  <Field
                    label="Package Weight (g)"
                    value={item.package_weight_grams}
                    onChange={(v: string) => updateField('package_weight_grams', v)}
                  />

                  <Field
                    label="Length (cm)"
                    value={item.package_length_cm}
                    onChange={(v: string) => updateField('package_length_cm', v)}
                  />

                  <Field
                    label="Width (cm)"
                    value={item.package_width_cm}
                    onChange={(v: string) => updateField('package_width_cm', v)}
                  />

                  <Field
                    label="Height (cm)"
                    value={item.package_height_cm}
                    onChange={(v: string) => updateField('package_height_cm', v)}
                  />

                  <SelectField
                    label="VAT Rule"
                    value={item.vat_rule || 'channel_default'}
                    onChange={(v: string) => updateField('vat_rule', v)}
                    options={vatRuleOptions}
                  />

                  {item.vat_rule === 'custom' && (
                    <Field
                      label="VAT Rate (%)"
                      value={item.vat_rate}
                      onChange={(v: string) => updateField('vat_rate', v)}
                    />
                  )}
                </div>
              </section>

              <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-300">
                      Child SKUs / Variations
                    </h2>
                    <p className="mt-1 text-xs font-bold text-zinc-500">
                      Link existing child SKUs and define their variation values.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setChildSkuRows((current) => [
                        ...current,
                        { sku: '', size: '', colour: '', custom_name: '', custom_value: '' },
                      ])
                    }
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-500"
                  >
                    Add Child SKU
                  </button>
                </div>

                <div className="space-y-2">
                  {childSkuRows.length === 0 && (
                    <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs font-bold text-zinc-500">
                      No child SKUs linked yet.
                    </p>
                  )}

                  {childSkuRows.map((child, index) => (
                    <div
                      key={child.id || index}
                      className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3 md:grid-cols-[1fr_120px_120px_140px_140px_auto]"
                    >
                      <Field
                        label="Child SKU"
                        value={child.sku}
                        onChange={(value: string) =>
                          setChildSkuRows((current) =>
                            current.map((row, rowIndex) =>
                              rowIndex === index ? { ...row, sku: value } : row
                            )
                          )
                        }
                      />

                      <Field
                        label="Size"
                        value={child.size || ''}
                        onChange={(value: string) =>
                          setChildSkuRows((current) =>
                            current.map((row, rowIndex) =>
                              rowIndex === index ? { ...row, size: value } : row
                            )
                          )
                        }
                      />

                      <Field
                        label="Colour"
                        value={child.colour || ''}
                        onChange={(value: string) =>
                          setChildSkuRows((current) =>
                            current.map((row, rowIndex) =>
                              rowIndex === index ? { ...row, colour: value } : row
                            )
                          )
                        }
                      />

                      <Field
                        label="Custom Name"
                        value={child.custom_name || ''}
                        onChange={(value: string) =>
                          setChildSkuRows((current) =>
                            current.map((row, rowIndex) =>
                              rowIndex === index ? { ...row, custom_name: value } : row
                            )
                          )
                        }
                      />

                      <Field
                        label="Custom Entry"
                        value={child.custom_value || ''}
                        onChange={(value: string) =>
                          setChildSkuRows((current) =>
                            current.map((row, rowIndex) =>
                              rowIndex === index ? { ...row, custom_value: value } : row
                            )
                          )
                        }
                      />

                      <button
                        type="button"
                        onClick={() =>
                          setChildSkuRows((current) =>
                            current.filter((_, rowIndex) => rowIndex !== index)
                          )
                        }
                        className="mt-5 h-9 rounded-lg bg-red-600 px-3 text-xs font-black text-white hover:bg-red-500"
                      >
                        Remove
                      </button>

                      {child.id && (
                        <Link
                          href={`/items/${child.id}`}
                          className="md:col-span-6 rounded-lg border border-zinc-700 px-3 py-2 text-center text-xs font-black text-white hover:bg-zinc-800"
                        >
                          Open child SKU
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-300">
                      Composite Components
                    </h2>
                    <p className="mt-1 text-xs font-bold text-zinc-500">
                      Add component SKUs and quantities. Saving with components makes this a composite SKU.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setCompositionComponents((current) => [
                        ...current,
                        { component_sku: '', quantity: '1', notes: '' },
                      ])
                    }
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-500"
                  >
                    Add Component
                  </button>
                </div>

                {componentMessage && (
                  <p className="mb-3 rounded-lg border border-yellow-800 bg-yellow-950 p-3 text-xs font-bold text-yellow-200">
                    {componentMessage}
                  </p>
                )}

                <div className="space-y-2">
                  {compositionComponents.length === 0 && (
                    <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs font-bold text-zinc-500">
                      No component SKUs yet.
                    </p>
                  )}

                  {compositionComponents.map((component, index) => (
                    <div
                      key={component.id || index}
                      className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3 md:grid-cols-[1fr_120px_1fr_auto]"
                    >
                      <Field
                        label="Component SKU"
                        value={component.component_sku}
                        onChange={(value: string) =>
                          setCompositionComponents((current) =>
                            current.map((row, rowIndex) =>
                              rowIndex === index ? { ...row, component_sku: value, component_item_id: '' } : row
                            )
                          )
                        }
                      />

                      <Field
                        label="Quantity"
                        value={component.quantity}
                        onChange={(value: string) =>
                          setCompositionComponents((current) =>
                            current.map((row, rowIndex) =>
                              rowIndex === index ? { ...row, quantity: value } : row
                            )
                          )
                        }
                      />

                      <Field
                        label="Notes"
                        value={component.notes || ''}
                        onChange={(value: string) =>
                          setCompositionComponents((current) =>
                            current.map((row, rowIndex) =>
                              rowIndex === index ? { ...row, notes: value } : row
                            )
                          )
                        }
                      />

                      <button
                        type="button"
                        onClick={() =>
                          setCompositionComponents((current) =>
                            current.filter((_, rowIndex) => rowIndex !== index)
                          )
                        }
                        className="mt-5 h-9 rounded-lg bg-red-600 px-3 text-xs font-black text-white hover:bg-red-500"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">
                  Composition Notes / Extended Properties
                </h2>

                <div className="grid gap-3 lg:grid-cols-2">
                  <TextArea
                    label="Composition"
                    value={item.composition}
                    onChange={(v: string) => updateField('composition', v)}
                  />

                  <TextArea
                    label="Extended Properties"
                    value={JSON.stringify(item.extended_properties || {}, null, 2)}
                    onChange={(v: string) => {
                      try {
                        updateField('extended_properties', v.trim() ? JSON.parse(v) : {})
                      } catch {
                        updateField('extended_properties', { raw: v })
                      }
                    }}
                  />
                </div>
              </section>
            </div>

            <aside className="space-y-4">
              <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">
                  Quick Save
                </h2>
                <button
                  onClick={() => saveItem({ promptChannelExport: true })}
                  disabled={!staff || processingImages || exportingLinnworks}
                  className="w-full rounded-xl bg-green-600 px-5 py-3 text-sm font-black text-white hover:bg-green-500 disabled:opacity-40"
                >
                  Save Item
                </button>
              </section>
            </aside>
          </div>
        )}

        {showEbayHtmlPreview && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl">
              <div className="flex items-center justify-between border-b border-zinc-800 p-4">
                <div>
                  <h2 className="text-lg font-black text-white">eBay HTML Preview</h2>
                  <p className="text-sm font-bold text-zinc-400">{item.sku}</p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowEbayHtmlPreview(false)}
                  className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-black text-white hover:bg-zinc-700"
                >
                  Close
                </button>
              </div>

              <div className="max-h-[calc(90vh-80px)] overflow-auto bg-white p-5">
                <div dangerouslySetInnerHTML={{ __html: ebayPreviewHtml }} />
              </div>
            </div>
          </div>
        )}
      </main>
    </StaffPermissionGate>
  )
}



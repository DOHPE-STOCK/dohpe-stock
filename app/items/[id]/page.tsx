'use client'

import { useEffect, useRef, useState } from 'react'
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
    liveStatuses: ['synced', 'active'],
    isLive: (item: any) => item?.linnworks_managed === true || String(item?.linnworks_status || '').toLowerCase() === 'synced',
  },
  {
    key: 'ebay',
    label: 'eBay',
    statusField: 'ebay_status',
    updateHandler: 'ebay',
    liveStatuses: ['listed', 'active'],
  },
  { key: 'shopify', label: 'Shopify', statusField: 'shopify_status', updateHandler: null, liveStatuses: ['listed', 'synced', 'active'] },
  { key: 'square', label: 'Square', statusField: 'square_status', updateHandler: null, liveStatuses: ['listed', 'synced', 'active'] },
  { key: 'grailed', label: 'Grailed', statusField: 'grailed_status', updateHandler: null, liveStatuses: ['listed', 'synced', 'active'] },
  { key: 'vestiaire_collective', label: 'Vestiaire Collective', statusField: 'vestiaire_collective_status', updateHandler: null, liveStatuses: ['listed', 'synced', 'active'] },
  { key: 'whatnot', label: 'Whatnot', statusField: 'whatnot_status', updateHandler: null, liveStatuses: ['listed', 'synced', 'active'] },
  { key: 'vinted', label: 'Vinted', statusField: 'vinted_status', updateHandler: null, liveStatuses: ['listed', 'synced', 'active'] },
  { key: 'depop', label: 'Depop', statusField: 'depop_status', updateHandler: null, liveStatuses: ['listed', 'synced', 'active'] },
  { key: 'tiktok_shop', label: 'TikTok Shop', statusField: 'tiktok_shop_status', updateHandler: null, liveStatuses: ['listed', 'synced', 'active'] },
] as const

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

function Field({ label, value, onChange }: any) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-400">{label}</span>

      <input
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
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

        {options.map((option: string) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
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
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-auto rounded-lg border border-zinc-700 bg-zinc-950 p-1 shadow-xl">
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
                className={`block w-full rounded-md px-3 py-2 text-left text-sm font-bold ${
                  selected ? 'bg-emerald-600 text-white' : 'text-zinc-100 hover:bg-zinc-800'
                }`}
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
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [photoRefreshKey, setPhotoRefreshKey] = useState(0)
  const [ebayReadiness, setEbayReadiness] = useState<any>(null)
  const [checkingEbayReadiness, setCheckingEbayReadiness] = useState(false)
  const [showEbayReadinessDetails, setShowEbayReadinessDetails] = useState(false)
  const [showEbayHtmlPreview, setShowEbayHtmlPreview] = useState(false)
  const [ebayCategorySearch, setEbayCategorySearch] = useState('')
  const [ebayCategorySuggestions, setEbayCategorySuggestions] = useState<any[]>([])
  const [searchingEbayCategories, setSearchingEbayCategories] = useState(false)
  const [subCategoryOptions, setSubCategoryOptions] = useState<string[]>([])

  const originalItemRef = useRef<any>(null)

  useEffect(() => {
    fetchItem()
  }, [id, activeCompanyId, schemaReady])

  useEffect(() => {
    fetchSubCategoryOptions(item?.reporting_category)
  }, [item?.reporting_category])

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

    setItem(data)
    originalItemRef.current = data
    setHasUnsavedChanges(false)
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

    setSubCategoryOptions(
      Array.from(new Set((data || []).map((row: any) => text(row.sub_category)).filter(Boolean))).sort()
    )
  }

  async function checkEbayReadiness(skuOverride?: string) {
    const sku = text(skuOverride || item?.sku)
    if (!sku) return

    setCheckingEbayReadiness(true)

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
    } finally {
      setCheckingEbayReadiness(false)
    }
  }

  function ebayReadinessMessages() {
    if (!ebayReadiness) return ['eBay readiness has not been checked yet.']
    if (!ebayReadiness.ok) return [ebayReadiness.message || 'Could not check eBay readiness.']

    const missing = Array.isArray(ebayReadiness.missing) ? ebayReadiness.missing : []
    if (missing.length === 0) return ['eBay listing requirements passed.']

    return missing.map((check: any) => `${check.label}: ${check.message}`)
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

    const allowedMeasurements = measurementMap[newCategory] || []
    const measurementsToClear = allMeasurementFields.filter(
      (field) => !allowedMeasurements.includes(field) && hasValue(item[field])
    )

    if (measurementsToClear.length > 0) {
      const labels = measurementsToClear.map(
        (field) => measurementLabels[field] || field
      )

      const confirmed = window.confirm(
        `Changing category to ${newCategory || 'blank'} will remove these measurement value(s):\n\n${labels.join(
          ', '
        )}\n\nContinue?`
      )

      if (!confirmed) return
    }

    const updatedItem: any = {
      ...item,
      reporting_category: newCategory,
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
      const sourceUrl = image.original_url || image.processed_url

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

      const { error: updateError } = await supabase
        .from('item_images')
        .update({
          processed_url: processedUrl,
        })
        .eq('id', image.id)

      if (updateError) {
        throw new Error(updateError.message)
      }
    }

    setPhotoRefreshKey((current) => current + 1)
  }

  function missingFinaliseFields(itemToCheck: any, imageCount: number) {
    const isReusableSku = itemToCheck?.sku_type === 'reusable'

    const required = isReusableSku
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

    if (!isReusableSku && imageCount < 1) {
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
    }
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

  async function exportItemToLinnworks(itemToExport: any) {
    setExportingLinnworks(true)
    setMessage(`Exporting ${itemToExport.sku} to Linnworks...`)

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
    }).map((channel) => ({
      key: channel.key,
      label: channel.label,
      supported: Boolean(channel.updateHandler),
      updateHandler: channel.updateHandler,
    }))
  }

  async function exportItemToEbay(itemToExport: any) {
    setMessage(`Updating ${itemToExport.sku} on eBay...`)

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
      updated_at: new Date().toISOString(),
    }

    setEbayReadiness(readiness)
    return exportedItem
  }

  async function offerExportUpdatesAfterFinalisedSave(savedItem: any, previouslyExportedChannels: ReturnType<typeof exportedChannelsForItem>) {
    const supportedChannels = previouslyExportedChannels.filter((channel) => channel.supported)

    if (supportedChannels.length === 0) return savedItem

    const supportedText = supportedChannels.map((channel) => channel.label).join(', ')
    const promptLines = [
      `Saved ${savedItem.sku}.`,
      '',
      `Export updated details to: ${supportedText}?`,
    ]

    if (!window.confirm(promptLines.join('\n'))) {
      return savedItem
    }

    let nextItem = savedItem
    const results: string[] = []

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
        if (channel.updateHandler === 'ebay') {
          await supabase
            .from('items')
            .update({
              ebay_status: 'failed',
              updated_at: new Date().toISOString(),
            })
            .eq('id', id)
            .eq(schemaReady ? 'company_id' : 'id', schemaReady ? activeCompanyId : id)
        }

        results.push(`${channel.label}: failed - ${error.message || 'Unknown error'}`)
      }
    }

    setItem(nextItem)
    originalItemRef.current = nextItem
    setHasUnsavedChanges(false)
    window.alert(`Channel update export finished:\n\n${results.join('\n')}`)
    setMessage(`Channel update export finished. ${results.join(' - ')}`)

    return nextItem
  }

  async function saveItem(options: { promptChannelExport?: boolean } = {}) {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return null
    }

    const previouslyExportedChannels =
      options.promptChannelExport && text(originalItemRef.current?.status).toLowerCase() === 'finalised'
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

    const shouldQueueStockSync = stockLevelChanged && isLinnworksManaged

    const cleanedItem = {
      ...item,
      status: item.status === 'processed' ? 'finalised' : item.status,

      cost_price: blankToNull(item.cost_price),
      selling_price: blankToNull(item.selling_price),
      stock_level: newStockLevel,
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
    } catch (stockError: any) {
      setMessage(`Saved item, but stock-location row failed: ${stockError.message}`)
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

    if (options.promptChannelExport && previouslyExportedChannels.length > 0) {
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

    let updatedItem = {
      ...item,
      status: 'review',
      location_status: item.location_status || 'stored',
      current_location: item.current_location || 'WAREHOUSE',
      current_bin: item.current_bin || 'Default',
      last_saved_by: staff.id,
      sent_to_review_by: staff.id,
      sent_to_review_at: now,
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
    window.location.href = '/review'
  }

  async function finaliseItem() {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    if (!item) return

    const isReusableSku = item.sku_type === 'reusable'
    const imageCount = isReusableSku ? 0 : await getImageCount()
    const missing = missingFinaliseFields(item, imageCount)

    if (missing.length > 0) {
      window.alert(
        `Cannot finalise SKU ${item.sku}. Missing: ${missing.join(', ')}`
      )
      return
    }

    if (isReusableSku) {
      const confirmed = window.confirm(
        `Finalise reusable SKU ${item.sku}?\n\nThis will save the item and mark it as finalised.`
      )

      if (!confirmed) return

      const exportNow = window.confirm(
        `Export ${item.sku} to Linnworks now?\n\nYes = finalise and export now.\nNo = finalise locally only.`
      )

      setProcessingImages(true)
      setMessage(exportNow ? 'Saving and exporting reusable SKU...' : 'Saving reusable SKU...')

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
            setMessage(`Reusable SKU ${item.sku} finalised and exported to Linnworks.`)
          } catch (error: any) {
            setMessage(
              `Reusable SKU finalised locally, but Linnworks export failed: ${
                error.message || 'Unknown export error.'
              }`
            )
          }
        } else {
          setMessage(`Reusable SKU ${item.sku} finalised locally. Not exported to Linnworks.`)
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
    const updatedItem = {
      ...item,
      [field]: value,
    }

    setItem(updatedItem)

    setHasUnsavedChanges(
      JSON.stringify(originalItemRef.current) !== JSON.stringify(updatedItem)
    )
  }

  function updateSubCategory(value: string) {
    const updatedItem = {
      ...item,
      sub_category: value,
      sub_type: value,
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
  const ebayMessages = ebayReadinessMessages()
  const ebayReady = Boolean(ebayReadiness?.ok && ebayReadiness?.ready)
  const ebayPreviewHtml = ebayReadiness?.listing_draft?.description_html || ''

  return (
    <StaffPermissionGate permission="working">
      <main className="min-h-screen bg-zinc-950 p-5 text-white">
        <div className="app-header mb-5 flex flex-wrap items-start justify-between gap-4 rounded-3xl bg-black p-4 text-white shadow-2xl sm:p-5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
            <div>
              <h1 className="text-2xl font-black tracking-normal">SKU: {item.sku}</h1>

              <p className="text-sm text-zinc-300">
                Status: {item.status}
                {item.sku_type === 'reusable' ? ' · Reusable SKU' : ''}
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

          <div className="flex flex-wrap items-center justify-end gap-3">
            {message && (
              <span className="rounded-lg border border-yellow-700 bg-yellow-950 px-4 py-2 text-sm font-bold text-yellow-300">
                {message}
              </span>
            )}

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowEbayReadinessDetails((current) => !current)}
                title={ebayMessages.join('\n')}
                className={`rounded-xl px-4 py-2 text-sm font-black ${
                  ebayReady ? 'bg-green-600 text-white' : 'bg-red-700 text-white'
                }`}
              >
                eBay {checkingEbayReadiness ? '...' : ebayReady ? 'OK' : 'X'}
              </button>

              {showEbayReadinessDetails && (
                <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-xs font-bold text-zinc-200 shadow-xl">
                  <div className="space-y-1">
                    {ebayMessages.map((line: string, index: number) => (
                      <p key={`${line}-${index}`}>{line}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowEbayHtmlPreview(true)}
              disabled={!ebayPreviewHtml}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              HTML Preview
            </button>

            <button
              onClick={() => saveItem({ promptChannelExport: true })}
              disabled={!staff || processingImages || exportingLinnworks}
              className="rounded-xl bg-green-600 px-5 py-2 text-sm font-black text-white hover:bg-green-500 disabled:opacity-40"
            >
              Save Item
            </button>

            <button
              type="button"
              onClick={() => checkEbayReadiness()}
              disabled={checkingEbayReadiness}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800 disabled:opacity-40"
            >
              {checkingEbayReadiness ? 'Checking eBay' : 'Refresh eBay'}
            </button>

            {item.sku_type !== 'reusable' && (
              <button
                onClick={sendToReview}
                disabled={!staff || processingImages || exportingLinnworks}
                className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold disabled:opacity-40"
              >
                Send to Review
              </button>
            )}

            <button
              onClick={finaliseItem}
              disabled={!staff || processingImages || exportingLinnworks}
              className="rounded-lg bg-red-600 px-5 py-2 text-sm font-bold disabled:opacity-40"
            >
              {processingImages ? 'Finalising...' : 'Finalise'}
            </button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">
                Item Details
              </h2>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <Field
                  label="Brand"
                  value={item.brand}
                  onChange={(v: string) => updateField('brand', v)}
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

                <SelectField
                  label="Item Type"
                  value={item.item_type}
                  onChange={(v: string) => updateField('item_type', v)}
                  options={itemTypeOptions}
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
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-xs font-black text-white hover:bg-zinc-800 disabled:opacity-40"
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
                  className="mt-5 rounded-lg border border-zinc-700 px-4 py-2 text-xs font-black text-white hover:bg-zinc-800"
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
                  {visibleMeasurements.map((field) => (
                    <Field
                      key={field}
                      label={measurementLabels[field]}
                      value={item[field]}
                      onChange={(v: string) => updateField(field, v)}
                    />
                  ))}

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


'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { useStaff } from '@/app/context/StaffContext'

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

const conditionOptions = [
  'New with tags',
  'New without tags',
  'Excellent',
  'Very Good',
  'Good',
  'Fair',
  'Poor / For Repair',
]

const genderOptions = ['Male', 'Female', 'Unisex', 'Kids']

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
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-400">{label}</span>

      <input
        list={listId}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || 'Type or select'}
        className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-white"
      />

      <datalist id={listId}>
        {options.map((option: string) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </label>
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
    reporting_category: item.reporting_category,
    tagged_size: item.tagged_size,
    size_label: item.size_label,
    condition: item.condition,

    material: item.material,
    colour_primary: item.colour_primary,
    colour_secondary: item.colour_secondary,
    style: item.style,
    sub_type: item.sub_type,
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

  const [item, setItem] = useState<any>(null)
  const [message, setMessage] = useState('')
  const [generatingAi, setGeneratingAi] = useState(false)
  const [processingImages, setProcessingImages] = useState(false)
  const [exportingLinnworks, setExportingLinnworks] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [photoRefreshKey, setPhotoRefreshKey] = useState(0)

  const originalItemRef = useRef<any>(null)

  useEffect(() => {
    fetchItem()
  }, [id])

  useEffect(() => {
    if (!message) return

    const timer = window.setTimeout(() => {
      setMessage('')
    }, 5000)

    return () => window.clearTimeout(timer)
  }, [message])

  async function fetchItem() {
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      setMessage(error.message)
      return
    }

    setItem(data)
    originalItemRef.current = data
    setHasUnsavedChanges(false)
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
          ['sub_type', 'Sub Type'],
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
      .filter(([key]) => !itemToCheck[key])
      .map(([_, label]) => label)

    if (!isReusableSku && imageCount < 1) {
      missing.push('Image')
    }

    return missing
  }

  async function generateAiCopy() {
    if (!item) return

    setGeneratingAi(true)

    try {
      const imageUrls = await getFirstTwoImageUrls()

      const response = await fetch('/api/generate-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item, imageUrls }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'AI generation failed')
      }

      const updatedItem = {
        ...item,
        ai_title: result.ai_title || '',
        ai_description: result.ai_description || '',
        website_title: result.website_title || '',
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

      throw error
    } finally {
      setExportingLinnworks(false)
    }
  }

  async function saveItem() {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return null
    }

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

      cost_price: blankToNull(item.cost_price),
      selling_price: blankToNull(item.selling_price),
      stock_level: newStockLevel,

      waist_in: blankToNull(item.waist_in),
      inside_leg_in: blankToNull(item.inside_leg_in),
      rise_in: blankToNull(item.rise_in),
      hem_width_in: blankToNull(item.hem_width_in),

      pit_to_pit_in: blankToNull(item.pit_to_pit_in),
      collar_to_hem_in: blankToNull(item.collar_to_hem_in),
      pit_to_cuff_in: blankToNull(item.pit_to_cuff_in),
      sleeve_in: blankToNull(item.sleeve_in),

      weight_grams: blankToNull(item.weight_grams),

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

    if (error) {
      setMessage(error.message)
      return null
    }

    let savedItem = cleanedItem

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

    const updatedItem = {
      ...item,
      status: 'review',
      last_saved_by: staff.id,
      sent_to_review_by: staff.id,
      sent_to_review_at: now,
      updated_at: now,
    }

    const { error } = await supabase
      .from('items')
      .update(updatedItem)
      .eq('id', id)

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

  return (
    <StaffPermissionGate permission="working">
      <main className="min-h-screen bg-zinc-950 p-5 text-white">
        <div className="mb-5 flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold">SKU: {item.sku}</h1>

              <p className="text-sm text-zinc-400">
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

            <button
              onClick={saveItem}
              disabled={!staff || processingImages || exportingLinnworks}
              className="rounded-lg bg-green-600 px-5 py-2 text-sm font-bold disabled:opacity-40"
            >
              Save Item
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

                <Field
                  label="Sub Type"
                  value={item.sub_type}
                  onChange={(v: string) => updateField('sub_type', v)}
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
                  options={conditionOptions}
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

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <Field
                    label="Basic Title"
                    value={item.basic_title}
                    onChange={(v: string) => updateField('basic_title', v)}
                  />

                  <TextArea
                    label="Basic Description"
                    value={item.basic_description}
                    onChange={(v: string) => updateField('basic_description', v)}
                  />

                  <TextArea
                    label="Flaws"
                    value={item.flaws}
                    onChange={(v: string) => updateField('flaws', v)}
                  />
                </div>

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
      </main>
    </StaffPermissionGate>
  )
}
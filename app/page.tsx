'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import AppNav from '@/app/components/AppNav'
import { useStaff } from '@/app/context/StaffContext'

type ItemImage = {
  processed_url: string | null
  original_url: string | null
  image_order: number | null
}

type ScannedItem = {
  id: string | null
  sku: string
  barcode_number?: string | null
  exists: boolean
  selected: boolean
  image_url?: string | null
  ai_title?: string | null
  basic_title?: string | null
  brand?: string | null
  reporting_category?: string | null
  tagged_size?: string | null
  waist_in?: string | number | null
  condition?: string | null
  selling_price?: number | null
  stock_level?: number | null
  sku_type?: 'single_use' | 'reusable' | string | null
  location_status?: string | null
  current_location?: string | null
  current_bin?: string | null
  loan_status?: string | null
  loaned_by?: string | null
  loaned_by_name?: string | null
  ebay_status?: string | null
  linnworks_status?: string | null
  shopify_status?: string | null
  square_status?: string | null
  loyverse_status?: string | null
  vinted_status?: string | null
  depop_status?: string | null
  tiktok_shop_status?: string | null
}

type PreviewLabelItem = {
  sku: string
  sizeText?: string | null
  price?: number | null
}

type ReusableSkuResult = {
  id: string
  sku: string
  barcode_number?: string | null
  sku_type?: string | null
  brand?: string | null
  reporting_category?: string | null
  basic_title?: string | null
  ai_title?: string | null
  final_title?: string | null
  selling_price?: number | null
  stock_level?: number | null
  current_location?: string | null
  current_bin?: string | null
}

const CHANNEL_ICONS = [
  { key: 'ebay_status', name: 'eBay', src: 'https://www.ebay.co.uk/favicon.ico' },
  { key: 'linnworks_status', name: 'Linnworks', src: 'https://www.linnworks.com/favicon.ico' },
  { key: 'shopify_status', name: 'Shopify', src: 'https://www.shopify.com/favicon.ico' },
  { key: 'square_status', name: 'Square', src: 'https://squareup.com/favicon.ico' },
  { key: 'loyverse_status', name: 'Loyverse', src: 'https://loyverse.com/favicon.ico' },
  { key: 'vinted_status', name: 'Vinted', src: 'https://www.vinted.co.uk/favicon.ico' },
  { key: 'depop_status', name: 'Depop', src: 'https://www.depop.com/favicon.ico' },
  { key: 'tiktok_shop_status', name: 'TikTok Shop', src: 'https://shop.tiktok.com/favicon.ico' },
] as const

function getYearPrefix() {
  return new Date().getFullYear().toString().slice(-2)
}

function luhnCheckDigit(input: string) {
  let sum = 0
  let shouldDouble = true

  for (let i = input.length - 1; i >= 0; i--) {
    let digit = Number(input[i])

    if (shouldDouble) {
      digit *= 2
      if (digit > 9) digit -= 9
    }

    sum += digit
    shouldDouble = !shouldDouble
  }

  return String((10 - (sum % 10)) % 10)
}

function isValidSku(sku: string) {
  if (!/^\d{10}$/.test(sku)) return false

  const body = sku.slice(0, -1)
  const checkDigit = sku.slice(-1)

  return luhnCheckDigit(body) === checkDigit
}

function extractTransferIdFromScan(value: string) {
  const cleaned = value.trim()
  const match = cleaned.match(/\/transfers\/([^/?#]+)/)

  if (match?.[1]) return match[1]

  return null
}

function randomSequenceNumber() {
  return Math.floor(Math.random() * 10000000)
}

function getSizeText(item: ScannedItem) {
  if (
    item.waist_in !== null &&
    item.waist_in !== undefined &&
    item.waist_in !== ''
  ) {
    return `W${item.waist_in}"`
  }

  if (item.tagged_size) return item.tagged_size

  return ''
}

function openLabelPreview(items: PreviewLabelItem[]) {
  window.localStorage.setItem('label_preview_items', JSON.stringify(items))
  window.open('/labels/preview', '_blank')
}

function cleanReusableSku(value: string) {
  return value.trim().toUpperCase()
}

function escapePostgrestOrValue(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')
    .replaceAll(',', '\\,')
}

function getReusableTitle(item: ReusableSkuResult) {
  return item.final_title || item.ai_title || item.basic_title || item.sku
}

export default function SkuSearchPage() {
  const router = useRouter()
  const scanInputRef = useRef<HTMLInputElement | null>(null)
  const { staff } = useStaff()

  const [scanValue, setScanValue] = useState('')
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([])
  const [printQty, setPrintQty] = useState(10)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [reusableSearch, setReusableSearch] = useState('')
  const [reusableResults, setReusableResults] = useState<ReusableSkuResult[]>([])
  const [reusableSuggestionsLoaded, setReusableSuggestionsLoaded] = useState(false)
  const [reusableBusy, setReusableBusy] = useState(false)
  const [reusableMessage, setReusableMessage] = useState('')
  const [reusablePrintOpen, setReusablePrintOpen] = useState(false)
  const [reusablePrintQty, setReusablePrintQty] = useState(1)
  const [reusablePrintItem, setReusablePrintItem] = useState<ReusableSkuResult | null>(null)

  const selectedItems = useMemo(
    () => scannedItems.filter((item) => item.selected),
    [scannedItems]
  )

  const exactReusableMatch = useMemo(() => {
    const clean = cleanReusableSku(reusableSearch)

    if (!clean) return null

    return (
      reusableResults.find((item) => item.sku.toUpperCase() === clean || item.barcode_number === clean) ||
      null
    )
  }, [reusableResults, reusableSearch])

  const reusableDropdownMatches = useMemo(() => {
    const clean = reusableSearch.trim().toLowerCase()

    if (!clean) return []

    return reusableResults
      .filter((item) => {
        const haystack = [
          item.sku,
          item.barcode_number,
          item.brand,
          item.reporting_category,
          item.basic_title,
          item.ai_title,
          item.final_title,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()

        return haystack.includes(clean)
      })
      .slice(0, 8)
  }, [reusableResults, reusableSearch])

  const selectedCount = selectedItems.length

  const selectedLoanItems = selectedItems.filter(
    (item) => item.loan_status === 'on_loan'
  )

  const selectedLoanCount = selectedLoanItems.length
  const hasSelectedLoanItems = selectedLoanCount > 0
  const hasMixedLoanSelection =
    selectedLoanCount > 0 && selectedLoanCount < selectedCount

  const allSelected =
    scannedItems.length > 0 && scannedItems.every((item) => item.selected)

  const showTransferToShop =
    selectedCount > 0 &&
    !hasSelectedLoanItems &&
    selectedItems.some((item) => item.current_location !== 'SHOP-1')

  const showTransferToWarehouse =
    selectedCount > 0 &&
    !hasSelectedLoanItems &&
    selectedItems.some((item) => item.current_location !== 'WAREHOUSE')

  async function getStaffName(staffId?: string | null) {
    if (!staffId) return null

    const { data } = await supabase
      .from('staff_users')
      .select('name')
      .eq('id', staffId)
      .maybeSingle()

    return data?.name || null
  }

  async function createItemFromSku(sku: string) {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return null
    }

    const now = new Date().toISOString()

    const { data, error } = await supabase
      .from('items')
      .insert({
        sku,
        status: 'working',
        stock_level: 1,
        sku_type: 'single_use',
        location_status: 'unknown',
        current_location: null,
        current_bin: null,
        loan_status: 'not_on_loan',
        ebay_status: 'not_listed',
        linnworks_status: 'not_synced',
        shopify_status: 'not_listed',
        square_status: 'not_listed',
        loyverse_status: 'not_listed',
        vinted_status: 'not_listed',
        depop_status: 'not_listed',
        tiktok_shop_status: 'not_listed',
        last_saved_by: staff.id,
        updated_at: now,
      })
      .select('*')
      .single()

    if (error) {
      setMessage(error.message)
      return null
    }

    return data
  }

  async function handleScan() {
    const rawSku = scanValue.trim()

    if (!rawSku) return

    const transferId = extractTransferIdFromScan(rawSku)

    if (transferId) {
      setScanValue('')
      router.push(`/transfers/${transferId}`)
      return
    }

    setMessage('')

    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    const isTenDigitBarcode = /^\d{10}$/.test(rawSku)

    if (isTenDigitBarcode && !isValidSku(rawSku)) {
      setMessage(`Invalid SKU/check digit: ${rawSku}`)
      setScanValue('')
      return
    }

    setBusy(true)

    const safeLookup = escapePostgrestOrValue(rawSku)

    const { data, error } = await supabase
      .from('items')
      .select(`
        id,
        sku,
        barcode_number,
        brand,
        reporting_category,
        tagged_size,
        waist_in,
        condition,
        selling_price,
        stock_level,
        sku_type,
        ai_title,
        basic_title,
        location_status,
        current_location,
        current_bin,
        loan_status,
        loaned_by,
        ebay_status,
        linnworks_status,
        shopify_status,
        square_status,
        loyverse_status,
        vinted_status,
        depop_status,
        tiktok_shop_status,
        item_images (
          processed_url,
          original_url,
          image_order
        )
      `)
      .eq('sku', rawSku)
      .maybeSingle()

    setBusy(false)

    if (error) {
      setMessage(error.message)
      return
    }

    let itemData = data

    if (!itemData) {
      const confirmed = window.confirm(
        `SKU ${rawSku} is not in the app yet. Create item now?`
      )

      if (confirmed) {
        setBusy(true)
        const createdItem = await createItemFromSku(rawSku)
        setBusy(false)

        if (!createdItem) {
          setScanValue('')
          return
        }

        itemData = createdItem
        setMessage(`Created item ${rawSku} by ${staff.name}`)
      }
    }

    const loanedByName =
      itemData?.loan_status === 'on_loan'
        ? await getStaffName(itemData?.loaned_by)
        : null

    const images = (itemData?.item_images || []) as ItemImage[]

    const firstImageRecord =
      images
        .filter((img) => img.processed_url || img.original_url)
        .sort((a, b) => (a.image_order ?? 0) - (b.image_order ?? 0))[0] || null

    const firstImage =
      firstImageRecord?.processed_url || firstImageRecord?.original_url || null

    const newItem: ScannedItem = {
      id: itemData?.id || null,
      sku: itemData?.sku || rawSku,
      barcode_number: itemData?.barcode_number || null,
      exists: !!itemData,
      selected: true,
      image_url: firstImage,
      ai_title: itemData?.ai_title || null,
      basic_title: itemData?.basic_title || null,
      brand: itemData?.brand || null,
      reporting_category: itemData?.reporting_category || null,
      tagged_size: itemData?.tagged_size || null,
      waist_in: itemData?.waist_in || null,
      condition: itemData?.condition || null,
      selling_price: itemData?.selling_price || null,
      stock_level: itemData?.stock_level ?? 1,
      sku_type: itemData?.sku_type || 'single_use',
      location_status: itemData?.location_status || 'unknown',
      current_location: itemData?.current_location || null,
      current_bin: itemData?.current_bin || null,
      loan_status: itemData?.loan_status || 'not_on_loan',
      loaned_by: itemData?.loaned_by || null,
      loaned_by_name: loanedByName,
      ebay_status: itemData?.ebay_status || 'not_listed',
      linnworks_status: itemData?.linnworks_status || 'not_synced',
      shopify_status: itemData?.shopify_status || 'not_listed',
      square_status: itemData?.square_status || 'not_listed',
      loyverse_status: itemData?.loyverse_status || 'not_listed',
      vinted_status: itemData?.vinted_status || 'not_listed',
      depop_status: itemData?.depop_status || 'not_listed',
      tiktok_shop_status: itemData?.tiktok_shop_status || 'not_listed',
    }

    setScannedItems((prev) => [newItem, ...prev])
    setScanValue('')

    setTimeout(() => scanInputRef.current?.focus(), 50)
  }

  function toggleSelectAll() {
    setScannedItems((prev) =>
      prev.map((item) => ({
        ...item,
        selected: !allSelected,
      }))
    )
  }

  function toggleItemSelected(sku: string) {
    setScannedItems((prev) =>
      prev.map((item) =>
        item.sku === sku ? { ...item, selected: !item.selected } : item
      )
    )
  }

  function clearScans() {
    setScannedItems([])
    setMessage('')
  }

  function openSelectedItem() {
    if (selectedCount !== 1) return

    const selected = selectedItems[0]

    if (!selected.id) {
      setMessage('This SKU does not exist in the app yet.')
      return
    }

    router.push(`/items/${selected.id}`)
  }

  function openLoanReturn() {
    if (selectedLoanCount === 0) {
      setMessage('Select an item that is currently on loan.')
      return
    }

    window.localStorage.setItem(
      'loan_return_skus',
      JSON.stringify(selectedLoanItems.map((item) => item.sku))
    )

    router.push('/scanner/loan')
  }

  async function moveSelected(to: 'warehouse' | 'shop') {
    if (!staff) {
      setMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    if (hasSelectedLoanItems) {
      setMessage('One or more selected items are on loan. Return them before transferring.')
      return
    }

    if (selectedCount === 0) {
      setMessage('Select at least one item.')
      return
    }

    const existingItems = selectedItems.filter((item) => item.id)

    if (existingItems.length === 0) {
      setMessage('None of the selected SKUs exist in the app yet.')
      return
    }

    const fromLocation = to === 'warehouse' ? 'SHOP-1' : 'WAREHOUSE'
    const toLocation = to === 'warehouse' ? 'WAREHOUSE' : 'SHOP-1'
    const inTransitLocation =
      to === 'warehouse' ? 'IN-TRANSIT-TO-WAREHOUSE' : 'IN-TRANSIT-TO-SHOP'

    const confirmedTransfer = window.confirm(
      `Transfer stock OK?\n\n${existingItems.length} item(s) will be transferred to ${toLocation}.`
    )

    if (!confirmedTransfer) return

    const now = new Date().toISOString()

    setBusy(true)
    setMessage('Creating transfer...')

    const { data: transfer, error: transferError } = await supabase
      .from('stock_transfers')
      .insert({
        from_location: fromLocation,
        to_location: toLocation,
        status: 'sent',
        sent_at: now,
        created_by: staff.id,
      })
      .select('id, transfer_number')
      .single()

    if (transferError || !transfer) {
      setBusy(false)
      setMessage(transferError?.message || 'Could not create transfer.')
      return
    }

    const { error: transferItemsError } = await supabase
      .from('stock_transfer_items')
      .insert(
        existingItems.map((item) => ({
          transfer_id: transfer.id,
          item_id: item.id,
          sku: item.sku,
          status: 'in_transfer',
        }))
      )

    if (transferItemsError) {
      setBusy(false)
      setMessage(transferItemsError.message)
      return
    }

    const { error: itemUpdateError } = await supabase
      .from('items')
      .update({
        location_status: 'in_transfer',
        current_location: inTransitLocation,
        current_bin: inTransitLocation,
        last_saved_by: staff.id,
        updated_at: now,
      })
      .in(
        'id',
        existingItems.map((item) => item.id)
      )

    if (itemUpdateError) {
      setBusy(false)
      setMessage(itemUpdateError.message)
      return
    }

    setScannedItems((prev) =>
      prev.map((item) =>
        item.selected && item.id
          ? {
              ...item,
              location_status: 'in_transfer',
              current_location: inTransitLocation,
              current_bin: inTransitLocation,
              selected: false,
            }
          : item
      )
    )

    setBusy(false)

    const paddedTransferNumber = String(transfer.transfer_number).padStart(7, '0')

    setMessage(
      `Created transfer #${paddedTransferNumber} for ${existingItems.length} item(s) by ${staff.name}.`
    )

    const printManifest = window.confirm(
      `Transfer #${paddedTransferNumber} created.\n\nPrint manifest now?`
    )

    if (printManifest) {
      window.open(`/transfers/${transfer.id}/manifest`, '_blank')
    }
  }

  function reprintSelectedLabels() {
    if (selectedCount === 0) {
      setMessage('Select at least one label to reprint.')
      return
    }

    openLabelPreview(
      selectedItems.map((item) => ({
        sku: item.sku,
        sizeText: getSizeText(item),
        price: item.selling_price,
      }))
    )

    setMessage(`Opened preview for ${selectedItems.length} label(s).`)
  }

  async function printNextLabels() {
    const qty = Number(printQty)

    if (qty < 0 || qty > 100) {
      setMessage('Quantity must be 0–100.')
      return
    }

    if (qty === 0) {
      setMessage('Quantity is 0. Nothing to print.')
      return
    }

    setBusy(true)
    setMessage('Generating labels...')

    try {
      const yearPrefix = getYearPrefix()
      const skus: string[] = []

      const rowsToInsert: {
        sku: string
        year_prefix: string
        sequence_number: number
        check_digit: string
      }[] = []

      let attempts = 0

      while (skus.length < qty && attempts < qty * 100) {
        attempts++

        const sequenceNumber = randomSequenceNumber()
        const body = `${yearPrefix}${String(sequenceNumber).padStart(7, '0')}`
        const checkDigit = luhnCheckDigit(body)
        const sku = `${body}${checkDigit}`

        if (skus.includes(sku)) continue

        const { data: existingItem, error: itemCheckError } = await supabase
          .from('items')
          .select('sku')
          .eq('sku', sku)
          .maybeSingle()

        if (itemCheckError) {
          throw new Error(`Item SKU check failed: ${itemCheckError.message}`)
        }

        if (existingItem) continue

        const { data: existingGenerated, error: generatedCheckError } =
          await supabase
            .from('generated_skus')
            .select('sku')
            .eq('sku', sku)
            .maybeSingle()

        if (generatedCheckError) {
          throw new Error(
            `Generated SKU check failed: ${generatedCheckError.message}`
          )
        }

        if (existingGenerated) continue

        skus.push(sku)

        rowsToInsert.push({
          sku,
          year_prefix: yearPrefix,
          sequence_number: sequenceNumber,
          check_digit: checkDigit,
        })
      }

      if (skus.length !== qty) {
        throw new Error('Could not generate enough unique SKUs.')
      }

      const { error: insertError } = await supabase
        .from('generated_skus')
        .insert(rowsToInsert)

      if (insertError) {
        throw new Error(`Saving generated SKUs failed: ${insertError.message}`)
      }

      openLabelPreview(
        skus.map((sku) => ({
          sku,
          sizeText: '',
          price: null,
        }))
      )

      setMessage(`Opened preview for ${skus.length} new single-use SKU label(s).`)
    } catch (error: any) {
      setMessage(error.message || 'Print Next failed.')
    } finally {
      setBusy(false)
    }
  }

  async function generateReusableBarcodeNumber() {
    const yearPrefix = getYearPrefix()
    let attempts = 0

    while (attempts < 1000) {
      attempts++

      const sequenceNumber = randomSequenceNumber()
      const body = `${yearPrefix}${String(sequenceNumber).padStart(7, '0')}`
      const checkDigit = luhnCheckDigit(body)
      const barcodeNumber = `${body}${checkDigit}`

      const { data: existingItemBySku, error: itemSkuError } = await supabase
        .from('items')
        .select('id')
        .eq('sku', barcodeNumber)
        .maybeSingle()

      if (itemSkuError) {
        throw new Error(`Item SKU check failed: ${itemSkuError.message}`)
      }

      if (existingItemBySku) continue

      const { data: existingItemByBarcode, error: itemBarcodeError } = await supabase
        .from('items')
        .select('id')
        .eq('barcode_number', barcodeNumber)
        .maybeSingle()

      if (itemBarcodeError) {
        throw new Error(`Item barcode check failed: ${itemBarcodeError.message}`)
      }

      if (existingItemByBarcode) continue

      const { data: existingGenerated, error: generatedCheckError } =
        await supabase
          .from('generated_skus')
          .select('sku')
          .eq('sku', barcodeNumber)
          .maybeSingle()

      if (generatedCheckError) {
        throw new Error(
          `Generated SKU check failed: ${generatedCheckError.message}`
        )
      }

      if (existingGenerated) continue

      const { error: insertGeneratedError } = await supabase
        .from('generated_skus')
        .insert({
          sku: barcodeNumber,
          year_prefix: yearPrefix,
          sequence_number: sequenceNumber,
          check_digit: checkDigit,
        })

      if (insertGeneratedError) {
        throw new Error(`Saving reusable barcode failed: ${insertGeneratedError.message}`)
      }

      return barcodeNumber
    }

    throw new Error('Could not generate a reusable barcode number.')
  }

  async function loadReusableSkuSuggestions() {
    if (reusableSuggestionsLoaded || reusableBusy) return

    setReusableBusy(true)
    setReusableMessage('')

    try {
      const { data, error } = await supabase
        .from('items')
        .select(`
          id,
          sku,
          barcode_number,
          sku_type,
          brand,
          reporting_category,
          basic_title,
          ai_title,
          final_title,
          selling_price,
          stock_level,
          current_location,
          current_bin
        `)
        .eq('sku_type', 'reusable')
        .order('sku', { ascending: true })
        .limit(300)

      if (error) throw new Error(error.message)

      setReusableResults((data || []) as ReusableSkuResult[])
      setReusableSuggestionsLoaded(true)
    } catch (error: any) {
      setReusableMessage(error.message || 'Could not load reusable SKU suggestions.')
    } finally {
      setReusableBusy(false)
    }
  }

  async function findReusableSku() {
    const clean = reusableSearch.trim()

    if (!clean) {
      setReusableMessage('Enter a reusable SKU, brand, or title first.')
      return
    }

    setReusableBusy(true)
    setReusableMessage('Finding reusable SKU...')

    try {
      const sku = cleanReusableSku(clean)
      const safe = escapePostgrestOrValue(clean)

      const { data, error } = await supabase
        .from('items')
        .select(`
          id,
          sku,
          barcode_number,
          sku_type,
          brand,
          reporting_category,
          basic_title,
          ai_title,
          final_title,
          selling_price,
          stock_level,
          current_location,
          current_bin
        `)
        .eq('sku_type', 'reusable')
        .or(
          `sku.eq.${sku},barcode_number.eq.${sku},sku.ilike.%${safe}%,barcode_number.ilike.%${safe}%,brand.ilike.%${safe}%,basic_title.ilike.%${safe}%,ai_title.ilike.%${safe}%,final_title.ilike.%${safe}%`
        )
        .order('sku', { ascending: true })
        .limit(8)

      if (error) throw new Error(error.message)

      const rows = (data || []) as ReusableSkuResult[]
      setReusableResults(rows)
      setReusableSuggestionsLoaded(true)

      if (rows.length === 0) {
        setReusableMessage('No reusable SKU found. Use Create New if this should be a repeat-stock SKU.')
        return
      }

      const exact = rows.find((item) => item.sku.toUpperCase() === sku || item.barcode_number === sku)

      if (exact) {
        setReusableMessage(`Found reusable SKU ${exact.sku}. Use Edit or Print.`)
        return
      }

      setReusableMessage(`Found ${rows.length} matching reusable SKU(s).`)
    } catch (error: any) {
      setReusableMessage(error.message || 'Could not find reusable SKU.')
    } finally {
      setReusableBusy(false)
    }
  }

  async function createReusableSku() {
    if (!staff) {
      setReusableMessage('No active staff selected. Go to staff PIN screen first.')
      return
    }

    const sku = cleanReusableSku(reusableSearch)

    if (!sku) {
      setReusableMessage('Enter a reusable SKU first.')
      return
    }

    if (exactReusableMatch) {
      setReusableMessage('This reusable SKU already exists. Use Edit or Print.')
      return
    }

    const confirmed = window.confirm(
      `Create reusable SKU ${sku}?\n\nThis creates a repeat-stock product line, not a one-off single-use item.`
    )

    if (!confirmed) return

    const now = new Date().toISOString()

    setReusableBusy(true)
    setReusableMessage('Creating reusable SKU...')

    try {
      const { data: existing, error: existingError } = await supabase
        .from('items')
        .select('id, sku, barcode_number, sku_type')
        .eq('sku', sku)
        .maybeSingle()

      if (existingError) throw new Error(existingError.message)

      if (existing) {
        setReusableMessage(
          existing.sku_type === 'reusable'
            ? 'Reusable SKU already exists. Use Find, Edit, or Print.'
            : 'That SKU already exists as a single-use/item SKU. Choose a different reusable SKU.'
        )
        return
      }

      const barcodeNumber = await generateReusableBarcodeNumber()

      const { data, error } = await supabase
        .from('items')
        .insert({
          sku,
          barcode_number: barcodeNumber,
          sku_type: 'reusable',
          status: 'working',
          stock_level: 0,
          shop_floor_stock: 0,
          warehouse_stock: 0,
          location_status: 'unknown',
          current_location: null,
          current_bin: null,
          loan_status: 'not_on_loan',
          ebay_status: 'not_listed',
          linnworks_status: 'not_synced',
          shopify_status: 'not_listed',
          square_status: 'not_listed',
          loyverse_status: 'not_listed',
          vinted_status: 'not_listed',
          depop_status: 'not_listed',
          tiktok_shop_status: 'not_listed',
          last_saved_by: staff.id,
          updated_at: now,
        })
        .select('id')
        .single()

      if (error) throw new Error(error.message)

      setReusableSearch('')
      setReusableResults([])
      setReusableSuggestionsLoaded(false)
      setReusableMessage(`Created reusable SKU ${sku} with barcode ${barcodeNumber}. Opening edit page...`)
      router.push(`/items/${data.id}`)
    } catch (error: any) {
      setReusableMessage(error.message || 'Could not create reusable SKU.')
    } finally {
      setReusableBusy(false)
    }
  }

  function editReusableSku(item: ReusableSkuResult) {
    router.push(`/items/${item.id}`)
  }

  function openReusablePrintQuantity(item?: ReusableSkuResult | null) {
    const target = item || exactReusableMatch

    if (!target) {
      setReusableMessage('Find or select an existing reusable SKU before printing.')
      return
    }

    setReusablePrintItem(target)
    setReusablePrintQty(1)
    setReusablePrintOpen(true)
  }

  function printReusableSkuQuantity() {
    if (!reusablePrintItem) return

    const qty = Math.max(1, Math.min(100, Number(reusablePrintQty) || 1))

    openLabelPreview(
      Array.from({ length: qty }, () => ({
        sku: reusablePrintItem.barcode_number || reusablePrintItem.sku,
        sizeText: reusablePrintItem.sku,
        price: reusablePrintItem.selling_price,
      }))
    )

    setReusablePrintOpen(false)
    setReusableMessage(`Opened ${qty} label(s) for ${reusablePrintItem.sku}.`)
  }

  function channelOpacity(status?: string | null) {
    if (!status || status === 'not_listed' || status === 'not_synced') {
      return 'opacity-25 grayscale'
    }

    if (status === 'listed' || status === 'synced' || status === 'active') {
      return 'opacity-100'
    }

    if (status === 'error') {
      return 'opacity-80 grayscale ring-1 ring-red-500'
    }

    if (status === 'queued') {
      return 'opacity-60 grayscale'
    }

    return 'opacity-40 grayscale'
  }

  return (
    <main className="min-h-screen bg-neutral-950 p-5 text-white">
      <div className="mb-5 flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">SKU Search</h1>

            <p className="text-sm text-neutral-400">
              Scan SKUs, preview labels, move location, and open items for editing.
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

          <AppNav current="sku" />
        </div>

        <div className="flex items-center gap-3">
          {message && (
            <span className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm">
              {message}
            </span>
          )}
        </div>
      </div>

      <section className="mb-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            ref={scanInputRef}
            value={scanValue}
            onChange={(e) => setScanValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleScan()
            }}
            placeholder={staff ? 'Scan SKU or transfer QR' : 'Go to staff PIN screen first'}
            disabled={busy || !staff}
            className="flex-1 rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-lg outline-none focus:border-white disabled:opacity-50"
            autoFocus
          />

          <button
            onClick={handleScan}
            disabled={busy || !staff}
            className="rounded-xl bg-white px-5 py-3 font-semibold text-black disabled:opacity-50"
          >
            Add Scan
          </button>
        </div>
      </section>

      <section className="mb-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              disabled={scannedItems.length === 0}
              className="h-5 w-5 rounded border-zinc-600 bg-zinc-950"
            />

            <div>
              <h2 className="text-lg font-semibold">Scanned Items</h2>

              <p className="text-sm text-neutral-400">
                {scannedItems.length} scanned / {selectedCount} selected
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {hasMixedLoanSelection && (
              <div className="w-full rounded-xl border border-orange-700 bg-orange-950 p-3 text-sm font-bold text-orange-200">
                {selectedLoanCount} of {selectedCount} selected item(s) are on loan.
                Return loan items before transferring stock.
              </div>
            )}

            {selectedLoanCount > 0 && (
              <button
                onClick={openLoanReturn}
                className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-black text-white hover:bg-orange-500"
              >
                Return Loan
              </button>
            )}

            {showTransferToWarehouse && (
              <button
                onClick={() => moveSelected('warehouse')}
                disabled={busy || !staff || selectedCount === 0}
                className="rounded-xl border border-neutral-700 px-4 py-2 text-sm disabled:opacity-40"
              >
                Transfer to Warehouse
              </button>
            )}

            {showTransferToShop && (
              <button
                onClick={() => moveSelected('shop')}
                disabled={busy || !staff || selectedCount === 0}
                className="rounded-xl border border-neutral-700 px-4 py-2 text-sm disabled:opacity-40"
              >
                Transfer to Shop
              </button>
            )}

            <button
              onClick={reprintSelectedLabels}
              disabled={selectedCount === 0}
              className="rounded-xl border border-neutral-700 px-4 py-2 text-sm disabled:opacity-40"
            >
              Reprint Label
            </button>

            <button
              onClick={openSelectedItem}
              disabled={selectedCount !== 1}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
            >
              Open / Edit
            </button>

            <button
              onClick={clearScans}
              disabled={scannedItems.length === 0}
              className="rounded-xl border border-neutral-700 px-4 py-2 text-sm disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {scannedItems.length === 0 && (
            <div className="rounded-2xl border border-dashed border-neutral-800 p-8 text-center text-neutral-500">
              No SKUs scanned yet.
            </div>
          )}

          {scannedItems.map((item) => {
            const isOnLoan = item.loan_status === 'on_loan'

            return (
              <div
                key={item.sku}
                className={`w-full rounded-2xl border bg-neutral-950 p-3 ${
                  item.selected ? 'border-white' : 'border-neutral-800'
                }`}
              >
                <div className="flex gap-3">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={() => toggleItemSelected(item.sku)}
                      className="h-5 w-5 rounded border-zinc-600 bg-zinc-950"
                    />
                  </div>

                  <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-neutral-800">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-neutral-500">
                        No image
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-xs text-neutral-500">
                          {item.sku}
                        </p>

                        <h3 className="truncate text-base font-semibold">
                          {item.ai_title || item.basic_title || 'Untitled item'}
                        </h3>

                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-neutral-400">
                          <span>{item.brand || 'No brand'}</span>
                          <span>·</span>
                          <span>{item.reporting_category || 'No category'}</span>
                          <span>·</span>
                          <span>{item.tagged_size || 'No size'}</span>
                          <span>·</span>
                          <span>{item.condition || 'No condition'}</span>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          {isOnLoan ? (
                            <>
                              <span className="rounded-full bg-orange-950 px-2 py-1 font-black text-orange-300">
                                ON LOAN
                              </span>

                              <span className="rounded-full bg-neutral-900 px-2 py-1 text-neutral-300">
                                Loaned by: {item.loaned_by_name || 'Unknown'}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="rounded-full bg-neutral-900 px-2 py-1 text-neutral-300">
                                {item.current_location || 'No location'}
                              </span>

                              <span className="rounded-full bg-neutral-900 px-2 py-1 text-neutral-300">
                                {item.current_bin || 'No bin/rack'}
                              </span>
                            </>
                          )}

                          {typeof item.selling_price === 'number' && (
                            <span className="rounded-full bg-neutral-900 px-2 py-1 text-neutral-300">
                              £{item.selling_price.toFixed(2)}
                            </span>
                          )}

                          {!item.exists && (
                            <span className="rounded-full bg-yellow-500/20 px-2 py-1 text-yellow-300">
                              Not in app yet
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col gap-1 rounded-lg bg-neutral-900 p-1">
                        {[0, 2, 4, 6].map((start) => (
                          <div key={start} className="flex gap-1">
                            {CHANNEL_ICONS.slice(start, start + 2).map((icon) => (
                              <img
                                key={icon.name}
                                src={icon.src}
                                title={`${icon.name}: ${String(
                                  item[icon.key as keyof ScannedItem] ||
                                    'not_listed'
                                )}`}
                                className={`h-4 w-4 rounded-sm ${channelOpacity(
                                  item[
                                    icon.key as keyof ScannedItem
                                  ] as string | null
                                )}`}
                              />
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 text-lg font-semibold">
            Print Next Single-Use Labels
          </h2>

          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              max={100}
              value={printQty}
              onChange={(e) => setPrintQty(Number(e.target.value))}
              className="w-32 rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
            />

            <button
              onClick={printNextLabels}
              disabled={busy}
              className="rounded-xl bg-white px-4 py-2 font-semibold text-black disabled:opacity-50"
            >
              Preview / Print Next
            </button>
          </div>

          <p className="mt-2 text-sm text-neutral-400">
            Generates unused pseudo-random single-use SKU barcode labels and opens the print preview page.
          </p>
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 text-lg font-semibold">
            Create / Find / Print Reusable SKU
          </h2>

          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <input
                value={reusableSearch}
                onFocus={loadReusableSkuSuggestions}
                onChange={(e) => setReusableSearch(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (exactReusableMatch) {
                      editReusableSku(exactReusableMatch)
                    } else {
                      findReusableSku()
                    }
                  }
                }}
                placeholder="Reusable SKU, brand, or title"
                list="reusable-sku-suggestions"
                disabled={!staff}
                className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-white disabled:opacity-50"
              />

              <datalist id="reusable-sku-suggestions">
                {reusableResults.map((item) => (
                  <option
                    key={item.id}
                    value={item.sku}
                    label={[
                      getReusableTitle(item),
                      item.barcode_number ? `Barcode ${item.barcode_number}` : '',
                      item.brand,
                      item.reporting_category,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                ))}
              </datalist>
            </div>

            <button
              type="button"
              onClick={() => {
                if (exactReusableMatch) {
                  editReusableSku(exactReusableMatch)
                  return
                }

                createReusableSku()
              }}
              disabled={reusableBusy || !staff || !reusableSearch.trim()}
              className="rounded-xl bg-emerald-400 px-4 py-2 font-semibold text-black disabled:opacity-50"
            >
              {exactReusableMatch ? 'Edit' : 'Create'}
            </button>

            <button
              type="button"
              onClick={findReusableSku}
              disabled={reusableBusy || !staff || !reusableSearch.trim()}
              className="rounded-xl bg-white px-4 py-2 font-semibold text-black disabled:opacity-50"
            >
              Find
            </button>

            <button
              type="button"
              onClick={() => openReusablePrintQuantity()}
              disabled={reusableBusy || !staff || !exactReusableMatch}
              className="rounded-xl border border-neutral-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
            >
              Print
            </button>
          </div>

          <p className="mt-2 text-sm text-neutral-400">
            Reusable SKUs are for repeat-stock product lines. The field gives suggestions from existing reusable SKUs, but does not run a search on every key press.
          </p>

          {reusableMessage && (
            <div className="mt-3 rounded-xl border border-neutral-700 bg-neutral-950 p-3 text-sm text-neutral-200">
              {reusableMessage}
            </div>
          )}

          {reusableBusy && (
            <p className="mt-3 text-sm font-bold text-neutral-400">Loading...</p>
          )}

          {reusableSearch.trim().length >= 2 &&
            reusableDropdownMatches.length > 0 && (
              <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                <p className="mb-2 text-xs font-bold uppercase text-neutral-500">
                  Matching reusable SKUs
                </p>

                <div className="space-y-2">
                  {reusableDropdownMatches.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setReusableSearch(item.sku)}
                      className="w-full rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left hover:border-white"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="font-mono text-xs text-neutral-500">{item.sku}</p>
                          {item.barcode_number && (
                            <p className="font-mono text-xs text-neutral-500">
                              Barcode: {item.barcode_number}
                            </p>
                          )}
                          <h3 className="truncate text-sm font-black">
                            {getReusableTitle(item)}
                          </h3>
                          <p className="mt-1 text-xs text-neutral-400">
                            {[item.brand, item.reporting_category, item.current_location || 'No location']
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                          <p className="mt-1 text-xs text-neutral-400">
                            Stock: {item.stock_level ?? 0}
                            {typeof item.selling_price === 'number'
                              ? ` · £${item.selling_price.toFixed(2)}`
                              : ''}
                          </p>
                        </div>

                        <div className="flex shrink-0 gap-2">
                          <span className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-black">
                            Select
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
        </div>
      </section>


      {reusablePrintOpen && reusablePrintItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-neutral-700 bg-neutral-900 p-5 text-white shadow-2xl">
            <h2 className="text-xl font-black">Print Reusable SKU</h2>
            <p className="mt-2 font-mono text-sm text-neutral-300">
              SKU: {reusablePrintItem.sku}
            </p>
            <p className="mt-1 font-mono text-sm text-neutral-300">
              Barcode: {reusablePrintItem.barcode_number || 'Not set'}
            </p>
            <p className="mt-1 text-sm text-neutral-400">
              {getReusableTitle(reusablePrintItem)}
            </p>

            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-bold text-neutral-400">
                Label quantity
              </span>
              <input
                type="number"
                min={1}
                max={100}
                value={reusablePrintQty}
                onChange={(e) => setReusablePrintQty(Number(e.target.value))}
                className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-3 text-lg outline-none focus:border-white"
                autoFocus
              />
            </label>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setReusablePrintOpen(false)}
                className="rounded-xl border border-neutral-700 px-4 py-3 font-semibold text-white"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={printReusableSkuQuantity}
                className="rounded-xl bg-white px-4 py-3 font-semibold text-black"
              >
                Print
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
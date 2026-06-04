import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getEbayIntegrationConfig, findBestEbayCategoryMapping } from '@/lib/ebayIntegrationSettings'
import { ebayRequest, getDefaultCategoryTreeId } from '@/lib/ebayApi'
import { buildEbayDescriptionHtml } from '@/lib/ebayListingTemplate'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Check = {
  key: string
  ok: boolean
  label: string
  message: string
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) throw new Error('Missing Supabase admin environment variables.')
  return createClient(url, serviceKey)
}

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function normalise(value: any) {
  return text(value).toLowerCase()
}

function moneyNumber(value: any) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function pickTitle(item: any, source: string) {
  if (source === 'ai_title') return text(item.ai_title || item.final_title || item.basic_title || item.sku)
  if (source === 'basic_title') return text(item.basic_title || item.final_title || item.ai_title || item.sku)
  return text(item.final_title || item.ai_title || item.basic_title || item.sku)
}

function pickDescriptionDisplayTitle(item: any) {
  return [item.brand, item.sub_category, item.reporting_category]
    .map(text)
    .filter(Boolean)
    .filter((part, index, parts) => parts.findIndex((candidate) => normalise(candidate) === normalise(part)) === index)
    .join(' ')
}

function pickDescription(item: any, source: string) {
  if (source === 'ai_description') {
    return text(item.ai_description || item.final_description || item.basic_description)
  }

  return text(item.final_description || item.ai_description || item.basic_description)
}

function pickImages(item: any, source: string, maxImages: number) {
  const images = Array.isArray(item.item_images) ? item.item_images : []

  return images
    .slice()
    .sort((a: any, b: any) => Number(a.image_order || 0) - Number(b.image_order || 0))
    .map((image: any) => {
      if (source === 'original_images') return text(image.original_url || image.processed_url)
      return text(image.processed_url || image.original_url)
    })
    .filter(Boolean)
    .slice(0, Math.max(1, maxImages || 24))
}

function fieldValue(item: any, fieldOrValue: string) {
  const key = text(fieldOrValue)
  const lowerKey = key.toLowerCase()

  if (!key) return ''
  if (lowerKey.startsWith('fixed:')) return key.slice(6).trim()

  const aliases: Record<string, any> = {
    brand: item.brand,
    type: item.sub_category || item.reporting_category,
    category: item.reporting_category,
    reporting_category: item.reporting_category,
    sub_category: item.sub_category,
    sub_type: item.sub_category,
    size: item.tagged_size,
    tagged_size: item.tagged_size,
    colour: item.colour_primary || item.colour_secondary,
    color: item.colour_primary || item.colour_secondary,
    colour_primary: item.colour_primary,
    colour_secondary: item.colour_secondary,
    department: item.gender,
    gender: item.gender,
    material: item.material,
    'outer shell material': item.material,
    fabric: item.material,
    style: item.style,
    era: item.era,
    condition: item.condition,
    flaws: item.flaws,
    pit_to_pit_in: item.pit_to_pit_in,
    collar_to_hem_in: item.collar_to_hem_in,
    pit_to_cuff_in: item.pit_to_cuff_in,
    sleeve_in: item.sleeve_in,
    waist_in: item.waist_in,
    inside_leg_in: item.inside_leg_in,
    rise_in: item.rise_in,
    hem_width_in: item.hem_width_in,
  }

  if (Object.prototype.hasOwnProperty.call(aliases, lowerKey)) return text(aliases[lowerKey])
  if (Object.prototype.hasOwnProperty.call(item, key)) return text(item[key])

  return key
}

function findConditionMapping(condition: string, mappings: any[]) {
  const key = normalise(condition)
  if (!key) return null

  return (mappings || []).find((mapping) => normalise(mapping?.app_condition) === key) || null
}

function addCheck(checks: Check[], key: string, ok: boolean, label: string, message: string) {
  checks.push({ key, ok, label, message })
}

export async function GET(request: NextRequest) {
  try {
    const sku = text(request.nextUrl.searchParams.get('sku'))
    const explicitCategoryId = text(request.nextUrl.searchParams.get('category_id'))

    if (!sku) {
      return NextResponse.json({ ok: false, message: 'Missing sku.' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const config = await getEbayIntegrationConfig(supabase)
    const { data: item, error } = await supabase
      .from('items')
      .select(
        `id, sku, barcode_number, status, brand, reporting_category, sub_category, sub_type, item_type, gender,
        tagged_size, colour_primary, colour_secondary, condition, material, era, style, flaws,
        pit_to_pit_in, collar_to_hem_in, pit_to_cuff_in, sleeve_in, waist_in, inside_leg_in, rise_in, hem_width_in,
        basic_title, ai_title, final_title, basic_description, ai_description, final_description,
        selling_price, stock_level, ebay_category_id, ebay_category_name,
        item_images(id, original_url, processed_url, image_order)`
      )
      .eq('sku', sku)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (!item) return NextResponse.json({ ok: false, message: `No item found for SKU ${sku}.` }, { status: 404 })

    const mapping = findBestEbayCategoryMapping(item, config.settings.category_mappings)
    const categoryId = explicitCategoryId || text(item.ebay_category_id) || text(mapping?.ebay_category_id)
    const checks: Check[] = []
    const title = pickTitle(item, config.settings.title_source)
    const descriptionDisplayTitle = pickDescriptionDisplayTitle(item)
    const description = pickDescription(item, config.settings.description_source)
    const conditionValue = text(item.condition || mapping?.default_condition)
    const conditionMapping = findConditionMapping(conditionValue, config.settings.condition_mappings)
    const ebayCondition = text(conditionMapping?.ebay_condition)
    const imageUrls = pickImages(item, config.settings.image_source, config.settings.max_images)
    const price = moneyNumber(item.selling_price)
    const quantity =
      config.settings.quantity_source === 'one_per_listing'
        ? Math.min(1, Math.max(0, Number(item.stock_level || 0)))
        : Math.max(0, Number(item.stock_level || 0))

    addCheck(checks, 'title', Boolean(title), 'Title', title ? title : 'Missing title.')
    addCheck(checks, 'description', Boolean(description), 'Description', description ? 'Description present.' : 'Missing description.')
    addCheck(checks, 'price', price > 0, 'Price', price > 0 ? `GBP ${price.toFixed(2)}` : 'Missing sale price.')
    addCheck(checks, 'quantity', quantity > 0, 'Quantity', quantity > 0 ? `${quantity} available.` : 'No available stock.')
    addCheck(checks, 'images', imageUrls.length > 0, 'Images', imageUrls.length > 0 ? `${imageUrls.length} image(s).` : 'No listing images.')
    addCheck(
      checks,
      'category',
      Boolean(categoryId),
      'eBay category',
      categoryId ? `Category ${categoryId}.` : 'No eBay category mapping or item category ID.'
    )

    let categoryMetadata: any = null
    let requiredAspects: any[] = []
    let conditionPolicies: any[] = []
    const aspectValues: Record<string, string> = {}
    const requiredAspectNames = new Set<string>()

    if (categoryId) {
      const categoryTreeId = await getDefaultCategoryTreeId(config.settings)
      const [aspects, conditions] = await Promise.all([
        ebayRequest(
          config.settings,
          `/commerce/taxonomy/v1/category_tree/${encodeURIComponent(
            categoryTreeId
          )}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`
        ),
        ebayRequest(
          config.settings,
          `/sell/metadata/v1/marketplace/${encodeURIComponent(
            config.settings.marketplace_id
          )}/get_item_condition_policies?filter=categoryIds:{${encodeURIComponent(categoryId)}}`
        ).catch((conditionError: any) => ({ itemConditionPolicies: [], warning: conditionError.message })),
      ])

      requiredAspects = (aspects?.aspects || []).filter(
        (aspect: any) => aspect?.aspectConstraint?.aspectRequired
      )
      conditionPolicies = conditions?.itemConditionPolicies || []
      categoryMetadata = {
        category_tree_id: categoryTreeId,
        aspect_count: aspects?.aspects?.length || 0,
        required_aspect_count: requiredAspects.length,
        condition_warning: conditions?.warning || null,
      }

      for (const aspect of requiredAspects) {
        const aspectName = text(aspect.localizedAspectName)
        requiredAspectNames.add(aspectName)
        const mappedField = text(mapping?.aspect_mapping?.[aspectName])
        const value = fieldValue(item, mappedField || aspectName)

        aspectValues[aspectName] = value
        addCheck(
          checks,
          `aspect:${aspectName}`,
          Boolean(value),
          aspectName,
          value ? value : `Missing required eBay item specific: ${aspectName}.`
        )
      }
    }

    for (const [aspectName, mappedField] of Object.entries(mapping?.aspect_mapping || {})) {
      if (requiredAspectNames.has(aspectName)) continue

      const value = fieldValue(item, mappedField)
      if (value) aspectValues[aspectName] = value
    }

    for (const optionalAspect of config.settings.optional_aspect_mapping || []) {
      if (!optionalAspect?.enabled) continue

      const aspectName = text(optionalAspect.ebay_aspect_name)
      const value = fieldValue(item, optionalAspect.app_field)
      if (aspectName && value && !aspectValues[aspectName]) {
        aspectValues[aspectName] = value
      }
    }

    if (!aspectValues.Condition && conditionValue) {
      aspectValues.Condition = conditionValue
    }

    if (config.settings.require_condition_validation) {
      addCheck(
        checks,
        'condition',
        Boolean(conditionValue && ebayCondition),
        'Condition',
        conditionValue
          ? ebayCondition
            ? `${conditionValue} maps to ${ebayCondition}.`
            : `Condition "${conditionValue}" is not mapped in eBay settings.`
          : 'Missing item condition.'
      )
    }

    const missing = checks.filter((check) => !check.ok)
    const descriptionHtml = buildEbayDescriptionHtml({
      title,
      description,
      displayTitle: descriptionDisplayTitle,
      aspects: aspectValues,
    })

    return NextResponse.json({
      ok: true,
      ready: missing.length === 0,
      sku,
      item: {
        id: item.id,
        sku: item.sku,
        brand: item.brand,
        reporting_category: item.reporting_category,
        sub_category: item.sub_category,
        status: item.status,
      },
      mapping: mapping || null,
      category_id: categoryId || null,
      category_metadata: categoryMetadata,
      listing_draft: {
        sku: item.sku,
        title,
        description,
        description_html: descriptionHtml,
        price,
        quantity,
        image_count: imageUrls.length,
        image_urls: imageUrls,
        aspects: aspectValues,
        condition: text(item.condition || mapping?.default_condition),
        ebay_condition: ebayCondition || null,
        policies: {
          payment_policy_id: config.settings.payment_policy_id || null,
          fulfillment_policy_id: config.settings.fulfillment_policy_id || null,
          return_policy_id: config.settings.return_policy_id || null,
        },
      },
      checks,
      missing,
      condition_policies: conditionPolicies,
    })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'Could not build eBay listing readiness preview.' },
      { status: 500 }
    )
  }
}

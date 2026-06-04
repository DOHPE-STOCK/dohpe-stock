export type EbayCategoryMapping = {
  app_category: string
  app_sub_category: string
  item_type?: string
  gender?: string
  ebay_category_id: string
  ebay_category_name: string
  default_condition: string
  aspect_mapping: Record<string, string>
}

export type EbayOptionalAspectMapping = {
  enabled: boolean
  ebay_aspect_name: string
  app_field: string
}

export type EbayConditionMapping = {
  app_condition: string
  ebay_condition: string
}

export type EbaySettings = {
  marketplace_id: string
  locale: string
  environment: 'production' | 'sandbox'
  listing_mode: 'direct_shadow_only' | 'direct_publish'
  order_mode: 'linnworks_live_shadow_direct' | 'direct_shadow_only' | 'direct_orders'
  inventory_location_key: string
  listing_format: 'FIXED_PRICE' | 'AUCTION'
  merchant_location_key: string
  payment_policy_id: string
  fulfillment_policy_id: string
  return_policy_id: string
  use_business_policies: boolean
  require_aspect_validation: boolean
  require_condition_validation: boolean
  require_image_validation: boolean
  image_source: 'processed_images' | 'original_images'
  max_images: number
  title_source: 'final_title' | 'ai_title' | 'basic_title'
  description_source: 'final_description' | 'ai_description'
  quantity_source: 'available_stock' | 'one_per_listing'
  default_quantity: number
  price_source: 'selling_price' | 'manual'
  use_linnworks_for_live_listing: boolean
  shadow_compare_with_linnworks: boolean
  oauth_refresh_token?: string
  category_mappings: EbayCategoryMapping[]
  condition_mappings: EbayConditionMapping[]
  optional_aspect_mapping: EbayOptionalAspectMapping[]
  field_mapping: Record<string, string>
}

export type EbayIntegrationConfig = {
  id: string | null
  enabled: boolean
  auto_sync: boolean
  connection_status: string
  settings: EbaySettings
}

const clothingAspectMapping = {
  Brand: 'brand',
  Type: 'sub_category',
  Size: 'tagged_size',
  Colour: 'colour_primary',
  Department: 'gender',
  Style: 'style',
  Material: 'material',
  'Outer Shell Material': 'material',
}

const footwearAspectMapping = {
  Brand: 'brand',
  Type: 'sub_category',
  'UK Shoe Size': 'tagged_size',
  Colour: 'colour_primary',
  Department: 'gender',
  Style: 'style',
  'Upper Material': 'material',
}

const accessoryAspectMapping = {
  Brand: 'brand',
  Type: 'sub_category',
  Colour: 'colour_primary',
  Department: 'gender',
  Style: 'style',
  Material: 'material',
}

function categoryMapping(params: {
  app_category: string
  app_sub_category?: string
  item_type?: string
  gender?: string
  ebay_category_id: string
  ebay_category_name: string
  aspect_mapping?: Record<string, string>
}): EbayCategoryMapping {
  return {
    app_category: params.app_category,
    app_sub_category: params.app_sub_category || '',
    item_type: params.item_type || '',
    gender: params.gender || '',
    ebay_category_id: params.ebay_category_id,
    ebay_category_name: params.ebay_category_name,
    default_condition: 'Excellent',
    aspect_mapping: params.aspect_mapping || clothingAspectMapping,
  }
}

export const DEFAULT_EBAY_CATEGORY_MAPPINGS: EbayCategoryMapping[] = [
  categoryMapping({ app_category: 'Jacket', item_type: 'Clothing', ebay_category_id: '175771', ebay_category_name: "Men's Vintage Clothing > Coats & Jackets" }),
  categoryMapping({ app_category: 'Workwear Jacket', item_type: 'Clothing', ebay_category_id: '175771', ebay_category_name: "Men's Vintage Clothing > Coats & Jackets" }),
  categoryMapping({ app_category: 'Coat', item_type: 'Clothing', ebay_category_id: '175771', ebay_category_name: "Men's Vintage Clothing > Coats & Jackets" }),
  categoryMapping({ app_category: 'Fleece', item_type: 'Clothing', ebay_category_id: '175778', ebay_category_name: "Men's Vintage Clothing > Sweats & Tracksuits" }),
  categoryMapping({ app_category: 'Hoodie', item_type: 'Clothing', ebay_category_id: '175778', ebay_category_name: "Men's Vintage Clothing > Sweats & Tracksuits" }),
  categoryMapping({ app_category: 'Sweatshirt', item_type: 'Clothing', ebay_category_id: '175778', ebay_category_name: "Men's Vintage Clothing > Sweats & Tracksuits" }),
  categoryMapping({ app_category: 'Tracksuit Bottoms', item_type: 'Clothing', ebay_category_id: '175778', ebay_category_name: "Men's Vintage Clothing > Sweats & Tracksuits" }),
  categoryMapping({ app_category: 'Shirt', item_type: 'Clothing', ebay_category_id: '175770', ebay_category_name: "Men's Vintage Clothing > Casual Shirts & Tops" }),
  categoryMapping({ app_category: 'Polo Shirt', item_type: 'Clothing', ebay_category_id: '175770', ebay_category_name: "Men's Vintage Clothing > Casual Shirts & Tops" }),
  categoryMapping({ app_category: 'Rugby Shirt', item_type: 'Clothing', ebay_category_id: '175770', ebay_category_name: "Men's Vintage Clothing > Casual Shirts & Tops" }),
  categoryMapping({ app_category: 'Football Shirt', item_type: 'Clothing', ebay_category_id: '175770', ebay_category_name: "Men's Vintage Clothing > Casual Shirts & Tops" }),
  categoryMapping({ app_category: 'T-Shirt', item_type: 'Clothing', ebay_category_id: '175781', ebay_category_name: "Men's Vintage Clothing > T-Shirts" }),
  categoryMapping({ app_category: 'Long Sleeve T-Shirt', item_type: 'Clothing', ebay_category_id: '175781', ebay_category_name: "Men's Vintage Clothing > T-Shirts" }),
  categoryMapping({ app_category: 'Tank Top', item_type: 'Clothing', ebay_category_id: '175781', ebay_category_name: "Men's Vintage Clothing > T-Shirts" }),
  categoryMapping({ app_category: 'Jeans', item_type: 'Clothing', ebay_category_id: '175773', ebay_category_name: "Men's Vintage Clothing > Jeans" }),
  categoryMapping({ app_category: 'Trousers', item_type: 'Clothing', ebay_category_id: '175780', ebay_category_name: "Men's Vintage Clothing > Trousers" }),
  categoryMapping({ app_category: 'Cargo Trousers', item_type: 'Clothing', ebay_category_id: '175780', ebay_category_name: "Men's Vintage Clothing > Trousers" }),
  categoryMapping({ app_category: 'Shorts', item_type: 'Clothing', ebay_category_id: '175776', ebay_category_name: "Men's Vintage Clothing > Shorts" }),
  categoryMapping({ app_category: 'Jorts', item_type: 'Clothing', ebay_category_id: '175776', ebay_category_name: "Men's Vintage Clothing > Shorts" }),
  categoryMapping({ app_category: 'Knitwear', item_type: 'Clothing', ebay_category_id: '175774', ebay_category_name: "Men's Vintage Clothing > Jumpers & Cardigans" }),
  categoryMapping({ app_category: 'Cardigan', item_type: 'Clothing', ebay_category_id: '175774', ebay_category_name: "Men's Vintage Clothing > Jumpers & Cardigans" }),
  categoryMapping({ app_category: 'Waistcoat', item_type: 'Clothing', ebay_category_id: '175782', ebay_category_name: "Men's Vintage Clothing > Waistcoats" }),
  categoryMapping({ app_category: 'Blazer', item_type: 'Clothing', ebay_category_id: '182046', ebay_category_name: "Men's Vintage Clothing > Suit Jackets & Blazers" }),
  categoryMapping({ app_category: 'Suiting', item_type: 'Clothing', ebay_category_id: '175777', ebay_category_name: "Men's Vintage Clothing > Suits" }),
  categoryMapping({ app_category: 'Dress', item_type: 'Clothing', gender: 'Women', ebay_category_id: '175784', ebay_category_name: "Women's Vintage Clothing > Dresses" }),
  categoryMapping({ app_category: 'Skirt', item_type: 'Clothing', gender: 'Women', ebay_category_id: '175791', ebay_category_name: "Women's Vintage Clothing > Skirts" }),
  categoryMapping({ app_category: 'Dungarees', item_type: 'Clothing', gender: 'Women', ebay_category_id: '175787', ebay_category_name: "Women's Vintage Clothing > Jumpsuits & Playsuits" }),
  categoryMapping({ app_category: 'Boiler Suit', item_type: 'Clothing', gender: 'Women', ebay_category_id: '175787', ebay_category_name: "Women's Vintage Clothing > Jumpsuits & Playsuits" }),
  categoryMapping({ app_category: 'Overalls', item_type: 'Clothing', gender: 'Women', ebay_category_id: '175787', ebay_category_name: "Women's Vintage Clothing > Jumpsuits & Playsuits" }),
  categoryMapping({ app_category: 'Swimwear', item_type: 'Clothing', ebay_category_id: '175779', ebay_category_name: "Men's Vintage Clothing > Swimwear" }),
  categoryMapping({ app_category: 'Pyjama Shirt', item_type: 'Clothing', ebay_category_id: '175775', ebay_category_name: "Men's Vintage Clothing > Nightwear & Robes" }),
  categoryMapping({ app_category: 'Pyjama Bottoms', item_type: 'Clothing', ebay_category_id: '175775', ebay_category_name: "Men's Vintage Clothing > Nightwear & Robes" }),
  categoryMapping({ app_category: 'Bag', item_type: 'Accessories', ebay_category_id: '74962', ebay_category_name: 'Vintage Accessories > Bags, Handbags & Cases', aspect_mapping: accessoryAspectMapping }),
  categoryMapping({ app_category: 'Belt', item_type: 'Accessories', ebay_category_id: '163601', ebay_category_name: 'Vintage Accessories > Belts', aspect_mapping: accessoryAspectMapping }),
  categoryMapping({ app_category: 'Hat', item_type: 'Accessories', ebay_category_id: '163619', ebay_category_name: "Vintage Accessories > Hats, Men's", aspect_mapping: accessoryAspectMapping }),
  categoryMapping({ app_category: 'Cap', item_type: 'Accessories', ebay_category_id: '163619', ebay_category_name: "Vintage Accessories > Hats, Men's", aspect_mapping: accessoryAspectMapping }),
  categoryMapping({ app_category: 'Beanie', item_type: 'Accessories', ebay_category_id: '163619', ebay_category_name: "Vintage Accessories > Hats, Men's", aspect_mapping: accessoryAspectMapping }),
  categoryMapping({ app_category: 'Scarf', item_type: 'Accessories', ebay_category_id: '175807', ebay_category_name: 'Vintage Accessories > Scarves & Shawls', aspect_mapping: accessoryAspectMapping }),
  categoryMapping({ app_category: 'Tie', item_type: 'Accessories', ebay_category_id: '14070', ebay_category_name: 'Vintage Accessories > Ties, Bow Ties & Cravats', aspect_mapping: accessoryAspectMapping }),
  categoryMapping({ app_category: 'Sunglasses', item_type: 'Accessories', ebay_category_id: '48559', ebay_category_name: 'Vintage Accessories > Sunglasses', aspect_mapping: accessoryAspectMapping }),
  categoryMapping({ app_category: 'Boots', item_type: 'Footwear', ebay_category_id: '163628', ebay_category_name: "Men's Vintage Shoes", aspect_mapping: footwearAspectMapping }),
  categoryMapping({ app_category: 'Shoes', item_type: 'Footwear', ebay_category_id: '163628', ebay_category_name: "Men's Vintage Shoes", aspect_mapping: footwearAspectMapping }),
  categoryMapping({ app_category: 'Trainers', item_type: 'Footwear', ebay_category_id: '163628', ebay_category_name: "Men's Vintage Shoes", aspect_mapping: footwearAspectMapping }),
]

export const DEFAULT_EBAY_SETTINGS: EbaySettings = {
  marketplace_id: 'EBAY_GB',
  locale: 'en-GB',
  environment: 'production',
  listing_mode: 'direct_shadow_only',
  order_mode: 'linnworks_live_shadow_direct',
  inventory_location_key: 'LOCATION-1',
  listing_format: 'FIXED_PRICE',
  merchant_location_key: 'default',
  payment_policy_id: '',
  fulfillment_policy_id: '',
  return_policy_id: '',
  use_business_policies: true,
  require_aspect_validation: true,
  require_condition_validation: true,
  require_image_validation: true,
  image_source: 'processed_images',
  max_images: 24,
  title_source: 'final_title',
  description_source: 'ai_description',
  quantity_source: 'available_stock',
  default_quantity: 1,
  price_source: 'selling_price',
  use_linnworks_for_live_listing: false,
  shadow_compare_with_linnworks: false,
  category_mappings: DEFAULT_EBAY_CATEGORY_MAPPINGS,
  condition_mappings: [
    { app_condition: 'New with tags', ebay_condition: 'NEW' },
    { app_condition: 'New without tags', ebay_condition: 'NEW_OTHER' },
    { app_condition: 'Excellent', ebay_condition: 'PRE_OWNED_EXCELLENT' },
    { app_condition: 'Good', ebay_condition: 'PRE_OWNED_GOOD' },
    { app_condition: 'Fair', ebay_condition: 'PRE_OWNED_FAIR' },
  ],
  optional_aspect_mapping: [
    { enabled: true, ebay_aspect_name: 'Pit to Pit', app_field: 'pit_to_pit_in' },
    { enabled: true, ebay_aspect_name: 'Collar to Hem', app_field: 'collar_to_hem_in' },
    { enabled: true, ebay_aspect_name: 'Pit to Cuff', app_field: 'pit_to_cuff_in' },
    { enabled: true, ebay_aspect_name: 'Sleeve Length', app_field: 'sleeve_in' },
    { enabled: true, ebay_aspect_name: 'Waist', app_field: 'waist_in' },
    { enabled: true, ebay_aspect_name: 'Inside Leg', app_field: 'inside_leg_in' },
    { enabled: true, ebay_aspect_name: 'Rise', app_field: 'rise_in' },
    { enabled: true, ebay_aspect_name: 'Hem Width', app_field: 'hem_width_in' },
    { enabled: true, ebay_aspect_name: 'Era', app_field: 'era' },
    { enabled: true, ebay_aspect_name: 'Secondary Colour', app_field: 'colour_secondary' },
    { enabled: true, ebay_aspect_name: 'Flaws', app_field: 'flaws' },
  ],
  field_mapping: {
    sku: 'sku',
    final_title: 'product.title',
    final_description: 'product.description',
    selling_price: 'pricingSummary.price.value',
    reporting_category: 'categoryId',
    sub_category: 'categoryId',
    condition: 'condition',
    item_images: 'product.imageUrls',
    stock_level: 'availability.shipToLocationAvailability.quantity',
  },
}

function normalise(value: any) {
  return String(value || '').trim().toLowerCase()
}

function mappingKey(mapping: EbayCategoryMapping) {
  return [
    normalise(mapping.app_category),
    normalise(mapping.app_sub_category),
    normalise(mapping.item_type),
    normalise(mapping.gender),
  ].join('|')
}

export function findBestEbayCategoryMapping(item: any, mappings: EbayCategoryMapping[] = []) {
  const itemCategory = normalise(item?.reporting_category)
  const itemSubCategory = normalise(item?.sub_category)
  const itemType = normalise(item?.item_type)
  const gender = normalise(item?.gender)

  const candidates = mappings
    .map((mapping) => {
      if (!normalise(mapping?.ebay_category_id)) return null
      if (normalise(mapping.app_category) !== itemCategory) return null

      const mappingSubCategory = normalise(mapping.app_sub_category)
      const mappingItemType = normalise(mapping.item_type)
      const mappingGender = normalise(mapping.gender)

      if (mappingSubCategory && mappingSubCategory !== itemSubCategory) return null
      if (mappingItemType && itemType && mappingItemType !== itemType) return null
      if (mappingGender && gender && mappingGender !== gender) return null
      if (mappingGender && !gender) return null

      let score = 1
      if (mappingSubCategory) score += 4
      if (mappingItemType && mappingItemType === itemType) score += 2
      if (mappingGender && mappingGender === gender) score += 3

      return { mapping, score }
    })
    .filter(Boolean) as Array<{ mapping: EbayCategoryMapping; score: number }>

  return candidates.sort((a, b) => b.score - a.score)[0]?.mapping || null
}

export function mergeEbaySettings(settings: any): EbaySettings {
  const listingMode =
    settings?.listing_mode === 'direct_publish' ? 'direct_publish' : 'direct_shadow_only'
  const clothingConditionDefaults = new Map(
    DEFAULT_EBAY_SETTINGS.condition_mappings.map((mapping) => [
      mapping.app_condition.toLowerCase(),
      mapping.ebay_condition,
    ])
  )
  const conditionMappings = Array.isArray(settings?.condition_mappings)
    ? settings.condition_mappings.map((mapping: EbayConditionMapping) => {
        const appCondition = String(mapping?.app_condition || '').trim()
        const clothingCondition = clothingConditionDefaults.get(appCondition.toLowerCase())

        return clothingCondition
          ? { ...mapping, app_condition: appCondition, ebay_condition: clothingCondition }
          : mapping
      })
    : []
  const mergedConditionMappings = [
    ...conditionMappings,
    ...DEFAULT_EBAY_SETTINGS.condition_mappings.filter(
      (defaultMapping) =>
        !conditionMappings.some(
          (mapping: EbayConditionMapping) =>
            String(mapping?.app_condition || '').trim().toLowerCase() ===
            defaultMapping.app_condition.toLowerCase()
        )
    ),
  ]

  const categoryMappings = Array.isArray(settings?.category_mappings)
    ? settings.category_mappings
    : []
  const mergedCategoryMappings = [
    ...categoryMappings,
    ...DEFAULT_EBAY_CATEGORY_MAPPINGS.filter(
      (defaultMapping) =>
        !categoryMappings.some(
          (mapping: EbayCategoryMapping) => mappingKey(mapping) === mappingKey(defaultMapping)
        )
    ),
  ]

  return {
    ...DEFAULT_EBAY_SETTINGS,
    ...(settings || {}),
    marketplace_id: settings?.marketplace_id || 'EBAY_GB',
    locale: settings?.locale || 'en-GB',
    environment: settings?.environment === 'sandbox' ? 'sandbox' : 'production',
    listing_mode: listingMode,
    category_mappings: mergedCategoryMappings,
    condition_mappings: mergedConditionMappings,
    optional_aspect_mapping: Array.isArray(settings?.optional_aspect_mapping)
      ? settings.optional_aspect_mapping
      : DEFAULT_EBAY_SETTINGS.optional_aspect_mapping,
    field_mapping: {
      ...DEFAULT_EBAY_SETTINGS.field_mapping,
      ...(settings?.field_mapping || {}),
    },
  }
}

export async function getEbayIntegrationConfig(supabase: any): Promise<EbayIntegrationConfig> {
  const { data, error } = await supabase
    .from('integration_settings')
    .select('id, enabled, auto_sync, connection_status, settings')
    .eq('channel', 'ebay')
    .maybeSingle()

  if (error) throw new Error(error.message)

  return {
    id: data?.id || null,
    enabled: Boolean(data?.enabled),
    auto_sync: Boolean(data?.auto_sync),
    connection_status: data?.connection_status || 'not_configured',
    settings: mergeEbaySettings(data?.settings || {}),
  }
}

export function shouldRunEbayRoute(params: {
  config: EbayIntegrationConfig
  manual?: boolean
  route: 'test_connection' | 'policies' | 'metadata' | 'shadow_listing' | 'shadow_orders' | 'direct_publish' | 'direct_orders'
}) {
  const { config, manual = false, route } = params

  if (route === 'test_connection' || route === 'metadata') return { ok: true }

  if (!config.enabled) {
    return { ok: false, status: 200, reason: 'eBay integration is disabled in Settings.' }
  }

  if (!manual && !config.auto_sync) {
    return { ok: false, status: 200, reason: 'eBay auto-sync is disabled in Settings.' }
  }

  if (route === 'direct_publish' && config.settings.listing_mode !== 'direct_publish') {
    return { ok: false, status: 200, reason: 'Direct eBay publishing is not enabled.' }
  }

  if (route === 'direct_orders' && config.settings.order_mode !== 'direct_orders') {
    return { ok: false, status: 200, reason: 'Direct eBay order management is not enabled.' }
  }

  return { ok: true }
}

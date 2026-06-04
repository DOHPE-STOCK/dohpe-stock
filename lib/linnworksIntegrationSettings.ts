export type LinnworksSettings = {
  mode: string
  sync_direction: string
  channel_strategy: string
  default_location: string
  default_binrack: string
  app_managed_identifier_enabled: boolean
  managed_identifier_name: string
  managed_identifier_value: string
  use_app_bins_for_binrack: boolean
  unknown_bin: string
  in_transit_bin: string
  use_app_for_transfers: boolean
  require_manual_export_first: boolean
  only_sync_app_managed_items: boolean
  create_missing_stock_items: boolean
  update_existing_stock_items: boolean
  sync_stock_levels_two_way: boolean
  sync_price_app_to_linnworks: boolean
  sync_location_app_to_linnworks: boolean
  sync_binrack_app_to_linnworks: boolean
  sync_title_app_to_linnworks: boolean
  sync_description_app_to_linnworks: boolean
  sync_category_app_to_linnworks: boolean
  sync_images_app_to_linnworks: boolean
  location_mapping: Record<string, string>
  field_mapping: Record<string, string>
}

export type LinnworksIntegrationConfig = {
  id: string | null
  enabled: boolean
  auto_sync: boolean
  connection_status: string
  settings: LinnworksSettings
}

export const DEFAULT_LINNWORKS_SETTINGS: LinnworksSettings = {
  mode: 'manual_export_then_auto_sync',
  sync_direction: 'controlled_two_way',
  channel_strategy: 'linnworks_inventory_first_ebay_via_linnworks',
  default_location: 'Default',
  default_binrack: 'Default',
  app_managed_identifier_enabled: true,
  managed_identifier_name: 'dohpe_app_managed',
  managed_identifier_value: 'true',
  use_app_bins_for_binrack: true,
  unknown_bin: 'Unknown',
  in_transit_bin: 'In Transit',
  use_app_for_transfers: true,
  require_manual_export_first: true,
  only_sync_app_managed_items: true,
  create_missing_stock_items: true,
  update_existing_stock_items: true,
  sync_stock_levels_two_way: true,
  sync_price_app_to_linnworks: true,
  sync_location_app_to_linnworks: true,
  sync_binrack_app_to_linnworks: true,
  sync_title_app_to_linnworks: true,
  sync_description_app_to_linnworks: true,
  sync_category_app_to_linnworks: true,
  sync_images_app_to_linnworks: true,
  location_mapping: {
    'LOCATION-1': 'Default',
    'LOCATION-2': 'SHOP-1',
    'LOCATION-3': 'SHOP-2',
    'LOCATION-4': 'SHOP-3',
    'LOCATION-5': 'SHOP-4',
    WAREHOUSE: 'Default',
    DEFAULT: 'Default',
  },
  field_mapping: {
    sku: 'SKU',
    final_title: 'Title',
    final_description: 'Description',
    selling_price: 'RetailPrice',
    cost_price: 'PurchasePrice',
    stock_level: 'StockLevel',
    current_location: 'Location',
    current_bin: 'BinRack',
    weight_grams: 'Weight',
    reporting_category: 'Category',
    item_images: 'Images',
  },
}

export function mergeLinnworksSettings(settings: any): LinnworksSettings {
  return {
    ...DEFAULT_LINNWORKS_SETTINGS,
    ...(settings || {}),
    default_location: settings?.default_location || settings?.warehouse_location || DEFAULT_LINNWORKS_SETTINGS.default_location,
    default_binrack: settings?.default_binrack || settings?.default_bin || DEFAULT_LINNWORKS_SETTINGS.default_binrack,
    field_mapping: {
      ...DEFAULT_LINNWORKS_SETTINGS.field_mapping,
      ...(settings?.field_mapping || {}),
    },
    location_mapping: {
      ...DEFAULT_LINNWORKS_SETTINGS.location_mapping,
      ...(settings?.location_mapping || settings?.location_mappings || {}),
    },
  }
}

export async function getLinnworksIntegrationConfig(supabase: any): Promise<LinnworksIntegrationConfig> {
  const { data, error } = await supabase
    .from('integration_settings')
    .select('id, enabled, auto_sync, connection_status, settings')
    .eq('channel', 'linnworks')
    .maybeSingle()

  if (error) throw new Error(error.message)

  return {
    id: data?.id || null,
    enabled: Boolean(data?.enabled),
    auto_sync: Boolean(data?.auto_sync),
    connection_status: data?.connection_status || 'not_configured',
    settings: mergeLinnworksSettings(data?.settings || {}),
  }
}

export function shouldRunLinnworksRoute(params: {
  config: LinnworksIntegrationConfig
  manual?: boolean
  route: 'process_queue' | 'stock_poll' | 'open_orders' | 'processed_orders' | 'manual_export' | 'test_connection'
}) {
  const { config, manual = false, route } = params

  if (route === 'test_connection') return { ok: true }

  if (!config.enabled) {
    return { ok: false, status: 200, reason: 'Linnworks integration is disabled in Settings.' }
  }

  if (!manual && !config.auto_sync) {
    return { ok: false, status: 200, reason: 'Linnworks auto-sync is disabled in Settings.' }
  }

  if (route === 'stock_poll' && !config.settings.sync_stock_levels_two_way) {
    return { ok: false, status: 200, reason: 'Linnworks stock level two-way sync is disabled.' }
  }

  if ((route === 'open_orders' || route === 'processed_orders') && !config.settings.use_app_for_transfers) {
    return { ok: false, status: 200, reason: 'App-managed Linnworks order/transfer handling is disabled.' }
  }

  return { ok: true }
}

export function mapAppLocationToLinnworksLocation(appLocation: string, settings: LinnworksSettings) {
  const clean = String(appLocation || '').trim()
  const key = clean.toUpperCase()
  if (!clean) return settings.default_location || 'Default'
  return settings.location_mapping[key] || settings.location_mapping[clean] || clean
}

export function mapLinnworksLocationToAppLocation(linnworksLocation: string, settings: LinnworksSettings) {
  const clean = String(linnworksLocation || '').trim()
  const key = clean.toUpperCase()

  if (!clean || key === 'DEFAULT' || key === 'WAREHOUSE') {
    const warehouse = Object.entries(settings.location_mapping).find(([, mapped]) => {
      const mappedKey = String(mapped || '').trim().toUpperCase()
      return mappedKey === 'DEFAULT' || mappedKey === 'WAREHOUSE'
    })
    return warehouse?.[0] || 'LOCATION-1'
  }

  const match = Object.entries(settings.location_mapping).find(([appLocation, mapped]) => {
    return appLocation.toUpperCase() === key || String(mapped || '').trim().toUpperCase() === key
  })

  return match?.[0] || clean
}

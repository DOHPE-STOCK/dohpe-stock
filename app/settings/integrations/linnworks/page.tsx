'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { useCompany } from '@/app/context/CompanyContext'

type LinnworksSettings = {
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

type IntegrationSetting = {
  id: string
  channel: string
  enabled: boolean
  auto_sync: boolean
  connection_status: string
  settings: LinnworksSettings | any
  last_synced_at: string | null
  last_error: string | null
}

type LocationRow = {
  name: string
  label: string | null
  is_active: boolean
  bin_mode: 'basic' | 'range' | null
  basic_bins: string[] | null
}

const defaultSettings: LinnworksSettings = {
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

const LOCATION_ORDER = ['LOCATION-1', 'LOCATION-2', 'LOCATION-3', 'LOCATION-4', 'LOCATION-5']

const fallbackLocations: LocationRow[] = [
  { name: 'LOCATION-1', label: 'WAREHOUSE', is_active: true, bin_mode: 'range', basic_bins: ['Default'] },
  { name: 'LOCATION-2', label: 'SHOP-1', is_active: true, bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
  { name: 'LOCATION-3', label: 'SHOP-2', is_active: true, bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
  { name: 'LOCATION-4', label: 'SHOP-3', is_active: true, bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
  { name: 'LOCATION-5', label: 'SHOP-4', is_active: true, bin_mode: 'basic', basic_bins: ['FLOOR', 'STOCK'] },
]

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function canonicalLocation(value: any) {
  return text(value).toUpperCase().replace(/[\s_]+/g, '-')
}

function mergeSettings(settings: any): LinnworksSettings {
  return {
    ...defaultSettings,
    ...(settings || {}),
    default_location:
      settings?.default_location ||
      settings?.warehouse_location ||
      defaultSettings.default_location,
    default_binrack:
      settings?.default_binrack ||
      settings?.default_bin ||
      defaultSettings.default_binrack,
    field_mapping: {
      ...defaultSettings.field_mapping,
      ...(settings?.field_mapping || {}),
    },
    location_mapping: {
      ...defaultSettings.location_mapping,
      ...(settings?.location_mapping || settings?.location_mappings || {}),
    },
  }
}

export default function LinnworksIntegrationPage() {
  const { activeCompanyId, schemaReady } = useCompany()
  const [integration, setIntegration] = useState<IntegrationSetting | null>(null)
  const [settings, setSettings] = useState<LinnworksSettings>(defaultSettings)
  const [locations, setLocations] = useState<LocationRow[]>(fallbackLocations)
  const [enabled, setEnabled] = useState(true)
  const [autoSync, setAutoSync] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    Promise.all([fetchIntegration(), fetchLocations()]).finally(() => setLoading(false))
  }, [activeCompanyId, schemaReady])

  const orderedLocations = useMemo(() => {
    const byName = new Map(locations.map((location) => [canonicalLocation(location.name), location]))

    const ordered = LOCATION_ORDER.map((name) => byName.get(name) || fallbackLocations.find((row) => row.name === name))
      .filter(Boolean) as LocationRow[]

    const extras = locations.filter((row) => !LOCATION_ORDER.includes(canonicalLocation(row.name)))

    return [...ordered, ...extras]
  }, [locations])

  useEffect(() => {
    if (!message) return

    const timer = window.setTimeout(() => {
      setMessage('')
    }, 6000)

    return () => window.clearTimeout(timer)
  }, [message])

  async function fetchIntegration() {
    setLoading(true)

    let query = supabase
      .from('integration_settings')
      .select('*')
      .eq('channel', 'linnworks')

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data, error } = await query.maybeSingle()

    if (error) {
      setMessage(error.message)
      return
    }

    if (!data) {
      setIntegration({
        id: '',
        channel: 'linnworks',
        enabled: false,
        auto_sync: false,
        connection_status: 'not_configured',
        settings: defaultSettings,
        last_synced_at: null,
        last_error: null,
      })
      setSettings(defaultSettings)
      setEnabled(false)
      setAutoSync(false)
      return
    }

    const merged = mergeSettings(data.settings)

    setIntegration(data as IntegrationSetting)
    setSettings(merged)
    setEnabled(Boolean(data.enabled))
    setAutoSync(Boolean(data.auto_sync))
  }

  async function fetchLocations() {
    let query = supabase
      .from('locations')
      .select('name, label, is_active, bin_mode, basic_bins')
      .eq('is_active', true)

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data, error } = await query

    if (!error && data && data.length > 0) {
      setLocations(data as LocationRow[])
    }
  }

  function displayLocation(location: LocationRow) {
    return text(location.label) || location.name
  }

  function updateSetting<K extends keyof LinnworksSettings>(
    key: K,
    value: LinnworksSettings[K]
  ) {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function updateFieldMapping(appField: string, linnworksField: string) {
    setSettings((current) => ({
      ...current,
      field_mapping: {
        ...current.field_mapping,
        [appField]: linnworksField,
      },
    }))
  }

  function updateLocationMapping(appLocation: string, linnworksLocation: string) {
    setSettings((current) => ({
      ...current,
      location_mapping: {
        ...current.location_mapping,
        [appLocation]: linnworksLocation,
      },
    }))
  }

  async function saveSettings() {
    if (!integration) return

    setSaving(true)

    const payload = {
      ...(schemaReady ? { company_id: activeCompanyId } : {}),
      channel: 'linnworks',
      enabled,
      auto_sync: autoSync,
      settings,
      updated_at: new Date().toISOString(),
    }

    const result = integration.id
      ? await supabase
          .from('integration_settings')
          .update({
            enabled,
            auto_sync: autoSync,
            settings,
            updated_at: new Date().toISOString(),
          })
          .eq('id', integration.id)
          .eq(schemaReady ? 'company_id' : 'id', schemaReady ? activeCompanyId : integration.id)
      : await supabase
          .from('integration_settings')
          .upsert(payload, { onConflict: schemaReady ? 'company_id,channel' : 'channel' })
          .select('*')
          .single()

    const error = result.error

    if (!error && (result as any).data) {
      setIntegration((result as any).data as IntegrationSetting)
    }

    if (error) {
      setMessage(error.message)
      setSaving(false)
      return
    }

    setMessage('Linnworks settings saved')
    setSaving(false)
  }

  async function testConnection() {
    setSaving(true)
    setMessage('Testing Linnworks connection...')

    try {
      const response = await fetch('/api/integrations/linnworks/test')
      const data = await response.json()

      if (!response.ok || !data.ok) {
        const reason =
          data?.message ||
          data?.details?.Message ||
          data?.details ||
          'Linnworks connection failed.'

        setMessage(
          `Linnworks connection failed: ${
            typeof reason === 'string' ? reason : JSON.stringify(reason)
          }`
        )

        setSaving(false)
        return
      }

      setMessage(`Linnworks connection successful. Server: ${data.server}`)
    } catch (error: any) {
      setMessage(error.message || 'Connection test failed')
    }

    setSaving(false)
  }

  if (loading) {
    return (
      <StaffPermissionGate permission="integrations">
        <main className="min-h-screen bg-neutral-950 p-5 text-white">
          Loading Linnworks settings...
        </main>
      </StaffPermissionGate>
    )
  }

  return (
    <StaffPermissionGate permission="integrations">
      <main className="min-h-screen bg-neutral-950 p-5 text-white">
        <div className="app-header mb-5 flex flex-wrap items-start justify-between gap-4 rounded-3xl bg-black p-4 text-white shadow-2xl sm:p-5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
            <div>
              <h1 className="text-2xl font-black tracking-normal">Linnworks Configuration</h1>

              <p className="text-sm text-neutral-300">
                Manual export first, then automatic sync for app-managed Linnworks inventory.
              </p>
            </div>

            <AppNav current="settings" />
          </div>

          <div className="flex items-center gap-3">
            {message && (
              <span className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm">
                {message}
              </span>
            )}

            <button
              onClick={testConnection}
              disabled={saving}
              className="rounded-lg border border-neutral-700 px-4 py-2 text-sm font-semibold hover:bg-neutral-800 disabled:opacity-40"
            >
              Test API
            </button>

            <button
              onClick={saveSettings}
              disabled={saving}
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>

            <Link
              href="/settings/integrations"
              className="rounded-lg border border-neutral-700 px-4 py-2 text-sm font-semibold hover:bg-neutral-800"
            >
              Back
            </Link>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 xl:col-span-2">
            <h2 className="mb-4 text-lg font-semibold">Master Controls</h2>

            <div className="grid gap-2 text-sm md:grid-cols-2">
              <label className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3">
                <span>
                  <span className="block font-bold">Enabled</span>
                  <span className="text-xs text-neutral-500">
                    If off, Linnworks sync routes should not run once the route gates are added.
                  </span>
                </span>

                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-4 w-4"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3">
                <span>
                  <span className="block font-bold">Auto Sync</span>
                  <span className="text-xs text-neutral-500">
                    If off, cron-triggered sync routes should skip once the route gates are added.
                  </span>
                </span>

                <input
                  type="checkbox"
                  checked={autoSync}
                  onChange={(e) => setAutoSync(e.target.checked)}
                  className="h-4 w-4"
                />
              </label>
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="mb-4 text-lg font-semibold">Sync Mode</h2>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-bold text-neutral-300">
                  Mode
                </span>
                <select
                  value={settings.mode}
                  onChange={(e) => updateSetting('mode', e.target.value)}
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
                >
                  <option value="manual_export_then_auto_sync">
                    Manual export, then automatic sync
                  </option>
                  <option value="manual_export_only">Manual export only</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-bold text-neutral-300">
                  Sync direction
                </span>
                <select
                  value={settings.sync_direction}
                  onChange={(e) => updateSetting('sync_direction', e.target.value)}
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
                >
                  <option value="controlled_two_way">
                    Controlled two-way: stock level two-way, product data app to Linnworks
                  </option>
                  <option value="app_to_linnworks_only">App to Linnworks only</option>
                  <option value="linnworks_to_app_stock_only">
                    Linnworks to app stock only
                  </option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-bold text-neutral-300">
                  Channel strategy
                </span>
                <select
                  value={settings.channel_strategy}
                  onChange={(e) => updateSetting('channel_strategy', e.target.value)}
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
                >
                  <option value="linnworks_inventory_first_ebay_via_linnworks">
                    Sync app to Linnworks inventory; eBay handled by Linnworks/eBay configurators
                  </option>
                  <option value="inventory_only">Inventory only for now</option>
                </select>
              </label>
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="mb-4 text-lg font-semibold">
              Default Location + BinRack
            </h2>

            <p className="mb-4 text-sm text-neutral-400">
              New exported items stay at these defaults until allocated or moved in the app.
              Any app-created bin can later be pushed to Linnworks BinRack.
            </p>

            <div className="grid gap-3 md:grid-cols-2">
              <label>
                <span className="mb-1 block text-sm font-bold text-neutral-300">
                  Default Linnworks location
                </span>
                <input
                  value={settings.default_location}
                  onChange={(e) => updateSetting('default_location', e.target.value)}
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
                />
              </label>

              <label>
                <span className="mb-1 block text-sm font-bold text-neutral-300">
                  Default Linnworks BinRack
                </span>
                <input
                  value={settings.default_binrack}
                  onChange={(e) => updateSetting('default_binrack', e.target.value)}
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
                />
              </label>
            </div>

            <div className="mt-4 space-y-2 text-sm">
              <label className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3">
                <span>Use app-created bins for Linnworks BinRack</span>
                <input
                  type="checkbox"
                  checked={settings.use_app_bins_for_binrack}
                  onChange={(e) =>
                    updateSetting('use_app_bins_for_binrack', e.target.checked)
                  }
                  className="h-4 w-4"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3">
                <span>Use app-managed identifier to ignore old Linnworks stock</span>
                <input
                  type="checkbox"
                  checked={settings.app_managed_identifier_enabled}
                  onChange={(e) =>
                    updateSetting('app_managed_identifier_enabled', e.target.checked)
                  }
                  className="h-4 w-4"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label>
                <span className="mb-1 block text-sm font-bold text-neutral-300">
                  Unknown BinRack value
                </span>
                <input
                  value={settings.unknown_bin}
                  onChange={(e) => updateSetting('unknown_bin', e.target.value)}
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
                />
              </label>

              <label>
                <span className="mb-1 block text-sm font-bold text-neutral-300">
                  In transit BinRack value
                </span>
                <input
                  value={settings.in_transit_bin}
                  onChange={(e) => updateSetting('in_transit_bin', e.target.value)}
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label>
                <span className="mb-1 block text-sm font-bold text-neutral-300">
                  Managed identifier name
                </span>
                <input
                  value={settings.managed_identifier_name}
                  onChange={(e) =>
                    updateSetting('managed_identifier_name', e.target.value)
                  }
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
                />
              </label>

              <label>
                <span className="mb-1 block text-sm font-bold text-neutral-300">
                  Managed identifier value
                </span>
                <input
                  value={settings.managed_identifier_value}
                  onChange={(e) =>
                    updateSetting('managed_identifier_value', e.target.value)
                  }
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
                />
              </label>
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 xl:col-span-2">
            <h2 className="mb-4 text-lg font-semibold">Location Mapping</h2>

            <p className="mb-4 text-sm text-neutral-400">
              App storage keys stay stable. Display names come from Settings → Locations.
              The right-hand value is the exact Linnworks location name.
            </p>

            <div className="grid gap-3">
              {orderedLocations.map((location) => {
                const appLocation = canonicalLocation(location.name)
                const linnworksLocation = settings.location_mapping[appLocation] || ''

                return (
                  <div
                    key={appLocation}
                    className="grid gap-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3 lg:grid-cols-[1.2fr_1fr_1fr]"
                  >
                    <label>
                      <span className="mb-1 block text-xs font-bold uppercase text-neutral-500">
                        App storage key
                      </span>
                      <input
                        value={appLocation}
                        disabled
                        className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-neutral-400"
                      />
                    </label>

                    <label>
                      <span className="mb-1 block text-xs font-bold uppercase text-neutral-500">
                        Display name
                      </span>
                      <input
                        value={displayLocation(location)}
                        disabled
                        className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-neutral-300"
                      />
                    </label>

                    <label>
                      <span className="mb-1 block text-xs font-bold uppercase text-neutral-500">
                        Linnworks location
                      </span>
                      <input
                        value={linnworksLocation}
                        onChange={(e) =>
                          updateLocationMapping(appLocation, e.target.value)
                        }
                        placeholder="Default / SHOP-1 / etc"
                        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2"
                      />
                    </label>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 xl:col-span-2">
            <h2 className="mb-4 text-lg font-semibold">Safety Rules</h2>

            <div className="grid gap-2 text-sm md:grid-cols-2">
              {[
                ['require_manual_export_first', 'Require manual export before sync'],
                ['only_sync_app_managed_items', 'Only sync app-managed items'],
                ['use_app_for_transfers', 'Use app for transfers'],
                ['create_missing_stock_items', 'Create missing Linnworks items on manual export'],
                ['update_existing_stock_items', 'Update existing managed items'],
              ].map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3"
                >
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    checked={Boolean(settings[key as keyof LinnworksSettings])}
                    onChange={(e) =>
                      updateSetting(
                        key as keyof LinnworksSettings,
                        e.target.checked as any
                      )
                    }
                    className="h-4 w-4"
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 xl:col-span-2">
            <h2 className="mb-4 text-lg font-semibold">
              Auto Sync After Manual Export
            </h2>

            <p className="mb-4 text-sm text-neutral-400">
              These only apply after an item has been exported from the app and marked as app-managed.
            </p>

            <div className="grid gap-2 text-sm md:grid-cols-2">
              {[
                ['sync_stock_levels_two_way', 'Stock level two-way sync'],
                ['sync_price_app_to_linnworks', 'Price app to Linnworks'],
                ['sync_location_app_to_linnworks', 'Location app to Linnworks'],
                ['sync_binrack_app_to_linnworks', 'BinRack app to Linnworks'],
                ['sync_title_app_to_linnworks', 'Title app to Linnworks'],
                ['sync_description_app_to_linnworks', 'Description app to Linnworks'],
                ['sync_category_app_to_linnworks', 'Category app to Linnworks'],
                ['sync_images_app_to_linnworks', 'Images app to Linnworks'],
              ].map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3"
                >
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    checked={Boolean(settings[key as keyof LinnworksSettings])}
                    onChange={(e) =>
                      updateSetting(
                        key as keyof LinnworksSettings,
                        e.target.checked as any
                      )
                    }
                    className="h-4 w-4"
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 xl:col-span-2">
            <h2 className="mb-4 text-lg font-semibold">Field Mapping</h2>

            <div className="grid gap-3 md:grid-cols-2">
              {Object.entries(settings.field_mapping).map(
                ([appField, linnworksField]) => (
                  <div
                    key={appField}
                    className="grid gap-2 rounded-xl border border-neutral-800 bg-neutral-950 p-3 md:grid-cols-2"
                  >
                    <label>
                      <span className="mb-1 block text-xs font-bold uppercase text-neutral-500">
                        App field
                      </span>
                      <input
                        value={appField}
                        disabled
                        className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-neutral-400"
                      />
                    </label>

                    <label>
                      <span className="mb-1 block text-xs font-bold uppercase text-neutral-500">
                        Linnworks field
                      </span>
                      <input
                        value={linnworksField}
                        onChange={(e) =>
                          updateFieldMapping(appField, e.target.value)
                        }
                        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2"
                      />
                    </label>
                  </div>
                )
              )}
            </div>
          </section>
        </div>
      </main>
    </StaffPermissionGate>
  )
}


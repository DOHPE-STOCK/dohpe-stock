'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import AppNav from '@/app/components/AppNav'

type LinnworksSettings = {
  mode: string
  sync_direction: string
  warehouse_location: string
  shop_locations: string[]
  bin_options: string[]
  default_bin: string | null
  unknown_bin: string
  in_transit_bin: string
  use_app_for_transfers: boolean
  create_missing_stock_items: boolean
  update_existing_stock_items: boolean
  sync_stock_levels_two_way: boolean
  sync_price_app_to_linnworks: boolean
  sync_location_app_to_linnworks: boolean
  sync_title_app_to_linnworks: boolean
  sync_description_app_to_linnworks: boolean
  managed_identifier_name: string
  managed_identifier_value: string
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

const defaultSettings: LinnworksSettings = {
  mode: 'manual_export',
  sync_direction: 'controlled_two_way',
  warehouse_location: 'Default',
  shop_locations: ['SHOP-1', 'SHOP-2', 'SHOP-3'],
  bin_options: ['Unknown', 'Stock Room', 'Shop Floor', 'In Transit'],
  default_bin: null,
  unknown_bin: 'Unknown',
  in_transit_bin: 'In Transit',
  use_app_for_transfers: true,
  create_missing_stock_items: true,
  update_existing_stock_items: true,
  sync_stock_levels_two_way: true,
  sync_price_app_to_linnworks: true,
  sync_location_app_to_linnworks: true,
  sync_title_app_to_linnworks: true,
  sync_description_app_to_linnworks: true,
  managed_identifier_name: 'dohpe_app_managed',
  managed_identifier_value: 'true',
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
  },
}

function mergeSettings(settings: any): LinnworksSettings {
  return {
    ...defaultSettings,
    ...(settings || {}),
    field_mapping: {
      ...defaultSettings.field_mapping,
      ...(settings?.field_mapping || {}),
    },
  }
}

export default function LinnworksIntegrationPage() {
  const [integration, setIntegration] = useState<IntegrationSetting | null>(null)
  const [settings, setSettings] = useState<LinnworksSettings>(defaultSettings)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetchIntegration()
  }, [])

  useEffect(() => {
    if (!message) return

    const timer = window.setTimeout(() => {
      setMessage('')
    }, 6000)

    return () => window.clearTimeout(timer)
  }, [message])

  async function fetchIntegration() {
    setLoading(true)

    const { data, error } = await supabase
      .from('integration_settings')
      .select('*')
      .eq('channel', 'linnworks')
      .single()

    if (error) {
      setMessage(error.message)
      setLoading(false)
      return
    }

    const merged = mergeSettings(data.settings)

    setIntegration(data as IntegrationSetting)
    setSettings(merged)
    setLoading(false)
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

  async function saveSettings() {
    if (!integration) return

    setSaving(true)

    const { error } = await supabase
      .from('integration_settings')
      .update({
        settings,
        updated_at: new Date().toISOString(),
      })
      .eq('id', integration.id)

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
      <main className="min-h-screen bg-neutral-950 p-5 text-white">
        Loading Linnworks settings...
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-neutral-950 p-5 text-white">
      <div className="mb-5 flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">Linnworks Configuration</h1>

            <p className="text-sm text-neutral-400">
              Configure controlled Linnworks export, stock sync, location sync and field mapping.
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
                <option value="manual_export">Manual export only</option>
                <option value="manual_export_then_sync">Manual export, then sync managed items</option>
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
                <option value="controlled_two_way">Controlled two-way</option>
                <option value="app_to_linnworks_only">App to Linnworks only</option>
                <option value="linnworks_to_app_stock_only">Linnworks to app stock only</option>
              </select>
            </label>

            <div className="space-y-2 text-sm">
              {[
                ['sync_stock_levels_two_way', 'Stock level two-way sync'],
                ['sync_price_app_to_linnworks', 'Price app → Linnworks'],
                ['sync_location_app_to_linnworks', 'Location/bin app → Linnworks'],
                ['sync_title_app_to_linnworks', 'Title app → Linnworks'],
                ['sync_description_app_to_linnworks', 'Description app → Linnworks'],
                ['use_app_for_transfers', 'Use app for transfers'],
                ['create_missing_stock_items', 'Create missing Linnworks items'],
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
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="mb-4 text-lg font-semibold">Managed Item Identifier</h2>

          <p className="mb-4 text-sm text-neutral-400">
            Only items created/exported by this app should sync. Existing Linnworks stock is ignored unless linked later.
          </p>

          <div className="grid gap-3 md:grid-cols-2">
            <label>
              <span className="mb-1 block text-sm font-bold text-neutral-300">
                Identifier name
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
                Identifier value
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

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="mb-4 text-lg font-semibold">Location Mapping</h2>

          <div className="space-y-4">
            <label>
              <span className="mb-1 block text-sm font-bold text-neutral-300">
                Warehouse Linnworks location
              </span>
              <input
                value={settings.warehouse_location}
                onChange={(e) =>
                  updateSetting('warehouse_location', e.target.value)
                }
                className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
              />
            </label>

            <label>
              <span className="mb-1 block text-sm font-bold text-neutral-300">
                Shop Linnworks locations, one per line
              </span>
              <textarea
                value={settings.shop_locations.join('\n')}
                onChange={(e) =>
                  updateSetting(
                    'shop_locations',
                    e.target.value
                      .split('\n')
                      .map((line) => line.trim())
                      .filter(Boolean)
                  )
                }
                className="h-28 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
              />
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="mb-4 text-lg font-semibold">Bin Rack Rules</h2>

          <p className="mb-4 text-sm text-neutral-400">
            Blank/null means unallocated/default. Bin/rack options should later be pulled from your app bin tables.
          </p>

          <div className="space-y-4">
            <label>
              <span className="mb-1 block text-sm font-bold text-neutral-300">
                Bin options, one per line
              </span>
              <textarea
                value={settings.bin_options.join('\n')}
                onChange={(e) =>
                  updateSetting(
                    'bin_options',
                    e.target.value
                      .split('\n')
                      .map((line) => line.trim())
                      .filter(Boolean)
                  )
                }
                className="h-28 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
              />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label>
                <span className="mb-1 block text-sm font-bold text-neutral-300">
                  Unknown bin
                </span>
                <input
                  value={settings.unknown_bin}
                  onChange={(e) => updateSetting('unknown_bin', e.target.value)}
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
                />
              </label>

              <label>
                <span className="mb-1 block text-sm font-bold text-neutral-300">
                  In transit bin
                </span>
                <input
                  value={settings.in_transit_bin}
                  onChange={(e) =>
                    updateSetting('in_transit_bin', e.target.value)
                  }
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
                />
              </label>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 xl:col-span-2">
          <h2 className="mb-4 text-lg font-semibold">Field Mapping</h2>

          <div className="grid gap-3 md:grid-cols-2">
            {Object.entries(settings.field_mapping).map(([appField, linnworksField]) => (
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
                    onChange={(e) => updateFieldMapping(appField, e.target.value)}
                    className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2"
                  />
                </label>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
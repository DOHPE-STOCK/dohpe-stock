'use client'

import { useEffect, useState } from 'react'
import AppNav from '@/app/components/AppNav'
import { supabase } from '@/lib/supabase'

type IntegrationSetting = {
  id: string
  channel: string
  enabled: boolean
  auto_sync: boolean
  connection_status: string
  settings: Record<string, any>
  last_synced_at: string | null
  last_error: string | null
}

const channelLabels: Record<string, string> = {
  linnworks: 'Linnworks',
  ebay: 'eBay',
  shopify: 'Shopify',
  vinted: 'Vinted',
  square: 'Square',
  loyverse: 'Loyverse',
  depop: 'Depop',
  tiktok_shop: 'TikTok Shop',
}

const channelDescriptions: Record<string, string> = {
  linnworks: 'Main stock/inventory sync and location updates.',
  ebay: 'Marketplace listing/export status.',
  shopify: 'Website product export and stock sync.',
  vinted: 'Vinted listing/export workflow.',
  square: 'POS/payment reporting integration.',
  loyverse: 'Legacy/optional POS channel.',
  depop: 'Depop listing/export workflow.',
  tiktok_shop: 'TikTok Shop listing/export workflow.',
}

function formatChannelName(channel: string) {
  return channelLabels[channel] || channel
}

function getStatusBadge(status: string) {
  if (status === 'connected') {
    return 'bg-green-100 text-green-800 border-green-300'
  }

  if (status === 'error' || status === 'failed') {
    return 'bg-red-100 text-red-800 border-red-300'
  }

  if (status === 'syncing' || status === 'testing') {
    return 'bg-blue-100 text-blue-800 border-blue-300'
  }

  return 'bg-gray-100 text-gray-700 border-gray-300'
}

export default function IntegrationsSettingsPage() {
  const [integrations, setIntegrations] = useState<IntegrationSetting[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => {
    fetchIntegrations()
  }, [])

  async function fetchIntegrations() {
    setLoading(true)

    const { data, error } = await supabase
      .from('integration_settings')
      .select('*')
      .order('channel', { ascending: true })

    if (error) {
      console.error('Error loading integrations:', error)
      setLoading(false)
      return
    }

    setIntegrations((data || []) as IntegrationSetting[])
    setLoading(false)
  }

  async function updateIntegration(
    id: string,
    updates: Partial<IntegrationSetting>
  ) {
    setSavingId(id)

    const { error } = await supabase
      .from('integration_settings')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) {
      console.error('Error updating integration:', error)
      alert('Could not save integration setting.')
      setSavingId(null)
      return
    }

    setIntegrations((current) =>
      current.map((integration) =>
        integration.id === id
          ? { ...integration, ...updates }
          : integration
      )
    )

    setSavingId(null)
  }

  async function testConnection(integration: IntegrationSetting) {
    await updateIntegration(integration.id, {
      connection_status: 'testing',
      last_error: null,
    })

    // Placeholder until real API routes are added.
    // Later this should call something like:
    // /api/integrations/linnworks/test
    setTimeout(async () => {
      await updateIntegration(integration.id, {
        connection_status: integration.enabled ? 'connected' : 'not_connected',
        last_synced_at: integration.enabled ? new Date().toISOString() : null,
        last_error: integration.enabled ? null : 'Integration is disabled.',
      })
    }, 700)
  }

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <AppNav />

      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-8">
          <p className="text-sm font-bold uppercase tracking-wide text-gray-500">
            Settings
          </p>

          <h1 className="mt-1 text-4xl font-black tracking-tight">
            Channel Integrations
          </h1>

          <p className="mt-2 max-w-3xl text-gray-600">
            Control which sales channels are active, whether they auto-sync, and
            the connection state used by the Finalised page.
          </p>
        </div>

        {loading ? (
          <div className="rounded-2xl bg-white p-8 shadow">
            Loading integrations...
          </div>
        ) : (
          <div className="grid gap-4">
            {integrations.map((integration) => (
              <div
                key={integration.id}
                className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-2xl font-black">
                        {formatChannelName(integration.channel)}
                      </h2>

                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-black uppercase ${getStatusBadge(
                          integration.connection_status
                        )}`}
                      >
                        {integration.connection_status.replaceAll('_', ' ')}
                      </span>
                    </div>

                    <p className="mt-1 text-sm text-gray-600">
                      {channelDescriptions[integration.channel] ||
                        'Channel integration settings.'}
                    </p>

                    {integration.last_error && (
                      <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                        {integration.last_error}
                      </p>
                    )}

                    {integration.last_synced_at && (
                      <p className="mt-2 text-xs text-gray-500">
                        Last synced:{' '}
                        {new Date(integration.last_synced_at).toLocaleString()}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold">
                      <input
                        type="checkbox"
                        checked={integration.enabled}
                        onChange={(event) =>
                          updateIntegration(integration.id, {
                            enabled: event.target.checked,
                            connection_status: event.target.checked
                              ? integration.connection_status
                              : 'not_connected',
                          })
                        }
                      />
                      Enabled
                    </label>

                    <label className="flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold">
                      <input
                        type="checkbox"
                        checked={integration.auto_sync}
                        disabled={!integration.enabled}
                        onChange={(event) =>
                          updateIntegration(integration.id, {
                            auto_sync: event.target.checked,
                          })
                        }
                      />
                      Auto sync
                    </label>

                    <button
                      type="button"
                      disabled={savingId === integration.id}
                      onClick={() => testConnection(integration)}
                      className="rounded-xl bg-black px-4 py-2 text-sm font-black text-white disabled:opacity-40"
                    >
                      {savingId === integration.id ? 'Saving...' : 'Test'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
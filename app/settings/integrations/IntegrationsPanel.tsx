'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useCompany } from '@/app/context/CompanyContext'
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

const CHANNELS = [
  {
    key: 'linnworks',
    name: 'Linnworks',
    src: 'https://www.google.com/s2/favicons?domain=linnworks.com&sz=64',
    description: 'Main stock/inventory sync, location sync and future order control.',
  },
  {
    key: 'ebay',
    name: 'eBay',
    src: 'https://www.google.com/s2/favicons?domain=ebay.co.uk&sz=64',
    description: 'Marketplace listing/export status.',
  },
  {
    key: 'shopify',
    name: 'Shopify',
    src: 'https://www.google.com/s2/favicons?domain=shopify.com&sz=64',
    description: 'Website product export and stock sync.',
  },
  {
    key: 'vinted',
    name: 'Vinted',
    src: 'https://www.google.com/s2/favicons?domain=vinted.co.uk&sz=64',
    description: 'Vinted listing/export workflow.',
  },
  {
    key: 'grailed',
    name: 'Grailed',
    src: 'https://www.google.com/s2/favicons?domain=grailed.com&sz=64',
    description: 'Grailed menswear and streetwear listing workflow.',
  },
  {
    key: 'vestiaire_collective',
    name: 'Vestiaire Collective',
    src: 'https://www.google.com/s2/favicons?domain=vestiairecollective.com&sz=64',
    description: 'Vestiaire Collective luxury resale listing workflow.',
  },
  {
    key: 'whatnot',
    name: 'Whatnot',
    src: 'https://www.google.com/s2/favicons?domain=whatnot.com&sz=64',
    description: 'Whatnot live-selling and marketplace workflow.',
  },
  {
    key: 'square',
    name: 'Square',
    src: 'https://www.google.com/s2/favicons?domain=squareup.com&sz=64',
    description: 'POS/payment reporting integration.',
  },
  {
    key: 'depop',
    name: 'Depop',
    src: 'https://www.google.com/s2/favicons?domain=depop.com&sz=64',
    description: 'Depop listing/export workflow.',
  },
  {
    key: 'tiktok_shop',
    name: 'TikTok Shop',
    src: 'https://www.google.com/s2/favicons?domain=tiktok.com&sz=64',
    description: 'TikTok Shop listing/export workflow.',
  },
] as const

function getChannelMeta(channel: string) {
  return (
    CHANNELS.find((item) => item.key === channel) || {
      key: channel,
      name: channel,
      src: '',
      description: 'Channel integration settings.',
    }
  )
}

function statusText(status: string) {
  return status.replaceAll('_', ' ')
}

function statusClass(status: string) {
  if (status === 'connected') return 'border-green-700 bg-green-950 text-green-300'
  if (status === 'error' || status === 'failed') return 'border-red-700 bg-red-950 text-red-300'
  if (status === 'syncing' || status === 'testing') return 'border-blue-700 bg-blue-950 text-blue-300'
  return 'border-neutral-700 bg-neutral-900 text-neutral-400'
}

function iconOpacity(integration: IntegrationSetting) {
  if (!integration.enabled) return 'opacity-25 grayscale'
  if (integration.connection_status === 'connected') return 'opacity-100'
  if (integration.connection_status === 'syncing' || integration.connection_status === 'testing') {
    return 'animate-pulse opacity-60 grayscale'
  }
  if (integration.connection_status === 'error' || integration.connection_status === 'failed') {
    return 'opacity-80 grayscale ring-1 ring-red-500'
  }
  return 'opacity-40 grayscale'
}

export default function IntegrationsPanel() {
  const { activeCompanyId, schemaReady } = useCompany()
  const [integrations, setIntegrations] = useState<IntegrationSetting[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => {
    fetchIntegrations()
  }, [activeCompanyId, schemaReady])

  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(''), 5000)
    return () => window.clearTimeout(timer)
  }, [message])

  async function fetchIntegrations() {
    setLoading(true)

    let query = supabase
      .from('integration_settings')
      .select('*')
      .order('channel', { ascending: true })

    if (schemaReady) query = query.eq('company_id', activeCompanyId)

    const { data, error } = await query

    if (error) {
      setMessage(error.message)
      setLoading(false)
      return
    }

    const savedRows = new Map(
      ((data || []) as IntegrationSetting[])
        .filter((integration) => integration.channel !== 'loyverse')
        .map((integration) => [integration.channel, integration])
    )

    setIntegrations(
      CHANNELS.map((channel) => {
        const saved = savedRows.get(channel.key)
        return (
          saved || {
            id: '',
            channel: channel.key,
            enabled: false,
            auto_sync: false,
            connection_status: 'not_configured',
            settings: {},
            last_synced_at: null,
            last_error: null,
          }
        )
      })
    )
    setLoading(false)
  }

  async function updateIntegration(integrationOrId: IntegrationSetting | string, updates: Partial<IntegrationSetting>) {
    const existing =
      typeof integrationOrId === 'string'
        ? integrations.find((integration) => integration.id === integrationOrId)
        : integrationOrId

    if (!existing) return false

    setSavingId(existing.id || existing.channel)

    const payload = {
      ...(schemaReady ? { company_id: activeCompanyId } : {}),
      channel: existing.channel,
      enabled: updates.enabled ?? existing.enabled,
      auto_sync: updates.auto_sync ?? existing.auto_sync,
      connection_status: updates.connection_status ?? existing.connection_status,
      settings: updates.settings ?? existing.settings ?? {},
      last_synced_at: updates.last_synced_at ?? existing.last_synced_at,
      last_error: updates.last_error ?? existing.last_error,
      updated_at: new Date().toISOString(),
    }

    const result = existing.id
      ? await supabase
          .from('integration_settings')
          .update({
            ...updates,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .eq(schemaReady ? 'company_id' : 'id', schemaReady ? activeCompanyId : existing.id)
      : await supabase
          .from('integration_settings')
          .upsert(payload, {
            onConflict: schemaReady ? 'company_id,channel' : 'channel',
          })
          .select('*')
          .single()

    const error = result.error

    if (error) {
      setMessage(error.message)
      setSavingId(null)
      return false
    }

    const savedRow = (result as any).data || { ...existing, ...updates }

    setIntegrations((current) =>
      current.map((integration) =>
        integration.channel === existing.channel ? { ...integration, ...savedRow, ...updates } : integration
      )
    )

    setSavingId(null)
    return true
  }

  async function testConnection(integration: IntegrationSetting) {
    const testRoutes: Record<string, { route: string; label: string }> = {
      linnworks: { route: '/api/integrations/linnworks/test', label: 'Linnworks' },
      ebay: { route: '/api/integrations/ebay/test', label: 'eBay' },
    }

    const testRoute = testRoutes[integration.channel]

    if (!testRoute) {
      const result = 'API connection test is not built for this channel yet.'
      setMessage(result)
      alert(result)
      return
    }

    setSavingId(integration.id || integration.channel)
    setMessage(`Testing ${testRoute.label} connection...`)

    await updateIntegration(integration, {
      connection_status: 'testing',
      last_error: null,
    })

    try {
      const response = await fetch(testRoute.route)
      const data = await response.json()

      if (!response.ok || !data.ok) {
        const reason =
          data?.message ||
          data?.details?.Message ||
          data?.details ||
          `${testRoute.label} connection failed.`

        await updateIntegration(integration, {
          connection_status: 'error',
          last_error: typeof reason === 'string' ? reason : JSON.stringify(reason),
        })

        const result = `${testRoute.label} API connection failed: ${
          typeof reason === 'string' ? reason : JSON.stringify(reason)
        }`

        setMessage(result)
        alert(result)
        setSavingId(null)
        return
      }

      await updateIntegration(integration, {
        connection_status: 'connected',
        last_synced_at: new Date().toISOString(),
        last_error: null,
      })

      const result =
        integration.channel === 'ebay'
          ? `${testRoute.label} API connection successful. Marketplace: ${
              data.marketplace_id || 'Unknown'
            }, category tree: ${data.category_tree_id || 'Unknown'}`
          : `${testRoute.label} API connection successful. Server: ${data.server || 'Unknown'}`
      setMessage(result)
      alert(result)
    } catch (error: any) {
      const reason = error?.message || 'Unknown error.'

      await updateIntegration(integration, {
        connection_status: 'error',
        last_error: reason,
      })

      const result = `${testRoute.label} API connection failed: ${reason}`
      setMessage(result)
      alert(result)
    }

    setSavingId(null)
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-white">Channel Integrations</h2>
            <p className="mt-1 text-sm text-neutral-400">
              Grey icons mean disabled/not exported. Original logo colours mean exported or synced.
              Red means failed. Pulsing grey means syncing.
            </p>
          </div>

          {message && (
            <span className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs font-bold text-neutral-200">
              {message}
            </span>
          )}
        </div>
      </section>

      {loading ? (
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-neutral-400">
          Loading integrations...
        </section>
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          {integrations.map((integration) => {
            const channel = getChannelMeta(integration.channel)

            return (
              <div
                key={integration.channel}
                className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-neutral-950">
                      {channel.src ? (
                        <img
                          src={channel.src}
                          alt=""
                          className={`h-7 w-7 rounded-sm ${iconOpacity(integration)}`}
                        />
                      ) : (
                        <span className="text-lg font-black">{channel.name.slice(0, 1)}</span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <h2 className="text-xl font-black text-white">{channel.name}</h2>
                      <p className="mt-1 text-sm text-neutral-400">{channel.description}</p>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <span
                          className={`rounded-full border px-3 py-1 text-xs font-black uppercase ${statusClass(
                            integration.connection_status
                          )}`}
                        >
                          {statusText(integration.connection_status)}
                        </span>

                        {integration.auto_sync && (
                          <span className="rounded-full border border-blue-700 bg-blue-950 px-3 py-1 text-xs font-black uppercase text-blue-300">
                            auto sync
                          </span>
                        )}

                        {!integration.enabled && (
                          <span className="rounded-full border border-neutral-700 bg-neutral-950 px-3 py-1 text-xs font-black uppercase text-neutral-500">
                            disabled
                          </span>
                        )}
                      </div>

                      {integration.last_error && (
                        <p className="mt-3 rounded-xl border border-red-800 bg-red-950 p-3 text-sm font-bold text-red-300">
                          {integration.last_error}
                        </p>
                      )}

                      {integration.last_synced_at && (
                        <p className="mt-3 text-xs text-neutral-500">
                          Last synced: {new Date(integration.last_synced_at).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 border-t border-neutral-800 pt-4">
                  <label className="flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2 text-sm font-semibold text-white">
                    <input
                      type="checkbox"
                      checked={integration.enabled}
                      onChange={(event) =>
                        updateIntegration(integration, {
                          enabled: event.target.checked,
                          connection_status: event.target.checked
                            ? integration.connection_status
                            : 'not_connected',
                        })
                      }
                      className="h-4 w-4"
                    />
                    Enabled
                  </label>

                  <label className="flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2 text-sm font-semibold text-white">
                    <input
                      type="checkbox"
                      checked={integration.auto_sync}
                      disabled={!integration.enabled}
                      onChange={(event) =>
                        updateIntegration(integration, {
                          auto_sync: event.target.checked,
                        })
                      }
                      className="h-4 w-4 disabled:opacity-30"
                    />
                    Auto Sync
                  </label>

                  <button
                    type="button"
                    onClick={() => testConnection(integration)}
                    disabled={savingId === (integration.id || integration.channel)}
                    className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
                  >
                    {savingId === (integration.id || integration.channel) ? 'Testing...' : 'Test'}
                  </button>

                  <Link
                    href={`/settings/integrations/${integration.channel}`}
                    className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-black text-white hover:bg-neutral-800"
                  >
                    Configure
                  </Link>
                </div>
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}

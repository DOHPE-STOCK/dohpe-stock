'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import AppNav from '@/app/components/AppNav'
import StaffPermissionGate from '@/app/components/StaffPermissionGate'
import { supabase } from '@/lib/supabase'
import {
  DEFAULT_EBAY_SETTINGS,
  EbayCategoryMapping,
  EbaySettings,
  mergeEbaySettings,
} from '@/lib/ebayIntegrationSettings'

type IntegrationSetting = {
  id: string
  channel: string
  enabled: boolean
  auto_sync: boolean
  connection_status: string
  settings: EbaySettings | any
  last_synced_at: string | null
  last_error: string | null
}

type EbayPolicyOption = {
  id: string
  name: string
}

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function emptyCategoryMapping(): EbayCategoryMapping {
  return {
    app_category: '',
    app_sub_category: '',
    item_type: '',
    gender: '',
    ebay_category_id: '',
    ebay_category_name: '',
    default_condition: 'Excellent',
    aspect_mapping: {
      Brand: 'brand',
      Type: 'sub_category',
      Size: 'size',
      Colour: 'colour',
      Department: 'department',
      Style: 'style',
      Material: 'material',
    },
  }
}

function emptyConditionMapping() {
  return {
    app_condition: '',
    ebay_condition: '',
  }
}

const ebayConditionOptions = [
  'NEW',
  'NEW_OTHER',
  'NEW_WITH_DEFECTS',
  'LIKE_NEW',
  'PRE_OWNED_EXCELLENT',
  'PRE_OWNED_GOOD',
  'USED_EXCELLENT',
  'USED_VERY_GOOD',
  'USED_GOOD',
  'USED_ACCEPTABLE',
  'PRE_OWNED_FAIR',
  'FOR_PARTS_OR_NOT_WORKING',
]

function policyOptions(data: any, key: string): EbayPolicyOption[] {
  const rows = Array.isArray(data?.[key]) ? data[key] : []
  return rows.map((row: any) => ({
    id:
      text(row.paymentPolicyId) ||
      text(row.fulfillmentPolicyId) ||
      text(row.returnPolicyId) ||
      text(row.id),
    name: text(row.name) || text(row.policyName) || 'Unnamed policy',
  })).filter((row: EbayPolicyOption) => row.id)
}

function pickPolicyId(options: EbayPolicyOption[], current: string) {
  if (current && options.some((option) => option.id === current)) return current
  return options[0]?.id || current || ''
}

export default function EbayIntegrationPage() {
  const [integration, setIntegration] = useState<IntegrationSetting | null>(null)
  const [settings, setSettings] = useState<EbaySettings>(DEFAULT_EBAY_SETTINGS)
  const [enabled, setEnabled] = useState(false)
  const [autoSync, setAutoSync] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [policies, setPolicies] = useState<{
    payment: EbayPolicyOption[]
    fulfillment: EbayPolicyOption[]
    returns: EbayPolicyOption[]
  }>({ payment: [], fulfillment: [], returns: [] })
  const [metadataLoadingCategory, setMetadataLoadingCategory] = useState('')
  const [metadataByCategory, setMetadataByCategory] = useState<Record<string, any>>({})
  const [categorySearch, setCategorySearch] = useState('bag')
  const [categorySuggestions, setCategorySuggestions] = useState<any[]>([])
  const [readinessSku, setReadinessSku] = useState('TEST002')
  const [readinessResult, setReadinessResult] = useState<any>(null)
  const [readinessMessage, setReadinessMessage] = useState('')
  const [readinessMessageType, setReadinessMessageType] = useState<'info' | 'success' | 'error'>('info')
  const [publishResult, setPublishResult] = useState<any>(null)
  const [showCategoryMappings, setShowCategoryMappings] = useState(false)

  useEffect(() => {
    fetchIntegration().finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(''), 7000)
    return () => window.clearTimeout(timer)
  }, [message])

  async function fetchIntegration() {
    const { data, error } = await supabase
      .from('integration_settings')
      .select('*')
      .eq('channel', 'ebay')
      .maybeSingle()

    if (error) {
      setMessage(error.message)
      return
    }

    if (!data) {
      setMessage('No eBay integration row exists yet in integration_settings.')
      return
    }

    const merged = mergeEbaySettings(data.settings)
    setIntegration(data as IntegrationSetting)
    setSettings(merged)
    setEnabled(Boolean(data.enabled))
    setAutoSync(Boolean(data.auto_sync))
  }

  function updateSetting<K extends keyof EbaySettings>(key: K, value: EbaySettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  function updateCategoryMapping(index: number, patch: Partial<EbayCategoryMapping>) {
    setSettings((current) => ({
      ...current,
      category_mappings: current.category_mappings.map((mapping, mappingIndex) =>
        mappingIndex === index ? { ...mapping, ...patch } : mapping
      ),
    }))
  }

  function updateAspectMapping(index: number, aspectName: string, appField: string) {
    setSettings((current) => ({
      ...current,
      category_mappings: current.category_mappings.map((mapping, mappingIndex) =>
        mappingIndex === index
          ? {
              ...mapping,
              aspect_mapping: {
                ...mapping.aspect_mapping,
                [aspectName]: appField,
              },
            }
          : mapping
      ),
    }))
  }

  function updateConditionMapping(index: number, patch: { app_condition?: string; ebay_condition?: string }) {
    setSettings((current) => ({
      ...current,
      condition_mappings: current.condition_mappings.map((mapping, mappingIndex) =>
        mappingIndex === index ? { ...mapping, ...patch } : mapping
      ),
    }))
  }

  async function saveSettings() {
    if (!integration) return
    setSaving(true)

    const { error } = await supabase
      .from('integration_settings')
      .update({
        enabled,
        auto_sync: autoSync,
        settings,
        updated_at: new Date().toISOString(),
      })
      .eq('id', integration.id)

    setSaving(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage('eBay settings saved')
    fetchIntegration()
  }

  async function testConnection() {
    setMessage('Testing eBay connection...')
    const response = await fetch('/api/integrations/ebay/test')
    const data = await response.json()

    if (!response.ok || !data.ok) {
      setMessage(data.message || 'eBay connection failed.')
      return
    }

    setMessage(`eBay connected. Marketplace ${data.marketplace_id}; category tree ${data.category_tree_id}.`)
    fetchIntegration()
  }

  async function pullPolicies() {
    setMessage('Pulling eBay business policies...')
    const response = await fetch('/api/integrations/ebay/policies')
    const data = await response.json()

    if (!response.ok || !data.ok) {
      setMessage(data.message || 'Could not pull eBay policies.')
      return
    }

    const nextPolicies = {
      payment: policyOptions(data, 'paymentPolicies'),
      fulfillment: policyOptions(data, 'fulfillmentPolicies'),
      returns: policyOptions(data, 'returnPolicies'),
    }
    const nextSettings = {
      ...settings,
      payment_policy_id: pickPolicyId(nextPolicies.payment, settings.payment_policy_id),
      fulfillment_policy_id: pickPolicyId(nextPolicies.fulfillment, settings.fulfillment_policy_id),
      return_policy_id: pickPolicyId(nextPolicies.returns, settings.return_policy_id),
    }

    setPolicies(nextPolicies)
    setSettings(nextSettings)

    if (integration) {
      const { error: saveError } = await supabase
        .from('integration_settings')
        .update({
          settings: nextSettings,
          updated_at: new Date().toISOString(),
        })
        .eq('id', integration.id)

      if (saveError) {
        setMessage(saveError.message)
        return
      }
    }

    setMessage('eBay business policies loaded and saved')
  }

  async function pullCategoryMetadata(mapping: EbayCategoryMapping) {
    if (!mapping.ebay_category_id) {
      setMessage('Enter an eBay category ID first.')
      return
    }

    setMetadataLoadingCategory(mapping.ebay_category_id)
    const response = await fetch(
      `/api/integrations/ebay/category-metadata?category_id=${encodeURIComponent(mapping.ebay_category_id)}`
    )
    const data = await response.json()
    setMetadataLoadingCategory('')

    if (!response.ok || !data.ok) {
      setMessage(data.message || 'Could not load eBay category metadata.')
      return
    }

    setMetadataByCategory((current) => ({ ...current, [mapping.ebay_category_id]: data }))
    setMessage(`Loaded metadata for eBay category ${mapping.ebay_category_id}`)
  }

  async function searchCategories() {
    const q = text(categorySearch)
    if (!q) {
      setMessage('Enter a category search term.')
      return
    }

    setMessage('Searching eBay categories...')
    const response = await fetch(
      `/api/integrations/ebay/category-suggestions?q=${encodeURIComponent(q)}`
    )
    const data = await response.json()

    if (!response.ok || !data.ok) {
      setMessage(data.message || 'Could not search eBay categories.')
      return
    }

    setCategorySuggestions(data.suggestions || [])
    setMessage(`Loaded ${data.suggestions?.length || 0} eBay category suggestion(s).`)
  }

  async function runReadinessCheck(categoryId?: string) {
    const sku = text(readinessSku)
    if (!sku) {
      setReadinessMessageType('error')
      setReadinessMessage('Enter a SKU to check.')
      return
    }

    setReadinessMessageType('info')
    setReadinessMessage(`Checking eBay readiness for ${sku}...`)
    const params = new URLSearchParams({ sku })
    if (categoryId) params.set('category_id', categoryId)

    const response = await fetch(`/api/integrations/ebay/listing-readiness?${params.toString()}`)
    const data = await response.json()

    if (!response.ok || !data.ok) {
      setReadinessMessageType('error')
      setReadinessMessage(data.message || 'Could not check eBay listing readiness.')
      return
    }

    setReadinessResult(data)
    setPublishResult(null)
    setReadinessMessageType(data.ready ? 'success' : 'error')
    setReadinessMessage(
      data.ready
        ? `${sku} is eBay ready in shadow validation.`
        : `${sku} has ${data.missing?.length || 0} missing requirement(s).`
    )
  }

  async function saveShadowDraft() {
    if (!readinessResult) {
      setReadinessMessageType('error')
      setReadinessMessage('Run a readiness check first.')
      return
    }

    setReadinessMessageType('info')
    setReadinessMessage(`Saving eBay shadow draft for ${readinessResult.sku}...`)
    const response = await fetch('/api/integrations/ebay/shadow-draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ readiness: readinessResult }),
    })
    const data = await response.json()

    if (!response.ok || !data.ok) {
      setReadinessMessageType('error')
      setReadinessMessage(data.message || 'Could not save eBay shadow draft.')
      return
    }

    setReadinessMessageType('success')
    setReadinessMessage(`Saved eBay shadow draft for ${data.draft?.sku || readinessResult.sku}.`)
  }

  async function publishSandboxDraft() {
    const sku = text(readinessSku)
    if (!sku) {
      setReadinessMessageType('error')
      setReadinessMessage('Enter a SKU to publish to Sandbox.')
      return
    }

    if (settings.environment !== 'sandbox') {
      setReadinessMessageType('error')
      setReadinessMessage('Sandbox publish is only available when eBay environment is sandbox.')
      return
    }

    setReadinessMessageType('info')
    setReadinessMessage(`Publishing ${sku} to eBay Sandbox...`)
    setPublishResult(null)

    const response = await fetch('/api/integrations/ebay/sandbox-publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sku }),
    })
    const data = await response.json()

    if (!response.ok || !data.ok) {
      setReadinessMessageType('error')
      setReadinessMessage(data.message || 'Could not publish to eBay Sandbox.')
      return
    }

    setReadinessMessageType('success')
    setPublishResult(data)
    setReadinessMessage(
      `Published ${sku} to eBay Sandbox. Offer ${data.offer_id}${
        data.listing_id ? `, listing ${data.listing_id}` : ''
      }.`
    )
  }

  async function createSandboxDefaultPolicies() {
    if (settings.environment !== 'sandbox') {
      setMessage('Default policy creation is currently Sandbox-only.')
      return
    }

    setMessage('Creating eBay Sandbox default policies...')
    const response = await fetch('/api/integrations/ebay/sandbox-default-policies', {
      method: 'POST',
    })
    const data = await response.json()

    if (!response.ok || !data.ok) {
      setMessage(data.message || 'Could not create eBay Sandbox default policies.')
      return
    }

    setMessage('eBay Sandbox default policies saved.')
    fetchIntegration()
  }

  if (loading) {
    return (
      <StaffPermissionGate permission="integrations">
        <main className="min-h-screen bg-neutral-950 p-5 text-white">Loading eBay settings...</main>
      </StaffPermissionGate>
    )
  }

  const selectedPolicies = {
    payment: settings.payment_policy_id,
    fulfillment: settings.fulfillment_policy_id,
    returns: settings.return_policy_id,
  }
  const ebayConnected = integration?.connection_status === 'connected'
  const ebayActive = enabled && ebayConnected
  const ebayAccountLabel =
    text(settings.ebay_account_name) || text(settings.ebay_username) || text(settings.ebay_user_id) || 'Connected account'

  return (
    <StaffPermissionGate permission="integrations">
      <main className="min-h-screen bg-neutral-950 p-5 text-white">
        <div className="app-header mb-5 flex flex-wrap items-start justify-between gap-4 rounded-3xl bg-black p-4 text-white shadow-2xl sm:p-5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">
            <div>
              <h1 className="text-2xl font-black tracking-normal">eBay Configuration</h1>
              <p className="text-sm text-neutral-300">
                Configure GB listing creation separately from order management. Live listing stays Linnworks-led until direct eBay is proven.
              </p>
            </div>
            <AppNav current="settings" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {message && (
              <span
                className="rounded-lg border px-4 py-2 text-sm font-bold shadow-lg"
                style={{
                  backgroundColor: '#111827',
                  borderColor: '#374151',
                  color: '#ffffff',
                }}
              >
                {message}
              </span>
            )}

            <button
              type="button"
              onClick={testConnection}
              className="rounded-lg border border-neutral-700 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
            >
              Test
            </button>

            <button
              type="button"
              onClick={createSandboxDefaultPolicies}
              disabled={settings.environment !== 'sandbox'}
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-black text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Create Sandbox Policies
            </button>

            {!ebayActive && (
              <a
                href="/api/integrations/ebay/connect"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-500"
              >
                eBay connect
              </a>
            )}

            <button
              type="button"
              onClick={saveSettings}
              disabled={saving}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-black text-white hover:bg-green-500 disabled:opacity-40"
            >
              {saving ? 'Saving' : 'Save'}
            </button>

            <Link
              href="/settings/integrations"
              className="rounded-lg border border-neutral-700 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
            >
              Back
            </Link>

            {ebayActive && (
              <span
                className="max-w-[220px] truncate text-sm font-medium text-white"
                title={`eBay connected: ${ebayAccountLabel}`}
              >
                {ebayAccountLabel} ✓
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="mb-4 text-lg font-semibold">Connection + Safety</h2>

            <div className="space-y-3">
              <label className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm font-bold">
                <span>Enabled</span>
                <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm font-bold">
                <span>Auto sync</span>
                <input type="checkbox" checked={autoSync} onChange={(event) => setAutoSync(event.target.checked)} />
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <label>
                  <span className="mb-1 block text-sm font-bold text-neutral-300">Marketplace</span>
                  <input
                    value={settings.marketplace_id}
                    onChange={(event) => updateSetting('marketplace_id', event.target.value as any)}
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
                  />
                </label>

                <label>
                  <span className="mb-1 block text-sm font-bold text-neutral-300">Locale</span>
                  <input
                    value={settings.locale}
                    onChange={(event) => updateSetting('locale', event.target.value as any)}
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
                  />
                </label>
              </div>

              <label>
                <span className="mb-1 block text-sm font-bold text-neutral-300">Environment</span>
                <select
                  value={settings.environment}
                  onChange={(event) => updateSetting('environment', event.target.value as any)}
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
                >
                  <option value="production">Production</option>
                  <option value="sandbox">Sandbox</option>
                </select>
              </label>
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="mb-4 text-lg font-semibold">Listing Creation</h2>

            <div className="space-y-3">
              <label>
                <span className="mb-1 block text-sm font-bold text-neutral-300">Listing mode</span>
                <select
                  value={settings.listing_mode}
                  onChange={(event) => updateSetting('listing_mode', event.target.value as any)}
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
                >
                  <option value="direct_shadow_only">Direct eBay shadow only</option>
                  <option value="direct_publish">Direct eBay publish</option>
                </select>
              </label>

              <label>
                <span className="mb-1 block text-sm font-bold text-neutral-300">Listing format</span>
                <select
                  value={settings.listing_format}
                  onChange={(event) => updateSetting('listing_format', event.target.value as any)}
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
                >
                  <option value="FIXED_PRICE">Fixed price</option>
                  <option value="AUCTION">Auction</option>
                </select>
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <label>
                  <span className="mb-1 block text-sm font-bold text-neutral-300">Title source</span>
                  <select
                    value={settings.title_source}
                    onChange={(event) => updateSetting('title_source', event.target.value as any)}
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
                  >
                    <option value="final_title">Final title</option>
                    <option value="ai_title">AI title</option>
                    <option value="basic_title">Basic title</option>
                  </select>
                </label>

                <label>
                  <span className="mb-1 block text-sm font-bold text-neutral-300">Image source</span>
                  <select
                    value={settings.image_source}
                    onChange={(event) => updateSetting('image_source', event.target.value as any)}
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
                  >
                    <option value="processed_images">Processed images</option>
                    <option value="original_images">Original images</option>
                  </select>
                </label>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="mb-4 text-lg font-semibold">Order Management</h2>

            <label>
              <span className="mb-1 block text-sm font-bold text-neutral-300">Order mode</span>
              <select
                value={settings.order_mode}
                onChange={(event) => updateSetting('order_mode', event.target.value as any)}
                className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
              >
                <option value="linnworks_live_shadow_direct">Live via Linnworks, direct eBay shadow</option>
                <option value="direct_shadow_only">Direct eBay shadow only</option>
                <option value="direct_orders">Direct eBay order import</option>
              </select>
            </label>

            <div className="mt-4 rounded-xl border border-yellow-800 bg-yellow-950/40 p-3 text-sm font-bold text-yellow-200">
              Direct orders should stay shadow-only until they match Linnworks processed/open order behaviour.
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Business Policies + Location</h2>
              <button
                type="button"
                onClick={pullPolicies}
                className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-500"
              >
                Pull from eBay
              </button>
            </div>

            {[
              ['payment_policy_id', 'Payment policy', policies.payment, selectedPolicies.payment],
              ['fulfillment_policy_id', 'Fulfillment policy', policies.fulfillment, selectedPolicies.fulfillment],
              ['return_policy_id', 'Return policy', policies.returns, selectedPolicies.returns],
            ].map(([key, label, options]) => {
              const policyOptions = options as EbayPolicyOption[]
              const savedValue = settings[key as keyof EbaySettings] as string
              const savedValueIsListed = policyOptions.some((policy) => policy.id === savedValue)

              return (
                <label key={key as string} className="mb-3 block">
                  <span className="mb-1 block text-sm font-bold text-neutral-300">{label as string}</span>
                  <select
                    value={savedValue}
                    onChange={(event) => updateSetting(key as keyof EbaySettings, event.target.value as any)}
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
                  >
                    <option value="">Select policy...</option>
                    {savedValue && !savedValueIsListed && (
                      <option value={savedValue}>Saved policy ({savedValue})</option>
                    )}
                    {policyOptions.map((policy) => (
                      <option key={policy.id} value={policy.id}>
                        {policy.name} ({policy.id})
                      </option>
                    ))}
                  </select>
                </label>
              )
            })}

            <label className="mt-4 block">
              <span className="mb-1 block text-sm font-bold text-neutral-300">Merchant location key</span>
              <input
                value={settings.merchant_location_key}
                onChange={(event) => updateSetting('merchant_location_key', event.target.value as any)}
                placeholder="default"
                className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2"
              />
              <span className="mt-2 block text-xs font-bold leading-5 text-neutral-500">
                This must match an eBay Inventory API merchant location key, for example default. It is not the same
                as your app warehouse/shop location display name.
              </span>
            </label>
          </section>

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 xl:col-span-2">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Condition Mapping</h2>
                <p className="mt-1 text-sm text-neutral-400">
                  Map the exact SKU edit condition values to eBay Inventory API condition enums. SKU edit values are not changed.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  updateSetting('condition_mappings', [...settings.condition_mappings, emptyConditionMapping()] as any)
                }
                className="rounded-lg bg-green-600 px-3 py-2 text-xs font-black text-white hover:bg-green-500"
              >
                Add condition
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {settings.condition_mappings.map((mapping, index) => (
                <div key={`${mapping.app_condition}-${index}`} className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                    <label>
                      <span className="mb-1 block text-xs font-bold uppercase text-neutral-500">SKU condition</span>
                      <input
                        value={mapping.app_condition}
                        onChange={(event) => updateConditionMapping(index, { app_condition: event.target.value })}
                        className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                      />
                    </label>

                    <label>
                      <span className="mb-1 block text-xs font-bold uppercase text-neutral-500">eBay enum</span>
                      <select
                        value={mapping.ebay_condition}
                        onChange={(event) => updateConditionMapping(index, { ebay_condition: event.target.value })}
                        className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                      >
                        <option value="">Select...</option>
                        {mapping.ebay_condition && !ebayConditionOptions.includes(mapping.ebay_condition) && (
                          <option value={mapping.ebay_condition}>{mapping.ebay_condition}</option>
                        )}
                        {ebayConditionOptions.map((condition) => (
                          <option key={condition} value={condition}>
                            {condition}
                          </option>
                        ))}
                      </select>
                    </label>

                    <button
                      type="button"
                      onClick={() =>
                        updateSetting(
                          'condition_mappings',
                          settings.condition_mappings.filter((_, conditionIndex) => conditionIndex !== index) as any
                        )
                      }
                      className="self-end rounded-lg bg-red-700 px-3 py-2 text-xs font-black text-white hover:bg-red-600"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 xl:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Category + Item Specific Mapping</h2>
                <p className="mt-1 text-sm text-neutral-400">
                  Map app categories to editable eBay leaf category defaults. Item-specific overrides still win.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setShowCategoryMappings((value) => !value)}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-500"
                >
                  {showCategoryMappings ? 'Close' : 'Configure'}
                </button>

                {showCategoryMappings && (
                  <button
                    type="button"
                    onClick={() =>
                      updateSetting('category_mappings', [...settings.category_mappings, emptyCategoryMapping()] as any)
                    }
                    className="rounded-lg bg-green-600 px-3 py-2 text-xs font-black text-white hover:bg-green-500"
                  >
                    Add mapping
                  </button>
                )}
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm font-bold text-neutral-300">
              {settings.category_mappings.length} mapping(s) available. Mapped categories are used before live eBay suggestions.
            </div>

            {showCategoryMappings && (
            <div className="mt-4 space-y-3">
              {settings.category_mappings.length === 0 ? (
                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-sm font-bold text-neutral-400">
                  No category mappings yet.
                </div>
              ) : (
                settings.category_mappings.map((mapping, index) => {
                  const metadata = metadataByCategory[mapping.ebay_category_id]
                  const requiredAspects = (metadata?.aspects || []).filter(
                    (aspect: any) => aspect?.aspectConstraint?.aspectRequired
                  )
                  const conditions = metadata?.conditionPolicies?.[0]?.itemConditions || []

                  return (
                    <div key={`${mapping.app_category}-${mapping.app_sub_category}-${index}`} className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                      <div className="grid gap-2 xl:grid-cols-[1fr_1fr_120px_110px_130px_minmax(180px,1.4fr)_150px_auto]">
                        <label>
                          <span className="mb-1 block text-xs font-bold uppercase text-neutral-500">App category</span>
                          <input
                            value={mapping.app_category}
                            onChange={(event) => updateCategoryMapping(index, { app_category: event.target.value })}
                            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                          />
                        </label>

                        <label>
                          <span className="mb-1 block text-xs font-bold uppercase text-neutral-500">Sub category</span>
                          <input
                            value={mapping.app_sub_category}
                            onChange={(event) => updateCategoryMapping(index, { app_sub_category: event.target.value })}
                            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                          />
                        </label>

                        <label>
                          <span className="mb-1 block text-xs font-bold uppercase text-neutral-500">Item type</span>
                          <input
                            value={mapping.item_type || ''}
                            onChange={(event) => updateCategoryMapping(index, { item_type: event.target.value })}
                            placeholder="Any"
                            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                          />
                        </label>

                        <label>
                          <span className="mb-1 block text-xs font-bold uppercase text-neutral-500">Gender</span>
                          <input
                            value={mapping.gender || ''}
                            onChange={(event) => updateCategoryMapping(index, { gender: event.target.value })}
                            placeholder="Any"
                            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                          />
                        </label>

                        <label>
                          <span className="mb-1 block text-xs font-bold uppercase text-neutral-500">eBay category ID</span>
                          <input
                            value={mapping.ebay_category_id}
                            onChange={(event) => updateCategoryMapping(index, { ebay_category_id: event.target.value })}
                            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                          />
                        </label>

                        <label>
                          <span className="mb-1 block text-xs font-bold uppercase text-neutral-500">Category name</span>
                          <input
                            value={mapping.ebay_category_name}
                            onChange={(event) => updateCategoryMapping(index, { ebay_category_name: event.target.value })}
                            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                          />
                        </label>

                        <label>
                          <span className="mb-1 block text-xs font-bold uppercase text-neutral-500">Condition</span>
                          <select
                            value={mapping.default_condition}
                            onChange={(event) => updateCategoryMapping(index, { default_condition: event.target.value })}
                            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                          >
                            <option value="">Use item condition</option>
                            <option value="New with tags">New with tags</option>
                            <option value="New without tags">New without tags</option>
                            <option value="Excellent">Excellent</option>
                            <option value="Good">Good</option>
                            <option value="Fair">Fair</option>
                          </select>
                        </label>

                        <div className="flex items-end gap-2">
                          <button
                            type="button"
                            onClick={() => pullCategoryMetadata(mapping)}
                            disabled={metadataLoadingCategory === mapping.ebay_category_id}
                            className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-500 disabled:opacity-40"
                          >
                            {metadataLoadingCategory === mapping.ebay_category_id ? 'Loading' : 'Reqs'}
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              updateSetting(
                                'category_mappings',
                                settings.category_mappings.filter((_, mappingIndex) => mappingIndex !== index) as any
                              )
                            }
                            className="rounded-lg bg-red-700 px-3 py-2 text-xs font-black text-white hover:bg-red-600"
                          >
                            Remove
                          </button>
                        </div>
                      </div>

                      {metadata && (
                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
                          <div>
                            <h3 className="mb-2 text-sm font-black text-neutral-300">Required aspects</h3>
                            {requiredAspects.length === 0 ? (
                              <p className="text-sm font-bold text-neutral-500">No required aspects returned.</p>
                            ) : (
                              <div className="space-y-2">
                                {requiredAspects.map((aspect: any) => {
                                  const aspectName = aspect.localizedAspectName
                                  return (
                                    <label key={aspectName} className="grid gap-2 rounded-lg bg-neutral-900 p-3 md:grid-cols-[1fr_1fr]">
                                      <span className="text-sm font-black">{aspectName}</span>
                                      <input
                                        value={mapping.aspect_mapping[aspectName] || ''}
                                        onChange={(event) => updateAspectMapping(index, aspectName, event.target.value)}
                                        placeholder="app field or fixed value"
                                        className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
                                      />
                                    </label>
                                  )
                                })}
                              </div>
                            )}
                          </div>

                          <div>
                            <h3 className="mb-2 text-sm font-black text-neutral-300">Allowed conditions</h3>
                            <div className="flex flex-wrap gap-2">
                              {conditions.map((condition: any) => (
                                <span key={condition.conditionId} className="rounded-lg bg-neutral-900 px-3 py-2 text-xs font-bold text-neutral-300">
                                  {condition.conditionDescription} ({condition.conditionId})
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
            )}
          </section>

          <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 xl:col-span-2">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Shadow Listing Readiness</h2>
                <p className="mt-1 text-sm text-neutral-400">
                  Test category matching, mandatory item specifics, condition, images, price and stock without publishing.
                </p>
              </div>

              {readinessMessage && (
                <div
                  className={`rounded-xl border px-4 py-3 text-sm font-black ${
                    readinessMessageType === 'success'
                      ? 'border-green-700 bg-green-950 text-green-200'
                      : readinessMessageType === 'error'
                        ? 'border-red-700 bg-red-950 text-red-200'
                        : 'border-blue-700 bg-blue-950 text-blue-200'
                  }`}
                >
                  {readinessMessage}
                </div>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <div className="space-y-4">
                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                  <label>
                    <span className="mb-1 block text-sm font-bold text-neutral-300">
                      eBay category search
                    </span>
                    <div className="flex gap-2">
                      <input
                        value={categorySearch}
                        onChange={(event) => setCategorySearch(event.target.value)}
                        className="min-w-0 flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2"
                      />
                      <button
                        type="button"
                        onClick={searchCategories}
                        className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-500"
                      >
                        Search
                      </button>
                    </div>
                  </label>

                  <div className="mt-3 space-y-2">
                    {categorySuggestions.slice(0, 8).map((suggestion: any) => {
                      const category = suggestion.category || {}
                      const ancestors = Array.isArray(suggestion.categoryTreeNodeAncestors)
                        ? suggestion.categoryTreeNodeAncestors
                        : []
                      const path = ancestors
                        .slice()
                        .reverse()
                        .map((ancestor: any) => ancestor.categoryName)
                        .filter(Boolean)
                        .join(' > ')

                      return (
                        <button
                          key={category.categoryId}
                          type="button"
                          onClick={() => runReadinessCheck(category.categoryId)}
                          className="block w-full rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-left hover:border-blue-500"
                        >
                          <span className="block text-sm font-black text-white">
                            {category.categoryName} ({category.categoryId})
                          </span>
                          {path && <span className="mt-1 block text-xs text-neutral-500">{path}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                  <label>
                    <span className="mb-1 block text-sm font-bold text-neutral-300">SKU readiness check</span>
                    <div className="flex gap-2">
                      <input
                        value={readinessSku}
                        onChange={(event) => setReadinessSku(event.target.value)}
                        className="min-w-0 flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2"
                      />
                      <button
                        type="button"
                        onClick={() => runReadinessCheck()}
                        className="rounded-xl bg-green-600 px-4 py-2 text-sm font-black text-white hover:bg-green-500"
                      >
                        Check
                      </button>
                    </div>
                  </label>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={saveShadowDraft}
                      className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-500"
                    >
                      Save Shadow Draft
                    </button>

                    <button
                      type="button"
                      onClick={publishSandboxDraft}
                      disabled={settings.environment !== 'sandbox'}
                      className="rounded-xl bg-red-700 px-4 py-2 text-sm font-black text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Publish to eBay Sandbox
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                {!readinessResult ? (
                  <p className="text-sm font-bold text-neutral-500">
                    Run a readiness check to preview the exact listing data and blockers.
                  </p>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-xl font-black text-white">{readinessResult.sku}</h3>
                        <p className="text-sm text-neutral-400">
                          Category {readinessResult.category_id || 'not mapped'} ·{' '}
                          {readinessResult.category_metadata?.required_aspect_count || 0} required specifics
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-4 py-2 text-xs font-black uppercase ${
                          readinessResult.ready
                            ? 'bg-green-600 text-white'
                            : 'bg-red-700 text-white'
                        }`}
                      >
                        {readinessResult.ready ? 'Ready' : 'Blocked'}
                      </span>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
                      {(readinessResult.checks || []).map((check: any) => (
                        <div
                          key={check.key}
                          className={`rounded-lg border p-3 ${
                            check.ok
                              ? 'border-green-900 bg-green-950/40'
                              : 'border-red-900 bg-red-950/40'
                          }`}
                        >
                          <p className="text-sm font-black text-white">{check.label}</p>
                          <p className="mt-1 text-xs text-neutral-300">{check.message}</p>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                      <p className="text-sm font-black text-white">Draft preview</p>
                      <p className="mt-2 text-sm text-neutral-300">
                        {readinessResult.listing_draft?.title || 'No title'}
                      </p>
                      <p className="mt-1 text-xs text-neutral-500">
                        £{Number(readinessResult.listing_draft?.price || 0).toFixed(2)} · Qty{' '}
                        {readinessResult.listing_draft?.quantity || 0} ·{' '}
                        {readinessResult.listing_draft?.image_count || 0} image(s)
                      </p>
                    </div>

                    {readinessResult.listing_draft?.description_html && (
                      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                        <p className="text-sm font-black text-white">HTML description preview</p>
                        <div
                          className="mt-3 max-h-[520px] overflow-auto rounded-lg bg-white p-4"
                          dangerouslySetInnerHTML={{ __html: readinessResult.listing_draft.description_html }}
                        />
                      </div>
                    )}

                    {publishResult && (
                      <div className="rounded-lg border border-blue-900 bg-blue-950/40 p-3">
                        <p className="text-sm font-black text-white">Sandbox publish result</p>
                        <p className="mt-2 text-xs font-bold text-blue-200">
                          Offer {publishResult.offer_id || 'unknown'}
                          {publishResult.listing_id ? ` - Listing ${publishResult.listing_id}` : ''}
                        </p>
                        {Array.isArray(publishResult.publish?.warnings) && publishResult.publish.warnings.length > 0 ? (
                          <div className="mt-3 space-y-2">
                            {publishResult.publish.warnings.map((warning: any, warningIndex: number) => (
                              <div
                                key={`${warning?.errorId || 'warning'}-${warningIndex}`}
                                className="rounded-lg border border-yellow-800 bg-yellow-950/40 p-2"
                              >
                                <p className="text-xs font-black text-yellow-100">
                                  {warning?.message || 'eBay warning'}
                                </p>
                                {warning?.longMessage && (
                                  <p className="mt-1 text-xs text-yellow-200">{warning.longMessage}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-xs font-bold text-neutral-400">No eBay warnings returned.</p>
                        )}
                      </div>
                    )}

                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
    </StaffPermissionGate>
  )
}

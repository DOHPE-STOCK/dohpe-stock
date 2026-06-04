import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getEbayIntegrationConfig } from '@/lib/ebayIntegrationSettings'
import { ebayRequest } from '@/lib/ebayApi'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type PolicyResult = {
  id: string
  reused: boolean
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

function policyName(kind: string) {
  return `DOHPE Sandbox ${kind}`
}

async function optInToBusinessPolicies(settings: any) {
  try {
    await ebayRequest(settings, '/sell/account/v1/program/opt_in', {
      method: 'POST',
      body: JSON.stringify({ programType: 'SELLING_POLICY_MANAGEMENT' }),
    })

    return { ok: true, skipped: false, message: 'Opted in to business policies.' }
  } catch (error: any) {
    const message = text(error?.message)

    if (
      message.toLowerCase().includes('already') ||
      message.toLowerCase().includes('enrolled') ||
      message.toLowerCase().includes('opted')
    ) {
      return { ok: true, skipped: true, message }
    }

    throw error
  }
}

async function findExistingPolicy(settings: any, endpoint: string, arrayKey: string, name: string, idKey: string) {
  const data = await ebayRequest(
    settings,
    `${endpoint}?marketplace_id=${encodeURIComponent(settings.marketplace_id)}`
  ).catch(() => null)
  const policies = Array.isArray(data?.[arrayKey]) ? data[arrayKey] : []
  const existing = policies.find((policy: any) => text(policy.name) === name)

  return text(existing?.[idKey])
}

async function createOrReusePolicy(params: {
  settings: any
  endpoint: string
  arrayKey: string
  idKey: string
  name: string
  body: Record<string, any>
}): Promise<PolicyResult> {
  const existing = await findExistingPolicy(
    params.settings,
    params.endpoint,
    params.arrayKey,
    params.name,
    params.idKey
  )

  if (existing) return { id: existing, reused: true }

  let created: any

  try {
    created = await ebayRequest(params.settings, params.endpoint, {
      method: 'POST',
      body: JSON.stringify(params.body),
    })
  } catch (error: any) {
    const duplicateId = extractPolicyIdFromDuplicateError(text(error?.message), params.idKey)

    if (duplicateId) return { id: duplicateId, reused: true }

    throw error
  }
  const id = text(created?.[params.idKey])

  if (!id) {
    throw new Error(`eBay did not return ${params.idKey} for ${params.name}: ${JSON.stringify(created)}`)
  }

  return { id, reused: false }
}

function extractPolicyIdFromDuplicateError(message: string, idKey: string) {
  const idMatch = message.match(/"DuplicateProfileId","value":"([^"]+)"/)
  if (idMatch?.[1]) return idMatch[1]

  const keyMatch = message.match(new RegExp(`"${idKey}","value":"([^"]+)"`))
  return keyMatch?.[1] || ''
}

function fulfilmentPolicyBody(settings: any, name: string) {
  return {
    name,
    marketplaceId: settings.marketplace_id,
    categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES', default: false }],
    handlingTime: { value: 1, unit: 'DAY' },
    shipToLocations: {
      regionIncluded: [
        {
          regionName: 'United Kingdom',
          regionType: 'COUNTRY',
          regionId: 'GB',
        },
      ],
    },
    shippingOptions: [
      {
        optionType: 'DOMESTIC',
        costType: 'FLAT_RATE',
        shippingServices: [
          {
            sortOrder: 1,
            shippingCarrierCode: 'RoyalMail',
            shippingServiceCode: 'UK_RoyalMailSecondClassStandard',
            shippingCost: { currency: 'GBP', value: '0.00' },
            additionalShippingCost: { currency: 'GBP', value: '0.00' },
            freeShipping: true,
          },
        ],
      },
    ],
  }
}

export async function POST() {
  try {
    const supabase = getSupabaseAdmin()
    const config = await getEbayIntegrationConfig(supabase)
    const settings = config.settings

    if (settings.environment !== 'sandbox') {
      return NextResponse.json(
        { ok: false, message: 'Default policy creation is currently Sandbox-only.' },
        { status: 403 }
      )
    }

    if (!config.id) {
      return NextResponse.json(
        { ok: false, message: 'No eBay integration settings row found.' },
        { status: 404 }
      )
    }

    const optIn = await optInToBusinessPolicies(settings)
    const paymentName = policyName('Payment Policy')
    const returnName = policyName('Return Policy')
    const fulfilmentName = policyName('Fulfilment Policy GB Shipping')

    const payment = await createOrReusePolicy({
      settings,
      endpoint: '/sell/account/v1/payment_policy',
      arrayKey: 'paymentPolicies',
      idKey: 'paymentPolicyId',
      name: paymentName,
      body: {
        name: paymentName,
        marketplaceId: settings.marketplace_id,
        categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
        immediatePay: true,
      },
    })

    const returns = await createOrReusePolicy({
      settings,
      endpoint: '/sell/account/v1/return_policy',
      arrayKey: 'returnPolicies',
      idKey: 'returnPolicyId',
      name: returnName,
      body: {
        name: returnName,
        marketplaceId: settings.marketplace_id,
        categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
        returnsAccepted: true,
        returnPeriod: { value: 30, unit: 'DAY' },
        refundMethod: 'MONEY_BACK',
        returnMethod: 'REPLACEMENT',
        returnShippingCostPayer: 'BUYER',
      },
    })

    const fulfilment = await createOrReusePolicy({
      settings,
      endpoint: '/sell/account/v1/fulfillment_policy',
      arrayKey: 'fulfillmentPolicies',
      idKey: 'fulfillmentPolicyId',
      name: fulfilmentName,
      body: fulfilmentPolicyBody(settings, fulfilmentName),
    })


    const nextSettings = {
      ...settings,
      payment_policy_id: payment.id,
      fulfillment_policy_id: fulfilment.id,
      return_policy_id: returns.id,
      use_business_policies: true,
    }

    const { error } = await supabase
      .from('integration_settings')
      .update({
        settings: nextSettings,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', config.id)

    if (error) throw new Error(error.message)

    return NextResponse.json({
      ok: true,
      opt_in: optIn,
      policies: {
        payment,
        fulfillment: fulfilment,
        return: returns,
      },
    })
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: error.message || 'Could not create eBay Sandbox default policies.' },
      { status: 500 }
    )
  }
}

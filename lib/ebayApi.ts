import { EbaySettings } from '@/lib/ebayIntegrationSettings'

function ebayBaseUrl(settings: EbaySettings) {
  return settings.environment === 'sandbox'
    ? 'https://api.sandbox.ebay.com'
    : 'https://api.ebay.com'
}

function ebayAuthBaseUrl(settings: EbaySettings) {
  return settings.environment === 'sandbox'
    ? 'https://auth.sandbox.ebay.com'
    : 'https://auth.ebay.com'
}

function ebayIdentityBaseUrl(settings?: EbaySettings) {
  return settings?.environment === 'sandbox'
    ? 'https://api.sandbox.ebay.com'
    : 'https://api.ebay.com'
}

function ebayScopes() {
  return [
    'https://api.ebay.com/oauth/api_scope',
    'https://api.ebay.com/oauth/api_scope/sell.account',
    'https://api.ebay.com/oauth/api_scope/sell.inventory',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  ]
}

function text(value: any) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function ebayClientCredentials() {
  const clientId = process.env.EBAY_CLIENT_ID || process.env.EBAY_APP_ID
  const clientSecret = process.env.EBAY_CLIENT_SECRET || process.env.EBAY_CERT_ID

  if (!clientId || !clientSecret) {
    throw new Error('Missing eBay OAuth environment variables: EBAY_CLIENT_ID and EBAY_CLIENT_SECRET.')
  }

  return { clientId, clientSecret }
}

export function getEbayAuthorizeUrl(settings: EbaySettings, state: string) {
  const { clientId } = ebayClientCredentials()
  const ruName = process.env.EBAY_RUNAME

  if (!ruName) {
    throw new Error('Missing eBay OAuth environment variable: EBAY_RUNAME.')
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: ruName,
    response_type: 'code',
    scope: ebayScopes().join(' '),
    state,
  })

  return `${ebayAuthBaseUrl(settings)}/oauth2/authorize?${params.toString()}`
}

export async function exchangeEbayCodeForTokens(settings: EbaySettings, code: string) {
  const { clientId, clientSecret } = ebayClientCredentials()
  const ruName = process.env.EBAY_RUNAME

  if (!ruName) {
    throw new Error('Missing eBay OAuth environment variable: EBAY_RUNAME.')
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: ruName,
  })

  const response = await fetch(`${ebayIdentityBaseUrl(settings)}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  const data = await response.json().catch(() => null)

  if (!response.ok || !data?.refresh_token) {
    throw new Error(`eBay OAuth code exchange failed: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  }

  return data as {
    access_token: string
    expires_in: number
    refresh_token: string
    refresh_token_expires_in?: number
    token_type: string
  }
}

export async function getEbayAccessToken(settings?: EbaySettings) {
  const { clientId, clientSecret } = ebayClientCredentials()
  const refreshToken = settings?.oauth_refresh_token || process.env.EBAY_REFRESH_TOKEN

  if (!refreshToken) {
    throw new Error('Missing eBay OAuth refresh token. Connect eBay or set EBAY_REFRESH_TOKEN.')
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: ebayScopes().join(' '),
  })

  const response = await fetch(`${ebayIdentityBaseUrl(settings)}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  const data = await response.json().catch(() => null)

  if (!response.ok || !data?.access_token) {
    throw new Error(`eBay OAuth failed: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  }

  return data.access_token as string
}

export async function ebayRequest(settings: EbaySettings, path: string, options: RequestInit = {}) {
  const token = await getEbayAccessToken(settings)
  const response = await fetch(`${ebayBaseUrl(settings)}${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'accept-language': settings.locale || 'en-GB',
      'x-ebay-c-marketplace-id': settings.marketplace_id || 'EBAY_GB',
      ...(options.headers || {}),
    },
  })

  const responseText = await response.text()
  let data: any = null

  try {
    data = responseText ? JSON.parse(responseText) : null
  } catch {
    data = responseText
  }

  if (!response.ok) {
    throw new Error(`${path} failed: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  }

  return data
}

export async function getDefaultCategoryTreeId(settings: EbaySettings) {
  const data = await ebayRequest(
    settings,
    `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${encodeURIComponent(
      settings.marketplace_id || 'EBAY_GB'
    )}`
  )

  return text(data?.categoryTreeId)
}

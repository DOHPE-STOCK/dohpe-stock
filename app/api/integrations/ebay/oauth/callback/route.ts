import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getEbayIntegrationConfig } from '@/lib/ebayIntegrationSettings'
import { exchangeEbayCodeForTokens, getEbayUserProfile } from '@/lib/ebayApi'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) throw new Error('Missing Supabase admin environment variables.')
  return createClient(url, serviceKey)
}

function html(title: string, body: string, ok = true) {
  return new NextResponse(
    `<!doctype html>
      <html>
        <head>
          <title>${title}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            body { background: #0a0a0a; color: white; font-family: Arial, sans-serif; padding: 32px; }
            main { max-width: 680px; margin: 0 auto; border: 1px solid #262626; border-radius: 18px; background: #171717; padding: 24px; }
            h1 { margin: 0 0 12px; font-size: 26px; }
            p { color: #d4d4d4; line-height: 1.5; }
            a { color: ${ok ? '#86efac' : '#fca5a5'}; font-weight: 800; }
          </style>
        </head>
        <body>
          <main>
            <h1>${title}</h1>
            <p>${body}</p>
            <p><a href="/settings/integrations/ebay">Back to eBay settings</a></p>
          </main>
        </body>
      </html>`,
    {
      status: ok ? 200 : 400,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }
  )
}

export async function GET(request: NextRequest) {
  try {
    const error = request.nextUrl.searchParams.get('error')
    const code = request.nextUrl.searchParams.get('code')

    if (error) {
      return html('eBay connection declined', error, false)
    }

    if (!code) {
      return html('eBay connection failed', 'No OAuth code was returned by eBay.', false)
    }

    const supabase = getSupabaseAdmin()
    const config = await getEbayIntegrationConfig(supabase)
    const tokens = await exchangeEbayCodeForTokens(config.settings, code)
    const profile = await getEbayUserProfile(config.settings, tokens.access_token).catch(() => null)
    const accountName =
      profile?.businessAccount?.doingBusinessAs ||
      profile?.businessAccount?.name ||
      profile?.username ||
      profile?.userId ||
      null

    const nextSettings = {
      ...config.settings,
      oauth_refresh_token: tokens.refresh_token,
      oauth_refresh_token_saved_at: new Date().toISOString(),
      ebay_user_id: profile?.userId || null,
      ebay_username: profile?.username || null,
      ebay_account_name: accountName,
      ebay_account_type: profile?.accountType || null,
    }

    await supabase
      .from('integration_settings')
      .update({
        enabled: true,
        connection_status: 'connected',
        last_synced_at: new Date().toISOString(),
        last_error: null,
        settings: nextSettings,
        updated_at: new Date().toISOString(),
      })
      .eq('channel', 'ebay')

    return html(
      'eBay connected',
      'The eBay refresh token has been saved to the eBay integration settings. You can now test the eBay connection.'
    )
  } catch (error: any) {
    return html('eBay connection failed', error.message || 'Unknown eBay OAuth error.', false)
  }
}

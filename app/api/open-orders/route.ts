import { NextResponse } from 'next/server'
import { getSupabaseAdmin, requireCompanyAccess } from '@/lib/serverTenant'

export const dynamic = 'force-dynamic'

const OPEN_STATUSES = ['open', 'reserved', 'picking', 'part_picked', 'picked', 'on_hold', 'failed']

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status })
}

function text(value: unknown) {
  return String(value || '').trim()
}

function arrayOfText(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : []
}

function isMissingSchema(error: any) {
  const code = String(error?.code || '')
  const message = String(error?.message || '').toLowerCase()
  return code === '42P01' || code === '42703' || message.includes('does not exist')
}

function matchesSearch(order: any, lines: any[], search: string) {
  if (!search) return true
  const haystack = [
    order.external_order_number,
    order.external_order_id,
    order.buyer_name,
    order.buyer_email,
    order.buyer_username,
    order.shipping_country,
    order.channel,
    order.postal_service_name,
    order.tracking_number,
    ...(order.tags || []),
    ...(order.identifiers || []).map((identifier: any) => identifier?.label || identifier?.key),
    ...lines.flatMap((line) => [line.sku, line.external_line_id, line.title, line.barcode]),
  ]
    .map((value) => String(value || '').toLowerCase())
    .join(' ')

  return haystack.includes(search.toLowerCase())
}

function valueAtPath(source: any, path: string) {
  return path.split('.').reduce((current, key) => current?.[key], source)
}

function ruleMatchesOrder(rule: any, order: any) {
  const condition = rule?.condition || {}
  const field = text(condition.field)
  if (!field) return false

  const actual = valueAtPath(order, field)
  const operator = text(condition.operator || 'equals')
  const expected = condition.value

  if (operator === 'exists') return actual !== null && actual !== undefined && text(actual) !== ''
  if (operator === 'not_exists') return actual === null || actual === undefined || text(actual) === ''
  if (operator === 'contains') return text(actual).toLowerCase().includes(text(expected).toLowerCase())
  if (operator === 'not_equals') return text(actual).toLowerCase() !== text(expected).toLowerCase()
  return text(actual).toLowerCase() === text(expected).toLowerCase()
}

export async function GET(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager', 'member', 'viewer'])
  if (!access.ok) return jsonError(access.message, access.status)

  const url = new URL(request.url)
  const search = text(url.searchParams.get('search'))
  const statusParam = text(url.searchParams.get('statuses') || url.searchParams.get('status'))
  const location = text(url.searchParams.get('location'))
  const channel = text(url.searchParams.get('channel'))
  const picker = text(url.searchParams.get('picker'))
  const scope = text(url.searchParams.get('scope')) === 'managed' ? 'managed' : 'active'
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 200), 25), 500)
  const statuses = statusParam
    ? statusParam.split(',').map(text).filter(Boolean)
    : OPEN_STATUSES

  const supabase = getSupabaseAdmin()
  let companyIds = [access.company.id]
  const companiesById = new Map<string, any>([[access.company.id, access.company]])

  if (scope === 'managed') {
    const membershipsResult = await supabase
      .from('company_memberships')
      .select('company_id, status, company:companies(id, name, slug, access_state, billing_exempt, subscription_status)')
      .eq('user_id', access.user.id)
      .eq('status', 'active')

    if (membershipsResult.error) return jsonError(membershipsResult.error.message, 500)

    companyIds = []
    for (const membership of membershipsResult.data || []) {
      const company = Array.isArray(membership.company) ? membership.company[0] : membership.company
      if (!membership.company_id || !company) continue
      companyIds.push(String(membership.company_id))
      companiesById.set(String(membership.company_id), company)
    }

    if (companyIds.length === 0) companyIds = [access.company.id]
  }

  let views: any[] = []
  const viewsResult = await supabase
    .from('open_order_views')
    .select('*')
    .eq('company_id', access.company.id)
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false })

  if (viewsResult.error && !isMissingSchema(viewsResult.error)) {
    return jsonError(viewsResult.error.message, 500)
  }
  if (!viewsResult.error) views = viewsResult.data || []

  let symbolRules: any[] = []
  const symbolRulesResult = await supabase
    .from('open_order_symbol_rules')
    .select('*')
    .in('company_id', companyIds)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (!symbolRulesResult.error) symbolRules = symbolRulesResult.data || []

  let ordersQuery = supabase
    .from('loopbase_orders')
    .select('*')
    .in('company_id', companyIds)
    .in('order_status', statuses)
    .order('ordered_at', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (location && location !== 'all') ordersQuery = ordersQuery.eq('order_location_name', location)
  if (channel && channel !== 'all') ordersQuery = ordersQuery.eq('channel', channel)
  if (picker && picker !== 'all') ordersQuery = ordersQuery.eq('assigned_picker_staff_id', picker)

  const ordersResult = await ordersQuery
  if (ordersResult.error) {
    if (isMissingSchema(ordersResult.error)) {
      return jsonError('Open Orders database tables are not migrated yet. Run sql/2026-07-27_open_orders_capability_foundation.sql after the Loopbase order foundation SQL.', 409)
    }
    return jsonError(ordersResult.error.message, 500)
  }

  const orders = ordersResult.data || []
  const orderIds = orders.map((order) => order.id).filter(Boolean)
  const itemIds = new Set<string>()

  let lines: any[] = []
  if (orderIds.length > 0) {
    const linesResult = await supabase
      .from('loopbase_order_lines')
      .select('*')
      .in('company_id', companyIds)
      .in('order_id', orderIds)
      .order('created_at', { ascending: true })

    if (linesResult.error) return jsonError(linesResult.error.message, 500)
    lines = linesResult.data || []
    for (const line of lines) {
      if (line.item_id) itemIds.add(String(line.item_id))
    }
  }

  const itemsById = new Map<string, any>()
  if (itemIds.size > 0) {
    const itemsResult = await supabase
      .from('items')
      .select('id, company_id, sku, barcode, title, basic_title, final_title, brand, reporting_category, sub_category')
      .in('company_id', companyIds)
      .in('id', Array.from(itemIds))

    if (!itemsResult.error) {
      for (const item of itemsResult.data || []) itemsById.set(`${item.company_id || ''}:${item.id}`, item)
    }
  }

  const identifiersByOrderId = new Map<string, any[]>()
  if (orderIds.length > 0) {
    const identifiersResult = await supabase
      .from('loopbase_order_identifiers')
      .select('*')
      .in('company_id', companyIds)
      .in('order_id', orderIds)
      .eq('is_active', true)
      .order('created_at', { ascending: true })

    if (!identifiersResult.error) {
      for (const identifier of identifiersResult.data || []) {
        const key = String(identifier.order_id)
        identifiersByOrderId.set(key, [...(identifiersByOrderId.get(key) || []), identifier])
      }
    }
  }

  const linesByOrderId = new Map<string, any[]>()
  for (const line of lines) {
    const item = line.item_id ? itemsById.get(`${line.company_id || ''}:${line.item_id}`) : null
    const enrichedLine = {
      ...line,
      title: item?.final_title || item?.title || item?.basic_title || line.sku,
      barcode: item?.barcode || null,
      brand: item?.brand || null,
      category: item?.reporting_category || null,
    }
    const key = String(line.order_id)
    linesByOrderId.set(key, [...(linesByOrderId.get(key) || []), enrichedLine])
  }

  let enrichedOrders = orders.map((order) => ({
    ...order,
    company: companiesById.get(String(order.company_id)) || null,
    lines: linesByOrderId.get(String(order.id)) || [],
    order_identifiers: identifiersByOrderId.get(String(order.id)) || [],
  }))

  enrichedOrders = enrichedOrders.map((order) => ({
    ...order,
    custom_symbols: symbolRules
      .filter((rule) => String(rule.company_id) === String(order.company_id) && ruleMatchesOrder(rule, order))
      .slice(0, 6)
      .map((rule) => ({
        key: rule.symbol_key,
        label: rule.name,
        title: rule.name,
        icon: rule.icon,
        colour: rule.colour,
        active: true,
      })),
  }))

  if (search) {
    enrichedOrders = enrichedOrders.filter((order) => matchesSearch(order, order.lines, search))
  }

  const [locationsResult, staffResult, pickwavesResult] = await Promise.all([
    supabase
      .from('locations')
      .select('id, name, label, is_active')
      .in('company_id', companyIds)
      .eq('is_active', true)
      .order('name', { ascending: true }),
    supabase
      .from('staff_users')
      .select('id, name, role, is_active')
      .eq('company_id', access.company.id)
      .eq('is_active', true)
      .order('name', { ascending: true }),
    supabase
      .from('loopbase_pickwaves')
      .select('*')
      .eq('company_id', access.company.id)
      .in('status', ['to_pick', 'picking', 'packing'])
      .order('updated_at', { ascending: false })
      .limit(30),
  ])

  return NextResponse.json({
    ok: true,
    company: access.company,
    views,
    orders: enrichedOrders,
    locations: locationsResult.error ? [] : locationsResult.data || [],
    staff: staffResult.error ? [] : staffResult.data || [],
    pickwaves: pickwavesResult.error ? [] : pickwavesResult.data || [],
    symbol_rules: symbolRules,
    channels: Array.from(new Set(enrichedOrders.map((order) => text(order.channel)).filter(Boolean))).sort(),
  })
}

export async function POST(request: Request) {
  const access = await requireCompanyAccess(request, ['owner', 'admin', 'manager'])
  if (!access.ok) return jsonError(access.message, access.status)

  const body = await request.json().catch(() => null)
  const action = text(body?.action)
  if (action !== 'save_view') return jsonError('Unsupported Open Orders action.', 400)

  const viewKey = text(body?.view_key || body?.viewKey || `custom-${Date.now()}`)
  const name = text(body?.name) || 'Custom View'
  const now = new Date().toISOString()
  const columns = Array.isArray(body?.columns) ? body.columns : []
  const filters = body?.filters && typeof body.filters === 'object' ? body.filters : {}
  const sorting = Array.isArray(body?.sorting) ? body.sorting : []
  const hotButtons = Array.isArray(body?.hot_buttons || body?.hotButtons)
    ? body.hot_buttons || body.hotButtons
    : []

  const supabase = getSupabaseAdmin()
  const existing = await supabase
    .from('open_order_views')
    .select('id')
    .eq('company_id', access.company.id)
    .eq('view_key', viewKey)
    .maybeSingle()

  if (existing.error && !isMissingSchema(existing.error)) {
    return jsonError(existing.error.message, 500)
  }

  if (existing.data?.id) {
    const { data, error } = await supabase
      .from('open_order_views')
      .update({
        name,
        columns,
        filters,
        sorting,
        hot_buttons: hotButtons,
        updated_at: now,
      })
      .eq('company_id', access.company.id)
      .eq('id', existing.data.id)
      .select('*')
      .single()

    if (error) return jsonError(error.message, 500)
    return NextResponse.json({ ok: true, view: data })
  }

  const { data, error } = await supabase
    .from('open_order_views')
    .insert({
      company_id: access.company.id,
      name,
      view_key: viewKey,
      columns,
      filters,
      sorting,
      hot_buttons: hotButtons,
      created_by_user_id: access.user.id,
      updated_at: now,
    })
    .select('*')
    .single()

  if (error) return jsonError(error.message, 500)
  return NextResponse.json({ ok: true, view: data })
}

import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/serverTenant'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function failure(status: number, message: string) {
  return NextResponse.json({ ok: false, message }, { status })
}

function text(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function tokenHash(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function getBearerToken(request: Request) {
  const header = request.headers.get('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

async function loadSourceByToken(token: string) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('photo_sources')
    .select('id, company_id, station_id, name, enabled, token_revoked_at')
    .eq('token_hash', tokenHash(token))
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data || data.enabled === false || data.token_revoked_at) return null
  return data
}

export async function GET(request: Request) {
  try {
    const token = getBearerToken(request)
    if (!token) return failure(401, 'Missing photo source token.')

    const source = await loadSourceByToken(token)
    if (!source) return failure(401, 'Invalid photo source token.')

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('photo_worker_commands')
      .select('id, command_type, capture_id, representation_id, payload, attempts, queued_at')
      .eq('company_id', source.company_id)
      .eq('source_id', source.id)
      .eq('status', 'queued')
      .order('queued_at', { ascending: true })
      .limit(10)

    if (error) return failure(500, error.message)

    return NextResponse.json({ ok: true, commands: data || [] })
  } catch (error: any) {
    return failure(500, error.message || 'Could not load photo worker commands.')
  }
}

export async function PATCH(request: Request) {
  try {
    const token = getBearerToken(request)
    if (!token) return failure(401, 'Missing photo source token.')

    const source = await loadSourceByToken(token)
    if (!source) return failure(401, 'Invalid photo source token.')

    const body = await request.json().catch(() => ({}))
    const commandId = text(body.command_id || body.commandId)
    const status = text(body.status)
    const message = text(body.message || body.error || body.last_error)

    if (!commandId) return failure(400, 'Command is required.')
    if (!['claimed', 'running', 'completed', 'failed', 'cancelled'].includes(status)) {
      return failure(400, 'Invalid command status.')
    }

    const updates: Record<string, unknown> = {
      status,
      last_error: message || null,
    }

    if (status === 'claimed' || status === 'running') updates.claimed_at = new Date().toISOString()
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updates.completed_at = new Date().toISOString()
    }
    if (status === 'failed') updates.attempts = Number(body.attempts || 0) + 1

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('photo_worker_commands')
      .update(updates)
      .eq('company_id', source.company_id)
      .eq('source_id', source.id)
      .eq('id', commandId)
      .select('id, status, last_error, completed_at')
      .single()

    if (error) return failure(500, error.message)

    return NextResponse.json({ ok: true, command: data })
  } catch (error: any) {
    return failure(500, error.message || 'Could not update photo worker command.')
  }
}

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'

type AppNotification = {
  id: string
  sourceKey: string | null
  type: string
  severity: 'info' | 'success' | 'warning' | 'critical'
  title: string
  body: string
  href: string | null
  unread: boolean
  generated: boolean
  createdAt: string
}

type NotificationBellProps = {
  activeCompanyId: string
  schemaReady: boolean
  enabled?: boolean
}

const severityClass: Record<AppNotification['severity'], string> = {
  info: 'border-sky-400/30 bg-sky-400/10 text-sky-100',
  success: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
  warning: 'border-amber-300/35 bg-amber-300/12 text-amber-100',
  critical: 'border-red-400/35 bg-red-500/12 text-red-100',
}

const typeLabel: Record<string, string> = {
  billing: 'Billing',
  integration: 'Integration',
  limit: 'Limit',
  maintenance: 'Maintenance',
  stock: 'Stock',
  support: 'Support',
  system: 'System',
  workflow: 'Workflow',
}

export default function NotificationBell({
  activeCompanyId,
  schemaReady,
  enabled = true,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const actionableNotifications = useMemo(
    () => notifications.filter((notification) => notification.id || notification.sourceKey),
    [notifications]
  )

  async function loadNotifications() {
    if (!schemaReady || !activeCompanyId || !enabled) {
      setNotifications([])
      setUnreadCount(0)
      return
    }

    setLoading(true)
    const response = await fetch('/api/notifications', { cache: 'no-store' }).catch(() => null)
    const data = await response?.json().catch(() => null)
    setLoading(false)

    if (!response?.ok || !data?.ok) {
      setNotifications([])
      setUnreadCount(0)
      return
    }

    setNotifications(Array.isArray(data.notifications) ? data.notifications : [])
    setUnreadCount(Number(data.unreadCount || 0))
  }

  async function dismissNotification(notification: AppNotification) {
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'dismiss',
        ids: notification.generated ? [] : [notification.id],
        sourceKeys: notification.sourceKey ? [notification.sourceKey] : [],
      }),
    }).catch(() => null)

    await loadNotifications()
  }

  async function markAllRead() {
    const storedIds = actionableNotifications
      .filter((notification) => !notification.generated)
      .map((notification) => notification.id)
    const generatedSourceKeys = actionableNotifications
      .filter((notification) => notification.generated && notification.sourceKey)
      .map((notification) => notification.sourceKey as string)

    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'dismiss',
        ids: storedIds,
        sourceKeys: generatedSourceKeys,
      }),
    }).catch(() => null)

    await loadNotifications()
  }

  useEffect(() => {
    loadNotifications()
  }, [activeCompanyId, schemaReady, enabled])

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  if (!schemaReady || !activeCompanyId || !enabled) return null

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value)
          if (!open) loadNotifications()
        }}
        title="Notifications"
        className="relative flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/20"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-black leading-none text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-40 w-[340px] max-w-[calc(100vw-24px)] rounded-xl border border-white/10 bg-black p-3 text-white shadow-2xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-black">Notifications</p>
              <p className="text-[11px] font-bold text-white/55">
                Maintenance, billing, support and account alerts
              </p>
            </div>

            {actionableNotifications.length > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="rounded-md border border-white/10 px-2 py-1 text-[11px] font-black text-white hover:bg-white/10"
              >
                Clear
              </button>
            )}
          </div>

          {loading ? (
            <p className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs font-bold text-white/60">
              Loading notifications...
            </p>
          ) : notifications.length === 0 ? (
            <p className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs font-bold text-white/60">
              No unread notifications.
            </p>
          ) : (
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {notifications.map((notification) => {
                const content = (
                  <div
                    className={`rounded-lg border p-3 ${severityClass[notification.severity] || severityClass.info}`}
                  >
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-wide text-white/55">
                          {typeLabel[notification.type] || notification.type || 'Notification'}
                        </p>
                        <p className="truncate text-sm font-black text-white">{notification.title}</p>
                      </div>

                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          dismissNotification(notification)
                        }}
                        className="rounded-md px-1.5 py-0.5 text-xs font-black text-white/70 hover:bg-white/10 hover:text-white"
                      >
                        x
                      </button>
                    </div>

                    {notification.body && (
                      <p className="text-xs font-bold leading-relaxed text-white/72">
                        {notification.body}
                      </p>
                    )}
                  </div>
                )

                if (notification.href) {
                  return (
                    <Link
                      key={notification.id}
                      href={notification.href}
                      onClick={() => setOpen(false)}
                      className="block"
                    >
                      {content}
                    </Link>
                  )
                }

                return <div key={notification.id}>{content}</div>
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

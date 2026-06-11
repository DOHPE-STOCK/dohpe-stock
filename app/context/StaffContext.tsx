'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useCompany } from '@/app/context/CompanyContext'

export type StaffPermissions = Record<string, boolean>

export type StaffUser = {
  id: string
  name: string
  role: string
  permissions: StaffPermissions
  is_active: boolean
}

type StaffInput = Partial<StaffUser> & {
  id: string
  name: string
}

const STAFF_PIN_SESSION_MS = 1000 * 60 * 30
const APP_SESSION_KEY_STORAGE = 'loopbase_app_session_key'

type StaffContextType = {
  staff: StaffUser | null
  setStaff: (staff: StaffInput | null) => void
  clearStaff: () => void
  can: (permission: string) => boolean
  hasRole: (roles: string | string[]) => boolean
}

const StaffContext = createContext<StaffContextType>({
  staff: null,
  setStaff: () => {},
  clearStaff: () => {},
  can: () => false,
  hasRole: () => false,
})

function normaliseStaff(saved: any): StaffUser | null {
  if (!saved?.id || !saved?.name) return null

  return {
    id: String(saved.id),
    name: String(saved.name),
    role: String(saved.role || 'staff'),
    permissions: saved.permissions || {},
    is_active: saved.is_active !== false,
  }
}

export function StaffProvider({ children }: { children: React.ReactNode }) {
  const { activeCompanyId, schemaReady } = useCompany()
  const [staff, setStaffState] = useState<StaffUser | null>(null)

  useEffect(() => {
    const saved = window.localStorage.getItem('active_staff_user')

    if (!saved) return

    try {
      const parsed = JSON.parse(saved)
      const expiresAt = Number(parsed.expires_at || 0)

      if (expiresAt && expiresAt <= Date.now()) {
        clearStaffStorage()
        return
      }

      const normalised = normaliseStaff(parsed)

      if (normalised) {
        setStaffState(normalised)
      } else {
        clearStaffStorage()
      }
    } catch {
      clearStaffStorage()
    }
  }, [])

  function clearStaffStorage() {
    window.localStorage.removeItem('active_staff_user')
    document.cookie =
      'active_staff_user=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  }

  function setStaff(staffUser: StaffInput | null) {
    const safeStaff = normaliseStaff(staffUser)

    setStaffState(safeStaff)

    if (safeStaff) {
      const expiresAt = Date.now() + STAFF_PIN_SESSION_MS
      const persistedStaff = {
        ...safeStaff,
        expires_at: expiresAt,
      }
      const encoded = encodeURIComponent(JSON.stringify(persistedStaff))

      window.localStorage.setItem('active_staff_user', JSON.stringify(persistedStaff))
      document.cookie = `active_staff_user=${encoded}; path=/; max-age=1800; SameSite=Lax`
      syncStaffPinSession('start', safeStaff.id)
    } else {
      clearStaffStorage()
      syncStaffPinSession('end', staff?.id)
    }
  }

  function clearStaff() {
    setStaff(null)
  }

  function can(permission: string) {
    if (!staff || staff.is_active === false) return false
    if (staff.role === 'admin') return true

    return Boolean(staff.permissions?.[permission])
  }

  function hasRole(roles: string | string[]) {
    if (!staff || staff.is_active === false) return false

    const allowedRoles = Array.isArray(roles) ? roles : [roles]
    return allowedRoles.includes(staff.role)
  }

  function syncStaffPinSession(action: 'start' | 'end' | 'activity', staffId?: string) {
    if (!schemaReady || !activeCompanyId || activeCompanyId === 'single-company-fallback') return
    const sessionKey = window.localStorage.getItem(APP_SESSION_KEY_STORAGE)
    if (!sessionKey) return

    fetch('/api/sessions/staff-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        session_key: sessionKey,
        staff_id: staffId || staff?.id || '',
        allowed_area: window.location.pathname.split('/').filter(Boolean)[0] || 'app',
      }),
    }).catch(() => null)
  }

  useEffect(() => {
    if (!staff) return

    const timer = window.setInterval(() => {
      syncStaffPinSession('activity', staff.id)
    }, 5 * 60 * 1000)

    return () => window.clearInterval(timer)
  }, [staff?.id, activeCompanyId, schemaReady])

  return (
    <StaffContext.Provider value={{ staff, setStaff, clearStaff, can, hasRole }}>
      {children}
    </StaffContext.Provider>
  )
}

export function useStaff() {
  return useContext(StaffContext)
}

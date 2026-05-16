'use client'

import { createContext, useContext, useEffect, useState } from 'react'

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
  const [staff, setStaffState] = useState<StaffUser | null>(null)

  useEffect(() => {
    const saved = window.localStorage.getItem('active_staff_user')

    if (!saved) return

    try {
      const parsed = JSON.parse(saved)
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
      const encoded = encodeURIComponent(JSON.stringify(safeStaff))

      window.localStorage.setItem('active_staff_user', JSON.stringify(safeStaff))
      document.cookie = `active_staff_user=${encoded}; path=/; max-age=2592000; SameSite=Lax`
    } else {
      clearStaffStorage()
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

  return (
    <StaffContext.Provider value={{ staff, setStaff, clearStaff, can, hasRole }}>
      {children}
    </StaffContext.Provider>
  )
}

export function useStaff() {
  return useContext(StaffContext)
}
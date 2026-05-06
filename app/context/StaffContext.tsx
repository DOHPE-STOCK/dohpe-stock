'use client'

import { createContext, useContext, useEffect, useState } from 'react'

type StaffUser = {
  id: string
  name: string
}

type StaffContextType = {
  staff: StaffUser | null
  setStaff: (staff: StaffUser | null) => void
}

const StaffContext = createContext<StaffContextType>({
  staff: null,
  setStaff: () => {},
})

export function StaffProvider({ children }: { children: React.ReactNode }) {
  const [staff, setStaffState] = useState<StaffUser | null>(null)

  useEffect(() => {
    const saved = window.localStorage.getItem('active_staff_user')

    if (saved) {
      try {
        setStaffState(JSON.parse(saved))
      } catch {
        window.localStorage.removeItem('active_staff_user')
        document.cookie =
          'active_staff_user=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
      }
    }
  }, [])

  function setStaff(staffUser: StaffUser | null) {
    setStaffState(staffUser)

    if (staffUser) {
      const encoded = encodeURIComponent(JSON.stringify(staffUser))

      window.localStorage.setItem('active_staff_user', JSON.stringify(staffUser))
      document.cookie = `active_staff_user=${encoded}; path=/; max-age=2592000; SameSite=Lax`
    } else {
      window.localStorage.removeItem('active_staff_user')
      document.cookie =
        'active_staff_user=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    }
  }

  return (
    <StaffContext.Provider value={{ staff, setStaff }}>
      {children}
    </StaffContext.Provider>
  )
}

export function useStaff() {
  return useContext(StaffContext)
}
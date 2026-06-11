'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { StaffPermissions, StaffUser } from '@/app/context/StaffContext'

type StaffRow = {
  id: string
  name: string
  pin_code: string
  is_active: boolean
  must_change_pin: boolean
  role?: string | null
  permissions?: StaffPermissions | null
}

type StaffPinGateProps = {
  onStaffSelected?: (staff: StaffUser | null) => void
}

const STAFF_PIN_SESSION_MS = 1000 * 60 * 30

export default function StaffPinGate({ onStaffSelected }: StaffPinGateProps) {
  const [staffUsers, setStaffUsers] = useState<StaffRow[]>([])
  const [selectedStaffId, setSelectedStaffId] = useState('')
  const [pin, setPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [matchedStaff, setMatchedStaff] = useState<StaffRow | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetchStaff()
    loadSavedStaff()
  }, [])

  async function fetchStaff() {
    const { data, error } = await supabase
      .from('staff_users')
      .select('id, name, pin_code, is_active, must_change_pin, role, permissions')
      .eq('is_active', true)
      .order('name', { ascending: true })

    if (error) {
      setMessage(error.message)
      return
    }

    setStaffUsers((data || []) as StaffRow[])
  }

  function normaliseStaff(staff: StaffRow): StaffUser {
    return {
      id: staff.id,
      name: staff.name,
      role: staff.role || 'staff',
      permissions: staff.permissions || {},
      is_active: staff.is_active !== false,
    }
  }

  function loadSavedStaff() {
    const saved = window.localStorage.getItem('active_staff_user')

    if (!saved) return

    try {
      const parsed = JSON.parse(saved)
      const expiresAt = Number(parsed.expires_at || 0)

      if (expiresAt && expiresAt <= Date.now()) {
        window.localStorage.removeItem('active_staff_user')
        document.cookie =
          'active_staff_user=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
        return
      }

      if (parsed?.id && parsed?.name) {
        onStaffSelected?.({
          id: parsed.id,
          name: parsed.name,
          role: parsed.role || 'staff',
          permissions: parsed.permissions || {},
          is_active: parsed.is_active !== false,
        })
      }
    } catch {
      window.localStorage.removeItem('active_staff_user')
      document.cookie =
        'active_staff_user=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    }
  }

  function saveStaff(staff: StaffRow) {
    const safeStaff = normaliseStaff(staff)
    const persistedStaff = {
      ...safeStaff,
      expires_at: Date.now() + STAFF_PIN_SESSION_MS,
    }
    const encoded = encodeURIComponent(JSON.stringify(persistedStaff))

    window.localStorage.setItem('active_staff_user', JSON.stringify(persistedStaff))
    document.cookie = `active_staff_user=${encoded}; path=/; max-age=1800; SameSite=Lax`

    onStaffSelected?.(safeStaff)

    setMessage(`Signed in as ${staff.name}`)
  }

  function checkPin() {
    setMessage('')

    const staff = staffUsers.find((user) => user.id === selectedStaffId)

    if (!staff) {
      setMessage('Select staff member.')
      return
    }

    if (staff.is_active === false) {
      setMessage('This staff user is disabled.')
      return
    }

    if (!pin) {
      setMessage('Enter PIN.')
      return
    }

    if (staff.pin_code !== pin) {
      setMessage('Wrong PIN.')
      return
    }

    if (staff.must_change_pin) {
      setMatchedStaff(staff)
      setMessage(`${staff.name}, set your new PIN.`)
      return
    }

    saveStaff(staff)
    setPin('')
  }

  async function changePin() {
    if (!matchedStaff) return

    setMessage('')

    if (newPin.length < 4) {
      setMessage('PIN must be at least 4 digits.')
      return
    }

    if (!/^\d+$/.test(newPin)) {
      setMessage('PIN must only contain numbers.')
      return
    }

    if (newPin !== confirmPin) {
      setMessage('PINs do not match.')
      return
    }

    setBusy(true)

    const { error } = await supabase
      .from('staff_users')
      .update({
        pin_code: newPin,
        must_change_pin: false,
        pin_updated_at: new Date().toISOString(),
      })
      .eq('id', matchedStaff.id)

    setBusy(false)

    if (error) {
      setMessage(error.message)
      return
    }

    const updatedStaff = {
      ...matchedStaff,
      pin_code: newPin,
      must_change_pin: false,
    }

    saveStaff(updatedStaff)
    setMatchedStaff(null)
    setPin('')
    setNewPin('')
    setConfirmPin('')
  }

  function clearStaff() {
    window.localStorage.removeItem('active_staff_user')
    document.cookie =
      'active_staff_user=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'

    onStaffSelected?.(null)
    setMessage('Staff cleared. Enter PIN again.')
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black">Staff PIN</h2>

          <p className="text-sm text-neutral-400">
            Select who is using this device.
          </p>
        </div>

        <button
          type="button"
          onClick={clearStaff}
          className="rounded-xl border border-neutral-700 px-3 py-2 text-xs font-bold"
        >
          CHANGE STAFF
        </button>
      </div>

      {!matchedStaff ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_160px_120px]">
          <select
            value={selectedStaffId}
            onChange={(e) => setSelectedStaffId(e.target.value)}
            className="rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-4 text-lg font-bold outline-none"
          >
            <option value="">Select staff</option>

            {staffUsers.map((staff) => (
              <option key={staff.id} value={staff.id}>
                {staff.name}
              </option>
            ))}
          </select>

          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') checkPin()
            }}
            placeholder="PIN"
            inputMode="numeric"
            type="password"
            className="rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-4 text-center text-xl font-black outline-none"
          />

          <button
            type="button"
            onClick={checkPin}
            className="rounded-xl bg-white px-4 py-4 text-sm font-black text-black"
          >
            ENTER
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_140px]">
          <input
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
            placeholder="New PIN"
            inputMode="numeric"
            type="password"
            className="rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-4 text-center text-xl font-black outline-none"
          />

          <input
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') changePin()
            }}
            placeholder="Confirm PIN"
            inputMode="numeric"
            type="password"
            className="rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-4 text-center text-xl font-black outline-none"
          />

          <button
            type="button"
            onClick={changePin}
            disabled={busy}
            className="rounded-xl bg-green-600 px-4 py-4 text-sm font-black text-white disabled:opacity-50"
          >
            SAVE PIN
          </button>
        </div>
      )}

      {message && (
        <p className="mt-3 text-sm font-bold text-yellow-300">{message}</p>
      )}
    </section>
  )
}


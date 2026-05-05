'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type StaffUser = {
  id: string
  name: string
  pin_code: string
  must_change_pin: boolean
}

type StaffPinGateProps = {
  onStaffSelected?: (staff: { id: string; name: string }) => void
}

export default function StaffPinGate({ onStaffSelected }: StaffPinGateProps) {
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([])
  const [selectedStaffId, setSelectedStaffId] = useState('')
  const [pin, setPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [matchedStaff, setMatchedStaff] = useState<StaffUser | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetchStaff()
    loadSavedStaff()
  }, [])

  async function fetchStaff() {
    const { data, error } = await supabase
      .from('staff_users')
      .select('id, name, pin_code, must_change_pin')
      .eq('is_active', true)
      .order('name', { ascending: true })

    if (error) {
      setMessage(error.message)
      return
    }

    setStaffUsers((data || []) as StaffUser[])
  }

  function loadSavedStaff() {
    const saved = window.localStorage.getItem('active_staff_user')

    if (!saved) return

    try {
      const parsed = JSON.parse(saved)
      onStaffSelected?.(parsed)
    } catch {
      window.localStorage.removeItem('active_staff_user')
    }
  }

  function saveStaff(staff: StaffUser) {
    const safeStaff = {
      id: staff.id,
      name: staff.name,
    }

    window.localStorage.setItem('active_staff_user', JSON.stringify(safeStaff))
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
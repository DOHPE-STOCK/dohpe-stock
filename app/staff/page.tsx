'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useStaff } from '@/app/context/StaffContext'

type StaffUser = {
  id: string
  name: string
  pin_code: string
  must_change_pin: boolean
}

export default function StaffPage() {
  const router = useRouter()
  const { setStaff } = useStaff()

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

    setStaff({
      id: staff.id,
      name: staff.name,
    })

    router.push('/')
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

    setStaff({
      id: matchedStaff.id,
      name: matchedStaff.name,
    })

    router.push('/')
  }

  async function logoutApp() {
    setStaff(null)
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 p-3 text-white">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6 sm:p-8">
        <h1 className="mb-2 text-3xl font-black">Staff PIN</h1>

        <p className="mb-5 text-sm text-neutral-400">
          Select who is using this device.
        </p>

        {!matchedStaff ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              checkPin()
            }}
          >
            <select
              value={selectedStaffId}
              onChange={(e) => setSelectedStaffId(e.target.value)}
              className="mb-4 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-4 text-lg font-bold outline-none"
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
              placeholder="PIN"
              inputMode="numeric"
              type="password"
              className="mb-4 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-4 text-center text-2xl font-black outline-none"
              autoFocus
            />

            <button
              type="submit"
              disabled={!selectedStaffId || !pin}
              className="w-full rounded-xl bg-white py-4 text-xl font-black text-black disabled:opacity-50"
            >
              ENTER
            </button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              changePin()
            }}
          >
            <p className="mb-4 text-lg font-bold text-yellow-300">
              {matchedStaff.name}, choose a new PIN.
            </p>

            <input
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
              placeholder="New PIN"
              inputMode="numeric"
              type="password"
              className="mb-4 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-4 text-center text-2xl font-black outline-none"
              autoFocus
            />

            <input
              value={confirmPin}
              onChange={(e) =>
                setConfirmPin(e.target.value.replace(/\D/g, ''))
              }
              placeholder="Confirm PIN"
              inputMode="numeric"
              type="password"
              className="mb-4 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-4 text-center text-2xl font-black outline-none"
            />

            <button
              type="submit"
              disabled={busy || !newPin || !confirmPin}
              className="w-full rounded-xl bg-green-600 py-4 text-xl font-black text-white disabled:opacity-50"
            >
              {busy ? 'SAVING...' : 'SAVE PIN'}
            </button>
          </form>
        )}

        {message && (
          <p className="mt-4 text-sm font-bold text-yellow-300">{message}</p>
        )}

        <button
          type="button"
          onClick={logoutApp}
          className="mt-5 w-full rounded-xl border border-neutral-700 py-3 text-sm font-bold text-neutral-300"
        >
          LOG OUT OF APP
        </button>
      </div>
    </main>
  )
}
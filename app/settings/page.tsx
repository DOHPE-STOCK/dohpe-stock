'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import AppNav from '@/app/components/AppNav'

type StaffUser = {
  id: string
  name: string
  pin_code: string
  is_active: boolean
  created_at?: string
  must_change_pin?: boolean
  pin_updated_at?: string | null
  role?: string
  permissions?: Record<string, boolean>
}

type OpenSection =
  | 'integrations'
  | 'users'
  | 'photo'
  | 'export'
  | 'copy'
  | null

const permissionOptions = [
  { key: 'working', label: 'Working' },
  { key: 'review', label: 'Review' },
  { key: 'finalised', label: 'Finalised' },
  { key: 'reports', label: 'Reports' },
  { key: 'settings', label: 'Settings' },
  { key: 'scanner', label: 'Scanner' },
  { key: 'checkout', label: 'Checkout' },
  { key: 'integrations', label: 'Integrations' },
]

const roleOptions = ['admin', 'manager', 'staff', 'checkout', 'scanner']

function defaultPermissions(role = 'staff') {
  if (role === 'admin') {
    return {
      working: true,
      review: true,
      finalised: true,
      reports: true,
      settings: true,
      scanner: true,
      checkout: true,
      integrations: true,
    }
  }

  if (role === 'manager') {
    return {
      working: true,
      review: true,
      finalised: true,
      reports: true,
      settings: false,
      scanner: true,
      checkout: true,
      integrations: false,
    }
  }

  if (role === 'checkout') {
    return {
      working: false,
      review: false,
      finalised: false,
      reports: false,
      settings: false,
      scanner: false,
      checkout: true,
      integrations: false,
    }
  }

  if (role === 'scanner') {
    return {
      working: true,
      review: false,
      finalised: false,
      reports: false,
      settings: false,
      scanner: true,
      checkout: false,
      integrations: false,
    }
  }

  return {
    working: true,
    review: false,
    finalised: false,
    reports: false,
    settings: false,
    scanner: true,
    checkout: false,
    integrations: false,
  }
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>(null)
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([])
  const [message, setMessage] = useState('')
  const [newStaffName, setNewStaffName] = useState('')
  const [newStaffPin, setNewStaffPin] = useState('')
  const [savingStaffId, setSavingStaffId] = useState('')
  const [openSection, setOpenSection] = useState<OpenSection>(null)

  useEffect(() => {
    fetchSettings()
    fetchStaffUsers()
  }, [])

  useEffect(() => {
    if (!message) return

    const timer = window.setTimeout(() => {
      setMessage('')
    }, 5000)

    return () => window.clearTimeout(timer)
  }, [message])

  function toggleSection(section: OpenSection) {
    setOpenSection((current) => (current === section ? null : section))
  }

  async function fetchSettings() {
    const { data, error } = await supabase
      .from('app_settings')
      .select('*')
      .eq('id', 'default')
      .single()

    if (error) {
      setMessage(error.message)
      return
    }

    setSettings(data)
  }

  async function fetchStaffUsers() {
    const { data, error } = await supabase
      .from('staff_users')
      .select('*')
      .order('name', { ascending: true })

    if (error) {
      setMessage(error.message)
      return
    }

    setStaffUsers(
      (data || []).map((user: StaffUser) => ({
        ...user,
        role: user.role || 'staff',
        permissions: user.permissions || defaultPermissions(user.role || 'staff'),
      }))
    )
  }

  async function saveSettings() {
    const { error } = await supabase
      .from('app_settings')
      .update({
        photo_reference_url: settings.photo_reference_url,
        photo_reference_urls: settings.photo_reference_urls,
        photo_ai_rules: settings.photo_ai_rules,
        photo_background_colour: settings.photo_background_colour,
        image_export_size: Number(settings.image_export_size),
        image_export_quality: Number(settings.image_export_quality),
        ai_copy_rules: settings.ai_copy_rules,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 'default')

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage('Settings saved')
  }

  async function addStaffUser() {
    const name = newStaffName.trim()
    const pin = newStaffPin.trim()

    if (!name) {
      setMessage('Enter a staff name')
      return
    }

    if (!pin || pin.length < 4) {
      setMessage('Enter a PIN of at least 4 digits')
      return
    }

    const role = 'staff'

    const { error } = await supabase.from('staff_users').insert({
      name,
      pin_code: pin,
      is_active: true,
      must_change_pin: true,
      pin_updated_at: new Date().toISOString(),
      role,
      permissions: defaultPermissions(role),
    })

    if (error) {
      setMessage(error.message)
      return
    }

    setNewStaffName('')
    setNewStaffPin('')
    setMessage(`Staff user ${name} added`)
    fetchStaffUsers()
  }

  async function saveStaffUser(user: StaffUser) {
    setSavingStaffId(user.id)

    const { error } = await supabase
      .from('staff_users')
      .update({
        name: user.name,
        pin_code: user.pin_code,
        is_active: user.is_active,
        must_change_pin: Boolean(user.must_change_pin),
        role: user.role || 'staff',
        permissions: user.permissions || {},
        pin_updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    setSavingStaffId('')

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage(`${user.name} saved`)
    fetchStaffUsers()
  }

  async function resetPin(user: StaffUser) {
    const newPin = window.prompt(`Enter new PIN for ${user.name}`)

    if (!newPin) return

    if (newPin.trim().length < 4) {
      setMessage('PIN must be at least 4 digits')
      return
    }

    const updatedUser = {
      ...user,
      pin_code: newPin.trim(),
      must_change_pin: true,
      pin_updated_at: new Date().toISOString(),
    }

    await saveStaffUser(updatedUser)
  }

  function updateStaffUser(id: string, patch: Partial<StaffUser>) {
    setStaffUsers((current) =>
      current.map((user) => (user.id === id ? { ...user, ...patch } : user))
    )
  }

  function updateStaffRole(id: string, role: string) {
    setStaffUsers((current) =>
      current.map((user) =>
        user.id === id
          ? {
              ...user,
              role,
              permissions: defaultPermissions(role),
            }
          : user
      )
    )
  }

  function togglePermission(id: string, permissionKey: string) {
    setStaffUsers((current) =>
      current.map((user) => {
        if (user.id !== id) return user

        return {
          ...user,
          permissions: {
            ...(user.permissions || {}),
            [permissionKey]: !Boolean(user.permissions?.[permissionKey]),
          },
        }
      })
    )
  }

  function updateField(field: string, value: any) {
    setSettings({
      ...settings,
      [field]: value,
    })
  }

  function getReferenceUrls() {
    return (settings.photo_reference_urls || '')
      .split('\n')
      .map((url: string) => url.trim())
      .filter(Boolean)
      .slice(0, 3)
  }

  async function getAverageColourFromImage(url: string) {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = url

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error(`Could not load image: ${url}`))
    })

    const canvas = document.createElement('canvas')
    const size = 80
    canvas.width = size
    canvas.height = size

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not create canvas')

    ctx.drawImage(img, 0, 0, size, size)

    const imageData = ctx.getImageData(0, 0, size, size).data

    let r = 0
    let g = 0
    let b = 0
    let count = 0

    for (let i = 0; i < imageData.length; i += 4) {
      r += imageData[i]
      g += imageData[i + 1]
      b += imageData[i + 2]
      count++
    }

    return {
      r: Math.round(r / count),
      g: Math.round(g / count),
      b: Math.round(b / count),
    }
  }

  async function calculateAverageBackgroundColour() {
    try {
      const urls = getReferenceUrls()

      if (urls.length === 0) {
        setMessage('Add at least one reference image URL first')
        return
      }

      setMessage('Calculating average background colour...')

      const colours = await Promise.all(
        urls.map((url: string) => getAverageColourFromImage(url))
      )

      const avg = colours.reduce(
        (total, colour) => ({
          r: total.r + colour.r,
          g: total.g + colour.g,
          b: total.b + colour.b,
        }),
        { r: 0, g: 0, b: 0 }
      )

      const r = Math.round(avg.r / colours.length)
      const g = Math.round(avg.g / colours.length)
      const b = Math.round(avg.b / colours.length)

      const hex =
        '#' +
        [r, g, b]
          .map((value) => value.toString(16).padStart(2, '0'))
          .join('')

      updateField('photo_background_colour', hex)
      setMessage(`Background colour set to ${hex}`)
    } catch (error: any) {
      setMessage(
        error.message ||
          'Could not calculate colour. The image URL may block browser access.'
      )
    }
  }

  function SectionHeader({
    section,
    title,
    description,
    colour = 'zinc',
  }: {
    section: OpenSection
    title: string
    description: string
    colour?: 'zinc' | 'blue' | 'emerald' | 'purple'
  }) {
    const isOpen = openSection === section

    const colourClasses = {
      zinc: isOpen
        ? 'border-zinc-600 bg-zinc-800'
        : 'border-zinc-800 bg-zinc-900 hover:border-zinc-600',
      blue: isOpen
        ? 'border-blue-500 bg-blue-950'
        : 'border-blue-800 bg-blue-950/70 hover:border-blue-500',
      emerald: isOpen
        ? 'border-emerald-500 bg-emerald-950'
        : 'border-emerald-800 bg-emerald-950/70 hover:border-emerald-500',
      purple: isOpen
        ? 'border-purple-500 bg-purple-950'
        : 'border-purple-800 bg-purple-950/70 hover:border-purple-500',
    }

    return (
      <button
        type="button"
        onClick={() => toggleSection(section)}
        className={`w-full rounded-xl border p-5 text-left transition ${colourClasses[colour]}`}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-white">{title}</h2>
            <p className="mt-1 text-sm text-zinc-300">{description}</p>
          </div>

          <span className="rounded-lg bg-white/10 px-4 py-2 text-sm font-black text-white">
            {isOpen ? 'Close' : 'Open'}
          </span>
        </div>
      </button>
    )
  }

  if (!settings) {
    return (
      <main className="min-h-screen bg-zinc-950 p-5 text-white">
        Loading settings...
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-zinc-950 p-5 text-white">
      <div className="mb-5 flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>

            <p className="text-sm text-zinc-400">
              Open a section to change settings.
            </p>
          </div>

          <AppNav current="settings" />
        </div>

        <div className="flex items-center gap-3">
          {message && (
            <span className="rounded-lg border border-yellow-700 bg-yellow-950 px-4 py-2 text-sm font-bold text-yellow-300">
              {message}
            </span>
          )}

          <button
            onClick={saveSettings}
            className="rounded-lg bg-green-600 px-5 py-2 text-sm font-bold hover:bg-green-500"
          >
            Save Settings
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <SectionHeader
          section="integrations"
          title="Channel Integrations"
          description="Manage Linnworks, eBay, Shopify, Vinted, Square, Loyverse, Depop and TikTok Shop sync settings."
          colour="blue"
        />

        {openSection === 'integrations' && (
          <section className="rounded-xl border border-blue-800 bg-blue-950 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-black text-blue-100">
                  Channel Integrations
                </h3>

                <p className="mt-1 text-sm text-blue-200">
                  Open the integrations page to manage channel connection settings.
                </p>
              </div>

              <Link
                href="/settings/integrations"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-500"
              >
                Open Integrations
              </Link>
            </div>
          </section>
        )}

        <SectionHeader
          section="users"
          title="Users & Permissions"
          description="Manage staff PINs, active users, roles and page permissions."
          colour="emerald"
        />

        {openSection === 'users' && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-300">
                  Users & Roles
                </h2>

                <p className="mt-1 text-sm text-zinc-500">
                  Email login controls device/app access. Staff PIN controls who is using the app and what they can access.
                </p>
              </div>

              <button
                onClick={fetchStaffUsers}
                className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-bold hover:bg-zinc-700"
              >
                Refresh Users
              </button>
            </div>

            <div className="mb-5 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <h3 className="mb-3 text-sm font-bold text-zinc-300">
                Add Staff User
              </h3>

              <div className="grid gap-3 md:grid-cols-[1fr_180px_160px]">
                <input
                  value={newStaffName}
                  onChange={(e) => setNewStaffName(e.target.value)}
                  placeholder="Staff name"
                  className="h-10 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-white"
                />

                <input
                  value={newStaffPin}
                  onChange={(e) => setNewStaffPin(e.target.value)}
                  placeholder="PIN"
                  type="password"
                  className="h-10 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-white"
                />

                <button
                  onClick={addStaffUser}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500"
                >
                  Add User
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {staffUsers.length === 0 ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm font-bold text-zinc-500">
                  No staff users found.
                </div>
              ) : (
                staffUsers.map((user) => (
                  <div
                    key={user.id}
                    className={`rounded-xl border p-4 ${
                      user.is_active
                        ? 'border-zinc-800 bg-zinc-950'
                        : 'border-red-900 bg-red-950/30'
                    }`}
                  >
                    <div className="grid gap-3 xl:grid-cols-[1fr_160px_120px_160px]">
                      <div>
                        <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-zinc-500">
                          Name
                        </label>

                        <input
                          value={user.name || ''}
                          onChange={(e) =>
                            updateStaffUser(user.id, { name: e.target.value })
                          }
                          className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-white outline-none focus:border-white"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-zinc-500">
                          Role
                        </label>

                        <select
                          value={user.role || 'staff'}
                          onChange={(e) => updateStaffRole(user.id, e.target.value)}
                          className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-white outline-none focus:border-white"
                        >
                          {roleOptions.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-zinc-500">
                          Active
                        </label>

                        <button
                          type="button"
                          onClick={() =>
                            updateStaffUser(user.id, {
                              is_active: !user.is_active,
                            })
                          }
                          className={`h-10 w-full rounded-lg px-3 text-sm font-black ${
                            user.is_active
                              ? 'bg-green-700 text-white'
                              : 'bg-red-800 text-white'
                          }`}
                        >
                          {user.is_active ? 'Active' : 'Disabled'}
                        </button>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-zinc-500">
                          Actions
                        </label>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => resetPin(user)}
                            className="h-10 flex-1 rounded-lg bg-yellow-700 px-3 text-xs font-black text-white hover:bg-yellow-600"
                          >
                            Reset PIN
                          </button>

                          <button
                            type="button"
                            onClick={() => saveStaffUser(user)}
                            disabled={savingStaffId === user.id}
                            className="h-10 flex-1 rounded-lg bg-blue-600 px-3 text-xs font-black text-white hover:bg-blue-500 disabled:opacity-40"
                          >
                            {savingStaffId === user.id ? 'Saving' : 'Save'}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4">
                      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">
                        Permissions
                      </p>

                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {permissionOptions.map((permission) => {
                          const enabled = Boolean(user.permissions?.[permission.key])

                          return (
                            <button
                              key={permission.key}
                              type="button"
                              onClick={() =>
                                togglePermission(user.id, permission.key)
                              }
                              className={`rounded-lg px-3 py-2 text-left text-xs font-black ${
                                enabled
                                  ? 'bg-emerald-900 text-emerald-100'
                                  : 'bg-zinc-800 text-zinc-500'
                              }`}
                            >
                              {enabled ? '✓ ' : '— '}
                              {permission.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-zinc-500">
                      <span>ID: {user.id}</span>

                      {user.must_change_pin && (
                        <span className="rounded bg-yellow-950 px-2 py-1 text-yellow-300">
                          Must change PIN
                        </span>
                      )}

                      {user.pin_updated_at && (
                        <span>
                          PIN updated:{' '}
                          {new Date(user.pin_updated_at).toLocaleString('en-GB')}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        <SectionHeader
          section="photo"
          title="AI Photo Settings"
          description="Reference images, AI photo rules and background colour matching."
          colour="zinc"
        />

        {openSection === 'photo' && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-zinc-300">
              AI Photo Settings
            </h2>

            <div className="space-y-4">
              <textarea
                value={settings.photo_reference_urls || ''}
                onChange={(e) =>
                  updateField('photo_reference_urls', e.target.value)
                }
                placeholder="Reference image URLs (one per line)"
                className="h-28 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm"
              />

              <textarea
                value={settings.photo_ai_rules || ''}
                onChange={(e) => updateField('photo_ai_rules', e.target.value)}
                className="h-40 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm"
              />

              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <input
                  value={settings.photo_background_colour || ''}
                  onChange={(e) =>
                    updateField('photo_background_colour', e.target.value)
                  }
                  className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm"
                />

                <button
                  onClick={calculateAverageBackgroundColour}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold"
                >
                  Average
                </button>
              </div>
            </div>
          </section>
        )}

        <SectionHeader
          section="export"
          title="Image Export"
          description="Default export size and JPEG quality for processed images."
          colour="zinc"
        />

        {openSection === 'export' && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-zinc-300">
              Image Export
            </h2>

            <div className="grid gap-4 md:grid-cols-2">
              <input
                type="number"
                value={settings.image_export_size || 1600}
                onChange={(e) => updateField('image_export_size', e.target.value)}
                className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm"
              />

              <input
                type="number"
                value={settings.image_export_quality || 0.85}
                onChange={(e) =>
                  updateField('image_export_quality', e.target.value)
                }
                className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm"
              />
            </div>
          </section>
        )}

        <SectionHeader
          section="copy"
          title="AI Copy Rules"
          description="Rules used when generating item titles, descriptions and website copy."
          colour="purple"
        />

        {openSection === 'copy' && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-zinc-300">
              AI Copy Rules
            </h2>

            <textarea
              value={settings.ai_copy_rules || ''}
              onChange={(e) => updateField('ai_copy_rules', e.target.value)}
              className="h-56 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm"
            />
          </section>
        )}
      </div>
    </main>
  )
}
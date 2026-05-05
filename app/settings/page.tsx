'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import AppNav from '@/app/components/AppNav'

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetchSettings()
  }, [])

  useEffect(() => {
    if (!message) return

    const timer = window.setTimeout(() => {
      setMessage('')
    }, 5000)

    return () => window.clearTimeout(timer)
  }, [message])

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
        
        {/* LEFT SIDE (title + nav) */}
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>

            <p className="text-sm text-zinc-400">
              AI rules, image export defaults and workflow settings
            </p>
          </div>

          <AppNav current="settings" />
        </div>

        {/* RIGHT SIDE (actions) */}
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

      <div className="grid gap-4 xl:grid-cols-2">
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
              onChange={(e) =>
                updateField('photo_ai_rules', e.target.value)
              }
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

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-zinc-300">
            Image Export
          </h2>

          <div className="grid gap-4 md:grid-cols-2">
            <input
              type="number"
              value={settings.image_export_size || 1600}
              onChange={(e) =>
                updateField('image_export_size', e.target.value)
              }
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

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 xl:col-span-2">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-zinc-300">
            AI Copy Rules
          </h2>

          <textarea
            value={settings.ai_copy_rules || ''}
            onChange={(e) => updateField('ai_copy_rules', e.target.value)}
            className="h-56 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm"
          />
        </section>
      </div>
    </main>
  )
}
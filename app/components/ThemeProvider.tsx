'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'

const THEME_STORAGE_KEY = 'dohpe-ui-theme'

function applyTheme(theme: string | null) {
  const resolved = theme === 'light' ? 'light' : 'dark'
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    applyTheme(window.localStorage.getItem(THEME_STORAGE_KEY))

    async function loadSavedTheme() {
      const { data, error } = await supabase
        .from('app_settings')
        .select('ui_theme')
        .eq('id', 'default')
        .maybeSingle()

      if (error || !data?.ui_theme) return
      setStoredTheme(data.ui_theme)
    }

    loadSavedTheme()

    function handleThemeChange(event: Event) {
      const customEvent = event as CustomEvent<string>
      applyTheme(customEvent.detail)
    }

    window.addEventListener('dohpe-theme-change', handleThemeChange)

    return () => {
      window.removeEventListener('dohpe-theme-change', handleThemeChange)
    }
  }, [])

  return <>{children}</>
}

export function setStoredTheme(theme: string) {
  const resolved = theme === 'light' ? 'light' : 'dark'
  window.localStorage.setItem(THEME_STORAGE_KEY, resolved)
  window.dispatchEvent(new CustomEvent('dohpe-theme-change', { detail: resolved }))
}


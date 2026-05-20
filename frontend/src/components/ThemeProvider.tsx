import { useEffect } from 'react'
import { useSettingsStore } from '@/store/settings'

export function ThemeProvider() {
  const theme = useSettingsStore((s) => s.theme)
  const accentHue = useSettingsStore((s) => s.accentHue)

  useEffect(() => {
    const root = document.documentElement
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const isDark = theme === 'dark' || (theme === 'system' && prefersDark)
    root.classList.toggle('dark', isDark)
  }, [theme])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--primary', `oklch(0.55 0.22 ${accentHue})`)
    root.style.setProperty('--primary-foreground', 'oklch(0.98 0 0)')
    root.style.setProperty('--ring', `oklch(0.55 0.22 ${accentHue})`)
  }, [accentHue])

  return null
}

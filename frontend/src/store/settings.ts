import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark' | 'system'

interface SettingsState {
  theme: Theme
  accentHue: number
  sidebarCollapsed: boolean
  setTheme: (t: Theme) => void
  setAccentHue: (h: number) => void
  setSidebarCollapsed: (v: boolean) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system' as Theme,
      accentHue: 240,
      sidebarCollapsed: false,
      setTheme: (t) => set({ theme: t }),
      setAccentHue: (h) => set({ accentHue: h }),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
    }),
    { name: 'pmd-settings' }
  )
)

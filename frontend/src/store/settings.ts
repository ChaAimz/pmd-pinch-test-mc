import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '@/lib/api'
import type { UiSettings } from '@/lib/types'

export type Theme = 'light' | 'dark' | 'system'
export type ChartMode = 'continuous' | 'gated'
export type Language = 'en' | 'th' | 'jp'

// The 9 data fields we persist (excludes setter functions).
const DATA_KEYS: Array<keyof UiSettings> = [
  'theme',
  'accentHue',
  'sidebarCollapsed',
  'esp32Unit',
  'showClampCard',
  'chartMode',
  'minimalView',
  'language',
  'clampOffsetGf',
]

interface SettingsState extends UiSettings {
  // Async boot action — call once on app mount.
  // Fetches from backend and merges over current state.
  hydrateFromServer: () => Promise<void>
  setTheme: (t: Theme) => void
  setAccentHue: (h: number) => void
  setSidebarCollapsed: (v: boolean) => void
  setEsp32Unit: (u: 'gf' | 'N') => void
  setShowClampCard: (v: boolean) => void
  setChartMode: (m: ChartMode) => void
  setMinimalView: (v: boolean) => void
  setLanguage: (l: Language) => void
  setClampOffsetGf: (v: number) => void
}

// Internal flag: skip write-back while we're applying server data to avoid
// the hydration immediately echoing back to the server.
let _hydrating = false

// Debounce handle for write-through.
let _writeTimer: ReturnType<typeof setTimeout> | null = null

// DATA_KEYS is the single source of truth for the persisted field list — deriving
// the payload from it keeps the write-through in lockstep with the store shape so a
// newly added setting can't be silently dropped from the save.
function extractData(state: SettingsState): UiSettings {
  return Object.fromEntries(DATA_KEYS.map((k) => [k, state[k]])) as UiSettings
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // --- data fields (defaults) ---
      theme: 'system' as Theme,
      accentHue: 240,
      sidebarCollapsed: true,
      esp32Unit: 'gf' as 'gf' | 'N',
      showClampCard: false,
      chartMode: 'continuous' as ChartMode,
      minimalView: false,
      language: 'en' as Language,
      clampOffsetGf: 0,

      // --- async hydration ---
      hydrateFromServer: async () => {
        try {
          const serverData = await api.settings.get()
          // An empty object means the backend has no saved settings yet — nothing to merge.
          if (!serverData || Object.keys(serverData).length === 0) return
          // Backend wins on boot: drop any pending write-through so a value touched
          // during first paint can't echo back and clobber the freshly-hydrated data.
          if (_writeTimer !== null) { clearTimeout(_writeTimer); _writeTimer = null }
          _hydrating = true
          set(serverData)
        } catch (err) {
          // Backend unavailable on first paint — localStorage cache covers us.
          console.warn('[settings] hydrateFromServer failed:', err)
        } finally {
          _hydrating = false
        }
      },

      // --- setters ---
      setTheme: (t) => set({ theme: t }),
      setAccentHue: (h) => set({ accentHue: h }),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      setEsp32Unit: (u) => set({ esp32Unit: u }),
      setShowClampCard: (v) => set({ showClampCard: v }),
      setChartMode: (m) => set({ chartMode: m }),
      setMinimalView: (v) => set({ minimalView: v }),
      setLanguage: (l) => set({ language: l }),
      setClampOffsetGf: (v) => set({ clampOffsetGf: v }),
    }),
    { name: 'pmd-settings' }
  )
)

// Write-through: subscribe to store changes and debounce a PUT to the backend.
// Skips saves while hydration is in flight so we don't echo server data back.
useSettingsStore.subscribe((state) => {
  if (_hydrating) return
  if (_writeTimer !== null) clearTimeout(_writeTimer)
  _writeTimer = setTimeout(() => {
    _writeTimer = null
    api.settings.save(extractData(state)).catch((err) => {
      console.warn('[settings] write-through failed:', err)
    })
  }, 400)
})

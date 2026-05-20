import { Sun, Moon, Monitor, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/store/settings'

const THEME_OPTIONS = [
  { value: 'light' as const, Icon: Sun, label: 'Light', desc: 'Always light' },
  { value: 'system' as const, Icon: Monitor, label: 'System', desc: 'Follows OS setting' },
  { value: 'dark' as const, Icon: Moon, label: 'Dark', desc: 'Always dark' },
]

const ACCENT_PRESETS = [
  { hue: 240, label: 'Blue' },
  { hue: 280, label: 'Purple' },
  { hue: 150, label: 'Green' },
  { hue: 30, label: 'Orange' },
  { hue: 10, label: 'Red' },
]

export default function Settings() {
  const { theme, setTheme, accentHue, setAccentHue } = useSettingsStore()

  return (
    <div className="max-w-lg space-y-8">
      <h1 className="text-xl font-semibold">Settings</h1>

      {/* Theme section */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Theme</h2>
        <div className="grid grid-cols-3 gap-3">
          {THEME_OPTIONS.map(({ value, Icon, label, desc }) => {
            const active = theme === value
            return (
              <button
                key={value}
                onClick={() => setTheme(value)}
                className={cn(
                  'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-sm',
                  active
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
                )}
              >
                <Icon size={22} />
                <span className="font-medium">{label}</span>
                <span className="text-xs opacity-60">{desc}</span>
                {active && <Check size={14} className="text-primary" />}
              </button>
            )
          })}
        </div>
      </section>

      {/* Accent color section */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Accent Color</h2>
        <div className="flex gap-4">
          {ACCENT_PRESETS.map(({ hue, label }) => {
            const active = accentHue === hue
            return (
              <button
                key={hue}
                onClick={() => setAccentHue(hue)}
                title={label}
                className={cn(
                  'flex flex-col items-center gap-2 transition-all',
                  active ? 'scale-110' : 'hover:scale-105 opacity-70 hover:opacity-100'
                )}
              >
                <span
                  className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center',
                    active ? 'ring-2 ring-offset-2 ring-offset-background' : ''
                  )}
                  style={{ backgroundColor: `oklch(0.55 0.22 ${hue})` }}
                >
                  {active && <Check size={16} className="text-white" />}
                </span>
                <span className="text-xs text-muted-foreground">{label}</span>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

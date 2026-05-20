import { NavLink, Outlet } from 'react-router-dom'
import { Play, ClipboardList, History, Cpu, Settings2, ChevronLeft, ChevronRight, Sun, Moon, Monitor, Palette } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/store/settings'
import { TopBar } from '@/components/TopBar'

const NAV = [
  { to: '/run', label: 'Run Test', Icon: Play },
  { to: '/recipes', label: 'Recipes', Icon: ClipboardList },
  { to: '/history', label: 'History', Icon: History },
  { to: '/hardware', label: 'Hardware', Icon: Cpu },
  { to: '/settings', label: 'Settings', Icon: Settings2 },
]

const ACCENT_PRESETS = [
  { hue: 240, label: 'Blue' },
  { hue: 280, label: 'Purple' },
  { hue: 150, label: 'Green' },
  { hue: 30,  label: 'Orange' },
  { hue: 10,  label: 'Red' },
]

const THEME_OPTIONS = [
  { value: 'light' as const, Icon: Sun, label: 'Light' },
  { value: 'system' as const, Icon: Monitor, label: 'System' },
  { value: 'dark' as const, Icon: Moon, label: 'Dark' },
]

export default function Layout() {
  const { sidebarCollapsed, setSidebarCollapsed, theme, setTheme, accentHue, setAccentHue } = useSettingsStore()

  return (
    <div className="flex h-screen bg-background">
      <aside
        aria-label="Main navigation"
        className={cn(
          'bg-slate-900 text-slate-100 flex flex-col transition-all duration-200 shrink-0',
          sidebarCollapsed ? 'w-16' : 'w-56'
        )}
      >
        {/* Logo + collapse toggle */}
        <div className={cn(
          'flex items-center p-3 border-b border-slate-800',
          sidebarCollapsed ? 'justify-center' : 'justify-between'
        )}>
          {!sidebarCollapsed && (
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">Pinch Test</span>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 flex flex-col gap-1 p-2 pt-3">
          {NAV.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={sidebarCollapsed ? label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-2 py-2.5 rounded text-sm transition-colors',
                  sidebarCollapsed ? 'justify-center' : '',
                  isActive
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                )
              }
            >
              <Icon size={18} className="shrink-0" />
              {!sidebarCollapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Bottom controls: theme + accent */}
        <div className={cn(
          'border-t border-slate-800 p-2 flex flex-col gap-2',
          sidebarCollapsed ? 'items-center' : ''
        )}>
          {/* Theme buttons */}
          <div className={cn('flex gap-1', sidebarCollapsed ? 'flex-col' : 'flex-row')}>
            {THEME_OPTIONS.map(({ value, Icon: ThemeIcon, label }) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                title={label}
                className={cn(
                  'p-1.5 rounded transition-colors',
                  theme === value
                    ? 'bg-slate-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                )}
              >
                <ThemeIcon size={15} />
              </button>
            ))}
          </div>

          {/* Accent swatches (collapsed: palette icon expands sidebar) */}
          {sidebarCollapsed ? (
            <button
              onClick={() => setSidebarCollapsed(false)}
              title="Accent color (expand to pick)"
              className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <Palette size={15} />
            </button>
          ) : (
            <div className="flex gap-1.5 px-1 pb-1">
              {ACCENT_PRESETS.map(({ hue, label }) => (
                <button
                  key={hue}
                  onClick={() => setAccentHue(hue)}
                  title={label}
                  className={cn(
                    'w-5 h-5 rounded-full transition-all',
                    accentHue === hue
                      ? 'ring-2 ring-white ring-offset-1 ring-offset-slate-900 scale-110'
                      : 'hover:scale-110'
                  )}
                  style={{ backgroundColor: `oklch(0.55 0.22 ${hue})` }}
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        <div className="flex-1 overflow-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

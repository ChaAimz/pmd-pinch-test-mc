import { NavLink, Outlet } from 'react-router-dom'
import { Play, ClipboardList, History, Cpu, Settings2, ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/store/settings'
import { TopBar } from '@/components/TopBar'

export default function Layout() {
  const { t } = useTranslation()
  const { sidebarCollapsed, setSidebarCollapsed } = useSettingsStore()

  const NAV = [
    { to: '/run', label: t('nav.runTest'), Icon: Play },
    { to: '/recipes', label: t('nav.recipes'), Icon: ClipboardList },
    { to: '/history', label: t('nav.history'), Icon: History },
    { to: '/hardware', label: t('nav.hardware'), Icon: Cpu },
    { to: '/settings', label: t('nav.settings'), Icon: Settings2 },
  ]

  return (
    <div className="flex h-screen bg-background">
      <aside
        aria-label="Main navigation"
        className={cn(
          'flex flex-col shrink-0 transition-[width] duration-200 border-r',
          // Light: warm off-white with whisper-thin border
          'bg-zinc-50/80 backdrop-blur-sm border-zinc-300',
          // Dark: deep ink — distinct from main background, no harsh black
          'dark:bg-zinc-950 dark:border-zinc-700',
          sidebarCollapsed ? 'w-16' : 'w-60',
        )}
      >
        {/* Brand row + collapse toggle */}
        <div
          className={cn(
            'flex items-center h-14 px-4 border-b',
            'border-zinc-300 dark:border-zinc-700',
            sidebarCollapsed ? 'justify-center' : 'justify-between',
          )}
        >
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-zinc-900 dark:bg-zinc-100" />
              <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-700 dark:text-zinc-200">
                {t('nav.brand')}
              </span>
            </div>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className={cn(
              'p-1.5 rounded-md transition-colors',
              'text-zinc-400 hover:text-zinc-900 hover:bg-zinc-200/60',
              'dark:text-zinc-500 dark:hover:text-zinc-100 dark:hover:bg-zinc-800/60',
            )}
            title={sidebarCollapsed ? t('nav.expand') : t('nav.collapse')}
          >
            {sidebarCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 flex flex-col gap-0.5 p-2 pt-3">
          {NAV.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={sidebarCollapsed ? label : undefined}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 px-2.5 py-2 rounded-md text-sm font-medium transition-colors',
                  sidebarCollapsed && 'justify-center',
                  isActive
                    // Inverted-pill: active item flips sidebar's color scheme — Vercel/Linear feel
                    ? 'bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900'
                    : 'text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-50',
                )
              }
            >
              <Icon size={17} className="shrink-0" />
              {!sidebarCollapsed && <span className="truncate">{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Footer signature — subtle "version" or status hint */}
        {!sidebarCollapsed && (
          <div className="px-4 py-3 border-t border-zinc-300 dark:border-zinc-700">
            <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500 font-semibold">
              v0.1 · pmd
            </div>
          </div>
        )}
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

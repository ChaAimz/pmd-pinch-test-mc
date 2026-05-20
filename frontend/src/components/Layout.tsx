import { NavLink, Outlet } from 'react-router-dom'
import { Play, ClipboardList, History, Cpu, Settings2, ChevronLeft, ChevronRight } from 'lucide-react'
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

export default function Layout() {
  const { sidebarCollapsed, setSidebarCollapsed } = useSettingsStore()

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

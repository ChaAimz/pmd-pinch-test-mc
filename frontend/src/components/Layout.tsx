import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/run', label: 'Run Test' },
  { to: '/recipes', label: 'Recipes' },
  { to: '/history', label: 'History' },
  { to: '/hardware', label: 'Hardware' },
  { to: '/settings', label: 'Settings' },
]

export default function Layout() {
  return (
    <div className="flex h-screen bg-background">
      <aside aria-label="Main navigation" className="w-48 bg-slate-900 text-slate-100 flex flex-col gap-1 p-3 shrink-0">
        <div className="text-xs font-bold mb-4 px-2 text-slate-400 uppercase tracking-wider">
          Pinch Test
        </div>
        {NAV.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'block px-3 py-2 rounded text-sm transition-colors',
                isActive ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800'
              )
            }
          >
            {label}
          </NavLink>
        ))}
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}

import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import Layout from '@/components/Layout'
import { ThemeProvider } from '@/components/ThemeProvider'
import Run from '@/pages/Run'
import Recipes from '@/pages/Recipes'
import Settings from '@/pages/Settings'

function Placeholder({ title }: { title: string }) {
  return <div className="text-slate-400 p-4">{title} — Plan 4</div>
}

export default function App() {
  useEffect(() => {
    // WS singleton init — imported lazily to avoid circular dep at module load
    import('@/lib/ws').then(({ getWsClient }) => getWsClient()).catch((err: unknown) => {
      if (import.meta.env.DEV) console.warn('[ws] init failed:', err)
    })
  }, [])

  return (
    <>
      <ThemeProvider />
      <Toaster />
      <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/run" replace />} />
        <Route path="run" element={<Run />} />
        <Route path="recipes" element={<Recipes />} />
        <Route path="history" element={<Placeholder title="History" />} />
        <Route path="hardware" element={<Placeholder title="Hardware" />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
    </>
  )
}

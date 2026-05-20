import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import Layout from '@/components/Layout'
import { ThemeProvider } from '@/components/ThemeProvider'
import Run from '@/pages/Run'
import Recipes from '@/pages/Recipes'
import History from '@/pages/History'
import HistoryDetail from '@/pages/HistoryDetail'
import Hardware from '@/pages/Hardware'
import Settings from '@/pages/Settings'

export default function App() {
  useEffect(() => {
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
          <Route path="history" element={<History />} />
          <Route path="history/:id" element={<HistoryDetail />} />
          <Route path="hardware" element={<Hardware />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </>
  )
}

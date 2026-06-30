import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { useSettingsStore } from '@/store/settings'
import { Toaster } from '@/components/ui/sonner'
import Layout from '@/components/Layout'
import { ThemeProvider } from '@/components/ThemeProvider'
import { EmergencyStopOverlay } from '@/components/EmergencyStopOverlay'
import { ClampForceAlarmDialog } from '@/components/ClampForceAlarmDialog'
import { MaxStrokeAlarmDialog } from '@/components/MaxStrokeAlarmDialog'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useWsHandlers } from '@/hooks/useWsHandlers'
import { api } from '@/lib/api'
import Run from '@/pages/Run'
import Recipes from '@/pages/Recipes'
import History from '@/pages/History'
import HistoryDetail from '@/pages/HistoryDetail'
import CompareCoF from '@/pages/CompareCoF'
import Hardware from '@/pages/Hardware'
import Settings from '@/pages/Settings'

export default function App() {
  const { i18n } = useTranslation()
  const language = useSettingsStore((s) => s.language)
  useEffect(() => { i18n.changeLanguage(language) }, [language, i18n])

  // Hydrate settings from SQLite on boot. Backend wins over the localStorage
  // paint cache — ensures settings survive force-shutdown of the kiosk browser.
  useEffect(() => { useSettingsStore.getState().hydrateFromServer() }, [])

  // Boots WS client (singleton via getWsClient inside the hook) + wires all subscriptions.
  useWsHandlers()

  // Prefetch recipes at root so the Run page Select is populated on first visit.
  // staleTime keeps the cache hot for 60 s — avoids a double fetch when navigating
  // between Run ↔ Recipes within that window.
  useQuery({ queryKey: ['recipes'], queryFn: api.recipes.list, staleTime: 60_000 })

  return (
    <>
      <ThemeProvider />
      <Toaster />
      <EmergencyStopOverlay />
      <ClampForceAlarmDialog />
      <MaxStrokeAlarmDialog />
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/run" replace />} />
            <Route path="run" element={<Run />} />
            <Route path="recipes" element={<Recipes />} />
            <Route path="history" element={<History />} />
            <Route path="history/compare" element={<CompareCoF />} />
            <Route path="history/:id" element={<HistoryDetail />} />
            <Route path="hardware" element={<Hardware />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </>
  )
}

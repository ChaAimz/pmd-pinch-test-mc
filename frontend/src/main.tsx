// Must be first: patches zrender's Edge-Chromium touch misdetection before any
// ECharts chart initialises. See lib/echarts-touch-fix.ts for the full rationale.
import './lib/echarts-touch-fix'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './i18n'
import './index.css'

const queryClient = new QueryClient({
  // gcTime bounds how long INACTIVE queries (e.g. a previous run's per-loop waveforms,
  // or History detail waveforms after navigating away) linger before eviction. Without
  // it, TanStack's 5-min default let back-to-back runs stack hundreds of cached
  // full-resolution waveforms in the heap. 60 s is ample for normal navigation.
  defaultOptions: { queries: { retry: 1, staleTime: 10_000, gcTime: 60_000 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
)

// DEV-only heap/leak probe (window.__leak). Tree-shaken from production builds.
if (import.meta.env.DEV) {
  void import('./lib/leakProbe').then((m) => m.installLeakProbe(queryClient)).catch(() => {})
}

// Kiosk heap guard. React 19's DEVELOPMENT build (which the kiosk runs via `npm run dev`,
// see start-pinch.bat) emits a performance.measure() for every render/commit to feed the
// DevTools "⚛️ React" performance track. Those measure entries are NEVER auto-evicted
// (unlike resource timing, capped at 250), so during a test loop they accumulate at
// ~27k/loop → ~0.65 MB/loop of unreclaimable heap that grows until the kiosk browser
// bogs down. Periodically dropping them bounds the buffer to a few MB. Production builds
// emit none, so this is a cheap no-op there. (Proper fix: serve a production build.)
if (typeof performance !== 'undefined' && typeof performance.clearMeasures === 'function') {
  setInterval(() => performance.clearMeasures(), 15_000)
}

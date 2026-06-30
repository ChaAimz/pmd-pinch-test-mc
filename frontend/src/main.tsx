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

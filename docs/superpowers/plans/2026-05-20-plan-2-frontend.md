# Plan 2 — Frontend: Vite + React + ShadcnUI + uPlot

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the operator-facing React SPA — Recipes CRUD and a real-time Run page with uPlot force waveform — connected to the FastAPI backend via REST and WebSocket.

**Architecture:** Vite 6 + React 19 + TypeScript SPA. Two Zustand stores (app state + chart buffers). `lib/ws.ts` singleton dispatches typed WebSocket messages into stores. uPlot renders at 20 FPS from ring buffers. ShadcnUI for components. React Query for REST. Vite proxy forwards `/api` and `/ws` to `:8000`.

**Prerequisite:** Tasks 1–9 work immediately. Tasks 10–11 (Run page WS features) require Phase C (Plan 1 Tasks 15–21) — the `/ws` and `/api/sessions` endpoints must exist first.

**Tech Stack:** Vite 6, React 19, TypeScript 5.6+, Tailwind CSS 4 (`@tailwindcss/vite`), ShadcnUI, uPlot 1.6, Zustand 5, react-router-dom 7, @tanstack/react-query 5, react-hook-form, Vitest + @testing-library/react, Playwright.

**Spec reference:** `docs/superpowers/specs/2026-05-19-pinch-test-machine-design.md` §7 (WebSocket messages), §8 (REST API), §10 (UI pages).

---

## File Structure

```
frontend/
├── package.json
├── vite.config.ts              ← Tailwind plugin + proxy + @/* alias
├── tsconfig.json
├── index.html
├── components.json             ← shadcn config
├── vitest.config.ts
├── playwright.config.ts
├── src/
│   ├── main.tsx
│   ├── App.tsx                 ← QueryClientProvider + BrowserRouter + routes + WS init
│   ├── index.css               ← @import "tailwindcss" + ShadcnUI CSS vars
│   ├── test-setup.ts
│   ├── lib/
│   │   ├── ws.ts               ← WebSocket singleton, auto-reconnect, typed dispatch
│   │   ├── api.ts              ← fetch wrapper for all REST endpoints
│   │   └── types.ts            ← shared TypeScript types
│   ├── store/
│   │   ├── app.ts              ← machine state, hw status, run info, loop results
│   │   └── chart.ts            ← rolling ring buffers for Imada + ESP32 waveforms
│   ├── components/
│   │   ├── ui/                 ← ShadcnUI generated (do not edit manually)
│   │   ├── Layout.tsx          ← sidebar nav + <Outlet />
│   │   ├── StateBadge.tsx      ← colored badge per machine state string
│   │   ├── HwStatusBar.tsx     ← 3 dots: PLC / Imada / ESP32
│   │   └── WaveformChart.tsx   ← two stacked uPlot charts (Imada, ESP32)
│   ├── pages/
│   │   ├── Run.tsx             ← main operator page
│   │   ├── Recipes.tsx         ← recipe list + delete
│   │   └── RecipeForm.tsx      ← create/edit dialog form
│   └── hooks/
│       └── useSessionControl.ts ← start / stop / e-stop REST calls
├── tests/
│   ├── unit/
│   │   ├── ws.test.ts
│   │   ├── store-app.test.ts
│   │   └── store-chart.test.ts
│   └── e2e/
│       └── recipes.spec.ts
```

---

### Task 1: Vite scaffold + Tailwind 4 + TypeScript

**Files:**
- Create: `frontend/package.json` and full scaffold
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/test-setup.ts`
- Create: `frontend/src/index.css`

- [ ] **Step 1: Create Vite scaffold**

From repo root:
```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
```

- [ ] **Step 2: Install all runtime + dev dependencies**

```bash
npm install react-router-dom @tanstack/react-query zustand uplot react-hook-form
npm install tailwindcss @tailwindcss/vite
npm install -D vitest @vitest/ui @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom @playwright/test
```

- [ ] **Step 3: Replace `frontend/vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8000', ws: true, changeOrigin: true },
    },
  },
})
```

- [ ] **Step 4: Replace `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "tests/unit"]
}
```

- [ ] **Step 5: Create `frontend/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
})
```

- [ ] **Step 6: Create `frontend/src/test-setup.ts`**

```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 7: Replace `frontend/src/index.css`**

```css
@import "tailwindcss";

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
    --radius: 0.5rem;
  }
  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 212.7 26.8% 83.9%;
  }
}
```

- [ ] **Step 8: Verify dev server**

```bash
npm run dev
```

Expected: Vite starts on `http://localhost:5173`, default React page visible, no errors.

- [ ] **Step 9: Commit**

```bash
cd ..
git add frontend/
git commit -m "feat(frontend): scaffold Vite 6 + React 19 + TypeScript + Tailwind 4"
```

---

### Task 2: ShadcnUI init + components

**Files:**
- Create: `frontend/components.json`
- Create: `frontend/src/lib/utils.ts` (auto-generated)
- Create: `frontend/src/components/ui/` (auto-generated)

- [ ] **Step 1: Run shadcn init**

```bash
cd frontend
npx shadcn@latest init
```

Prompts → answer:
- Style: **Default**
- Color: **Slate**
- CSS variables: **Yes**
- Global CSS path: `src/index.css`
- Components path: `src/components/ui`
- TypeScript: **Yes**
- React Server Components: **No**

- [ ] **Step 2: Add required ShadcnUI components**

```bash
npx shadcn@latest add button input label dialog alert-dialog table badge select form toast
```

- [ ] **Step 3: Verify `src/lib/utils.ts` has `cn()`**

```typescript
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

If missing, create it and install:
```bash
npm install clsx tailwind-merge
```

- [ ] **Step 4: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): ShadcnUI init + button/input/dialog/table/badge/select/form"
```

---

### Task 3: App shell — React Router + Layout

**Files:**
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/components/Layout.tsx`
- Create: `frontend/src/pages/Run.tsx` (stub)
- Create: `frontend/src/pages/Recipes.tsx` (stub)

- [ ] **Step 1: Replace `frontend/src/main.tsx`**

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
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
```

- [ ] **Step 2: Create `frontend/src/components/Layout.tsx`**

```typescript
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
    <div className="flex h-screen bg-slate-50">
      <aside className="w-48 bg-slate-900 text-slate-100 flex flex-col gap-1 p-3 shrink-0">
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
```

- [ ] **Step 3: Replace `frontend/src/App.tsx`**

```typescript
import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from '@/components/Layout'
import Run from '@/pages/Run'
import Recipes from '@/pages/Recipes'

function Placeholder({ title }: { title: string }) {
  return <div className="text-slate-400 p-4">{title} — Plan 4</div>
}

export default function App() {
  useEffect(() => {
    // WS singleton init — imported lazily to avoid circular dep at module load
    import('@/lib/ws').then(({ getWsClient }) => getWsClient())
  }, [])

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/run" replace />} />
        <Route path="run" element={<Run />} />
        <Route path="recipes" element={<Recipes />} />
        <Route path="history" element={<Placeholder title="History" />} />
        <Route path="hardware" element={<Placeholder title="Hardware" />} />
        <Route path="settings" element={<Placeholder title="Settings" />} />
      </Route>
    </Routes>
  )
}
```

- [ ] **Step 4: Create stub pages**

`frontend/src/pages/Run.tsx`:
```typescript
export default function Run() {
  return <div className="text-slate-400">Run page — Task 10</div>
}
```

`frontend/src/pages/Recipes.tsx`:
```typescript
export default function Recipes() {
  return <div className="text-slate-400">Recipes page — Task 9</div>
}
```

- [ ] **Step 5: Verify routing**

```bash
npm run dev
```

Open `http://localhost:5173`. Sidebar with 5 links visible. Navigate to each — stub content appears.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/
git commit -m "feat(frontend): App shell + React Router + Layout sidebar"
```

---

### Task 4: `lib/ws.ts` — WebSocket singleton

**Files:**
- Create: `frontend/src/lib/ws.ts`
- Create: `frontend/src/lib/types.ts`
- Create: `frontend/tests/unit/ws.test.ts`

- [ ] **Step 1: Create `frontend/src/lib/types.ts`**

```typescript
export interface Recipe {
  id: number
  name: string
  actuator_position_mm: number
  speed_mm_s: number
  clamp_threshold_n: number
  loops: number
  hold_time_ms: number
  min_force_n: number | null
  max_force_n: number | null
  created_at: string
  updated_at: string
}
export type RecipeCreate = Omit<Recipe, 'id' | 'created_at' | 'updated_at'>
export type RecipeUpdate = Partial<RecipeCreate>

export interface WsSample { t_ms: number; force_n: number }
export interface WsStateChange { type: 'state_change'; from: string; to: string; run_id?: number; loop?: number }
export interface WsHwStatus { type: 'hw_status'; plc: boolean; imada: boolean; esp32: boolean }
export interface WsLoopResult { type: 'loop_result'; loop: number; result: 'pass' | 'fail'; peak_n: number; hold_ms: number }
export interface WsRunFinished { type: 'run_finished'; run_id: number; passed: number; failed: number }
export interface WsImadaBatch { type: 'imada_batch'; samples: WsSample[] }
export interface WsEsp32Batch { type: 'esp32_batch'; samples: WsSample[] }
export interface WsError { type: 'error'; message: string }
```

- [ ] **Step 2: Write failing test**

`frontend/tests/unit/ws.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WsClient } from '@/lib/ws'

class MockWS {
  static instances: MockWS[] = []
  onopen: (() => void) | null = null
  onclose: ((e: CloseEvent) => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  readyState = WebSocket.CONNECTING
  url: string
  constructor(url: string) { this.url = url; MockWS.instances.push(this) }
  send = vi.fn()
  close = vi.fn()
  open() { this.readyState = WebSocket.OPEN; this.onopen?.() }
  receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }
}

beforeEach(() => { MockWS.instances = []; vi.stubGlobal('WebSocket', MockWS) })
afterEach(() => vi.unstubAllGlobals())

describe('WsClient', () => {
  it('connects on construction', () => {
    const c = new WsClient('/ws'); expect(MockWS.instances).toHaveLength(1); c.destroy()
  })
  it('dispatches typed messages to handlers', () => {
    const c = new WsClient('/ws')
    const handler = vi.fn()
    c.on('state_change', handler)
    MockWS.instances[0].open()
    MockWS.instances[0].receive({ type: 'state_change', from: 'IDLE', to: 'LOOP_BEGIN' })
    expect(handler).toHaveBeenCalledWith({ type: 'state_change', from: 'IDLE', to: 'LOOP_BEGIN' })
    c.destroy()
  })
  it('fires onConnected callback', () => {
    const cb = vi.fn()
    const c = new WsClient('/ws', { onConnected: cb })
    MockWS.instances[0].open()
    expect(cb).toHaveBeenCalled()
    c.destroy()
  })
  it('off() unregisters handler', () => {
    const c = new WsClient('/ws')
    const handler = vi.fn()
    const off = c.on('hw_status', handler)
    off()
    MockWS.instances[0].open()
    MockWS.instances[0].receive({ type: 'hw_status', plc: true, imada: false, esp32: false })
    expect(handler).not.toHaveBeenCalled()
    c.destroy()
  })
})
```

- [ ] **Step 3: Run test — verify FAIL**

```bash
npx vitest run tests/unit/ws.test.ts
```
Expected: FAIL — `WsClient` not found.

- [ ] **Step 4: Create `frontend/src/lib/ws.ts`**

```typescript
type Handler<T = unknown> = (msg: T) => void

interface WsOptions {
  onConnected?: () => void
  onDisconnected?: () => void
  reconnectBaseMs?: number
}

export class WsClient {
  private ws: WebSocket | null = null
  private handlers = new Map<string, Handler[]>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private attempts = 0
  private destroyed = false

  constructor(private readonly url: string, private readonly opts: WsOptions = {}) {
    this.connect()
  }

  private connect() {
    if (this.destroyed) return
    this.ws = new WebSocket(this.url)
    this.ws.onopen = () => { this.attempts = 0; this.opts.onConnected?.() }
    this.ws.onclose = () => {
      if (this.destroyed) return
      this.opts.onDisconnected?.()
      const delay = Math.min(30_000, (this.opts.reconnectBaseMs ?? 1_000) * 2 ** this.attempts)
      this.attempts++
      this.reconnectTimer = setTimeout(() => this.connect(), delay)
    }
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string)
        const type: string = msg?.type
        if (!type) return
        ;(this.handlers.get(type) ?? []).forEach(h => h(msg))
        ;(this.handlers.get('*') ?? []).forEach(h => h(msg))
      } catch { /* non-JSON ignored */ }
    }
  }

  on<T = unknown>(type: string, handler: Handler<T>): () => void {
    const list = this.handlers.get(type) ?? []
    list.push(handler as Handler)
    this.handlers.set(type, list)
    return () => {
      this.handlers.set(type, (this.handlers.get(type) ?? []).filter(h => h !== handler))
    }
  }

  send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  destroy() {
    this.destroyed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close(); this.ws = null
  }
}

// Singleton wired to stores — created lazily
let _client: WsClient | null = null

export function getWsClient(): WsClient {
  if (_client) return _client
  const { useAppStore } = await_import_app_store()
  const { useChartStore } = await_import_chart_store()

  _client = new WsClient('/ws', {
    onConnected: () => useAppStore.getState().setWsConnected(true),
    onDisconnected: () => useAppStore.getState().setWsConnected(false),
  })
  _client.on('state_change', (m: any) => useAppStore.getState().handleStateChange(m))
  _client.on('hw_status', (m: any) => useAppStore.getState().setHwStatus(m))
  _client.on('loop_result', (m: any) => useAppStore.getState().addLoopResult(m))
  _client.on('run_finished', (m: any) => useAppStore.getState().setRunFinished(m))
  _client.on('imada_batch', (m: any) => useChartStore.getState().pushImadaBatch(m.samples))
  _client.on('esp32_batch', (m: any) => useChartStore.getState().pushEsp32Batch(m.samples))
  return _client
}

// Break circular import at module level — stores import nothing from ws.ts
function await_import_app_store() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/store/app') as { useAppStore: import('@/store/app').AppStoreType }
}
function await_import_chart_store() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/store/chart') as { useChartStore: import('@/store/chart').ChartStoreType }
}
```

**Note:** The `require()` trick for circular-dep avoidance works in Vite/Vitest because both stores are CommonJS-compatible. If Vite complains, replace with a module-level import after the store files exist (no actual circular dep at runtime).

Simpler alternative — just use top-level imports (no circular dep in practice):
```typescript
import { useAppStore } from '@/store/app'
import { useChartStore } from '@/store/chart'
```
Replace the `await_import_*` calls with direct store references. Use this if the require() approach causes issues.

- [ ] **Step 5: Run test — verify PASS**

```bash
npx vitest run tests/unit/ws.test.ts
```
Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/ frontend/tests/unit/ws.test.ts
git commit -m "feat(frontend): WsClient singleton with auto-reconnect + typed dispatch"
```

---

### Task 5: Zustand stores

**Files:**
- Create: `frontend/src/store/app.ts`
- Create: `frontend/src/store/chart.ts`
- Create: `frontend/tests/unit/store-app.test.ts`
- Create: `frontend/tests/unit/store-chart.test.ts`

- [ ] **Step 1: Write failing tests**

`frontend/tests/unit/store-app.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore, initialAppState } from '@/store/app'

beforeEach(() => useAppStore.setState(initialAppState))

describe('useAppStore', () => {
  it('starts IDLE, ws disconnected', () => {
    const s = useAppStore.getState()
    expect(s.machineState).toBe('IDLE')
    expect(s.wsConnected).toBe(false)
    expect(s.hwStatus).toEqual({ plc: false, imada: false, esp32: false })
  })
  it('handleStateChange updates state + run info', () => {
    useAppStore.getState().handleStateChange({ type: 'state_change', from: 'IDLE', to: 'LOOP_BEGIN', run_id: 7, loop: 1 })
    const s = useAppStore.getState()
    expect(s.machineState).toBe('LOOP_BEGIN')
    expect(s.currentRunId).toBe(7)
    expect(s.currentLoop).toBe(1)
  })
  it('addLoopResult accumulates results', () => {
    useAppStore.getState().addLoopResult({ type: 'loop_result', loop: 1, result: 'pass', peak_n: 50, hold_ms: 300 })
    useAppStore.getState().addLoopResult({ type: 'loop_result', loop: 2, result: 'fail', peak_n: 20, hold_ms: 100 })
    expect(useAppStore.getState().loopResults).toHaveLength(2)
  })
  it('resetRun clears run context', () => {
    useAppStore.getState().handleStateChange({ type: 'state_change', from: 'IDLE', to: 'LOOP_BEGIN', run_id: 1, loop: 1 })
    useAppStore.getState().resetRun()
    expect(useAppStore.getState().currentRunId).toBeNull()
    expect(useAppStore.getState().loopResults).toHaveLength(0)
  })
})
```

`frontend/tests/unit/store-chart.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useChartStore, MAX_SAMPLES, initialChartState } from '@/store/chart'

beforeEach(() => useChartStore.setState(initialChartState()))

describe('useChartStore', () => {
  it('starts with zero count', () => {
    expect(useChartStore.getState().imadaCount).toBe(0)
    expect(useChartStore.getState().esp32Count).toBe(0)
  })
  it('pushImadaBatch appends samples', () => {
    useChartStore.getState().pushImadaBatch([{ t_ms: 100, force_n: 1.5 }, { t_ms: 150, force_n: 2.0 }])
    expect(useChartStore.getState().imadaCount).toBe(2)
  })
  it('pushEsp32Batch appends samples', () => {
    useChartStore.getState().pushEsp32Batch([{ t_ms: 200, force_n: 5.0 }])
    expect(useChartStore.getState().esp32Count).toBe(1)
  })
  it('wraps at MAX_SAMPLES', () => {
    const big = Array.from({ length: MAX_SAMPLES + 5 }, (_, i) => ({ t_ms: i * 10, force_n: i * 0.1 }))
    useChartStore.getState().pushImadaBatch(big)
    expect(useChartStore.getState().imadaCount).toBe(MAX_SAMPLES)
  })
  it('clear resets both channels', () => {
    useChartStore.getState().pushImadaBatch([{ t_ms: 1, force_n: 1 }])
    useChartStore.getState().clear()
    expect(useChartStore.getState().imadaCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests — verify FAIL**

```bash
npx vitest run tests/unit/store-app.test.ts tests/unit/store-chart.test.ts
```
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `frontend/src/store/app.ts`**

```typescript
import { create } from 'zustand'

export interface HwStatus { plc: boolean; imada: boolean; esp32: boolean }
export interface LoopResult { loop: number; result: 'pass' | 'fail'; peak_n: number; hold_ms: number }

interface AppState {
  wsConnected: boolean
  machineState: string
  currentRunId: number | null
  currentLoop: number | null
  hwStatus: HwStatus
  loopResults: LoopResult[]
  setWsConnected: (v: boolean) => void
  handleStateChange: (msg: { type: string; from: string; to: string; run_id?: number; loop?: number }) => void
  setHwStatus: (msg: { type: string; plc: boolean; imada: boolean; esp32: boolean }) => void
  addLoopResult: (msg: { type: string; loop: number; result: 'pass' | 'fail'; peak_n: number; hold_ms: number }) => void
  setRunFinished: (msg: { type: string; run_id: number; passed: number; failed: number }) => void
  resetRun: () => void
}

export const initialAppState = {
  wsConnected: false,
  machineState: 'IDLE',
  currentRunId: null as number | null,
  currentLoop: null as number | null,
  hwStatus: { plc: false, imada: false, esp32: false } as HwStatus,
  loopResults: [] as LoopResult[],
}

export type AppStoreType = typeof useAppStore

export const useAppStore = create<AppState>((set) => ({
  ...initialAppState,
  setWsConnected: (v) => set({ wsConnected: v }),
  handleStateChange: ({ to, run_id, loop }) =>
    set((s) => ({
      machineState: to,
      currentRunId: run_id ?? s.currentRunId,
      currentLoop: loop ?? s.currentLoop,
    })),
  setHwStatus: ({ plc, imada, esp32 }) => set({ hwStatus: { plc, imada, esp32 } }),
  addLoopResult: ({ type: _t, ...r }) =>
    set((s) => ({ loopResults: [...s.loopResults, r] })),
  setRunFinished: (_msg) => set({ machineState: 'IDLE' }),
  resetRun: () => set({ ...initialAppState }),
}))
```

- [ ] **Step 4: Create `frontend/src/store/chart.ts`**

```typescript
import { create } from 'zustand'

export const MAX_SAMPLES = 6000  // 60s at 100Hz

interface ChannelState {
  timestamps: Float64Array
  force: Float32Array
  count: number
  head: number
}

interface ChartState {
  imada: ChannelState
  esp32: ChannelState
  imadaCount: number  // shortcut for tests
  esp32Count: number
  pushImadaBatch: (samples: { t_ms: number; force_n: number }[]) => void
  pushEsp32Batch: (samples: { t_ms: number; force_n: number }[]) => void
  clear: () => void
}

function makeChannel(): ChannelState {
  return { timestamps: new Float64Array(MAX_SAMPLES), force: new Float32Array(MAX_SAMPLES), count: 0, head: 0 }
}

export function initialChartState() {
  return {
    imada: makeChannel(),
    esp32: makeChannel(),
    imadaCount: 0,
    esp32Count: 0,
  }
}

function pushSamples(ch: ChannelState, samples: { t_ms: number; force_n: number }[]): ChannelState {
  const ts = ch.timestamps.slice()
  const force = ch.force.slice()
  let { count, head } = ch
  for (const { t_ms, force_n } of samples) {
    ts[head] = t_ms
    force[head] = force_n
    head = (head + 1) % MAX_SAMPLES
    if (count < MAX_SAMPLES) count++
  }
  return { timestamps: ts, force, count, head }
}

export type ChartStoreType = typeof useChartStore

export const useChartStore = create<ChartState>((set) => ({
  ...initialChartState(),
  pushImadaBatch: (samples) =>
    set((s) => {
      const imada = pushSamples(s.imada, samples)
      return { imada, imadaCount: imada.count }
    }),
  pushEsp32Batch: (samples) =>
    set((s) => {
      const esp32 = pushSamples(s.esp32, samples)
      return { esp32, esp32Count: esp32.count }
    }),
  clear: () => set(initialChartState()),
}))
```

- [ ] **Step 5: Run tests — verify PASS**

```bash
npx vitest run tests/unit/store-app.test.ts tests/unit/store-chart.test.ts
```
Expected: 9 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/store/ frontend/tests/unit/store-*.test.ts
git commit -m "feat(frontend): Zustand stores — app state + chart ring buffers"
```

---

### Task 6: `lib/api.ts`

**Files:**
- Create: `frontend/src/lib/api.ts`

- [ ] **Step 1: Create `frontend/src/lib/api.ts`**

```typescript
import type { Recipe, RecipeCreate, RecipeUpdate } from './types'

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status}: ${detail}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  recipes: {
    list: () => req<Recipe[]>('GET', '/recipes'),
    get: (id: number) => req<Recipe>('GET', `/recipes/${id}`),
    create: (data: RecipeCreate) => req<Recipe>('POST', '/recipes', data),
    update: (id: number, data: RecipeUpdate) => req<Recipe>('PUT', `/recipes/${id}`, data),
    delete: (id: number) => req<void>('DELETE', `/recipes/${id}`),
  },
  sessions: {
    start: (recipeId: number) => req<{ run_id: number }>('POST', '/sessions', { recipe_id: recipeId }),
    stop: () => req<void>('DELETE', '/sessions/current'),
  },
  runs: {
    list: () => req<{ id: number; recipe_name: string; status: string; created_at: string; passed: number; failed: number }[]>('GET', '/runs'),
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(frontend): REST API client with recipes + sessions + runs"
```

---

### Task 7: Shared display components

**Files:**
- Create: `frontend/src/components/StateBadge.tsx`
- Create: `frontend/src/components/HwStatusBar.tsx`

- [ ] **Step 1: Create `frontend/src/components/StateBadge.tsx`**

```typescript
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const COLORS: Record<string, string> = {
  IDLE: 'bg-slate-200 text-slate-700',
  WRITE_PLC_PARAMS: 'bg-blue-100 text-blue-800',
  LOOP_BEGIN: 'bg-blue-200 text-blue-900',
  CLAMP_PRESSED: 'bg-amber-200 text-amber-900',
  WAIT_CLAMP_FORCE: 'bg-amber-300 text-amber-900',
  WAIT_B5: 'bg-purple-200 text-purple-900',
  TENSION_CHECK: 'bg-purple-300 text-purple-900',
  EVALUATE: 'bg-indigo-200 text-indigo-900',
  UNCLAMP: 'bg-teal-200 text-teal-900',
  DONE_B7: 'bg-green-200 text-green-900',
  ABORTED: 'bg-red-100 text-red-800',
  ERROR: 'bg-red-300 text-red-900',
}

export function StateBadge({ state }: { state: string }) {
  return (
    <Badge className={cn('font-mono text-sm px-3 py-1', COLORS[state] ?? 'bg-slate-200 text-slate-700')}>
      {state}
    </Badge>
  )
}
```

- [ ] **Step 2: Create `frontend/src/components/HwStatusBar.tsx`**

```typescript
import { cn } from '@/lib/utils'
import type { HwStatus } from '@/store/app'

function Dot({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <span className={cn('inline-block w-2.5 h-2.5 rounded-full', ok ? 'bg-green-500' : 'bg-red-400')} />
      <span className={ok ? 'text-slate-700' : 'text-slate-400'}>{label}</span>
    </span>
  )
}

export function HwStatusBar({ status }: { status: HwStatus }) {
  return (
    <div className="flex gap-5 items-center px-4 py-2 bg-white border rounded-lg shadow-sm">
      <Dot label="PLC" ok={status.plc} />
      <Dot label="Imada" ok={status.imada} />
      <Dot label="ESP32" ok={status.esp32} />
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/StateBadge.tsx frontend/src/components/HwStatusBar.tsx
git commit -m "feat(frontend): StateBadge + HwStatusBar display components"
```

---

### Task 8: `WaveformChart.tsx` — uPlot (two stacked charts)

**Files:**
- Create: `frontend/src/components/WaveformChart.tsx`

Imada and ESP32 have independent sample times — rendered as two stacked uPlot instances sharing a container. 20 FPS via `setInterval(50ms)`. Ring buffer linearized before each render.

- [ ] **Step 1: Create `frontend/src/components/WaveformChart.tsx`**

```typescript
import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { useChartStore, MAX_SAMPLES } from '@/store/chart'
import type { ChannelState } from '@/store/chart'

function linearize(ch: ChannelState): [number[], number[]] {
  const { timestamps, force, count, head } = ch
  if (count === 0) return [[], []]
  const ts: number[] = []
  const f: number[] = []
  const start = count < MAX_SAMPLES ? 0 : head
  for (let i = 0; i < count; i++) {
    const idx = (start + i) % MAX_SAMPLES
    ts.push(timestamps[idx] / 1000)  // ms → s
    f.push(force[idx])
  }
  return [ts, f]
}

function makeOpts(label: string, color: string, width: number): uPlot.Options {
  return {
    width,
    height: 180,
    series: [
      {},
      { label, stroke: color, width: 1.5 },
    ],
    axes: [
      { label: 'Time (s)', size: 40 },
      { label: 'Force (N)', size: 50 },
    ],
    cursor: { show: false },
  }
}

function Chart({ label, color, selector }: {
  label: string
  color: string
  selector: (s: ReturnType<typeof useChartStore.getState>) => ChannelState
}) {
  const ref = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const w = ref.current.clientWidth || 900
    plotRef.current = new uPlot(makeOpts(label, color, w), [[], []], ref.current)

    intervalRef.current = setInterval(() => {
      const ch = selector(useChartStore.getState())
      if (ch.count > 0 && plotRef.current) {
        const [ts, force] = linearize(ch)
        plotRef.current.setData([ts, force])
      }
    }, 50)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      plotRef.current?.destroy()
      plotRef.current = null
    }
  }, [])

  return <div ref={ref} className="w-full" />
}

export function WaveformChart() {
  return (
    <div className="flex flex-col gap-2">
      <Chart label="Imada (N)" color="rgb(59,130,246)" selector={(s) => s.imada} />
      <Chart label="ESP32 (N)" color="rgb(34,197,94)" selector={(s) => s.esp32} />
    </div>
  )
}
```

**Note:** Export `ChannelState` type from `store/chart.ts` (add `export interface ChannelState` or `export type ChannelState`).

- [ ] **Step 2: Add `ChannelState` export to `store/chart.ts`**

Open `frontend/src/store/chart.ts` and ensure the interface is exported:
```typescript
export interface ChannelState {
  timestamps: Float64Array
  force: Float32Array
  count: number
  head: number
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no errors (fix any that appear — most likely missing type exports).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/WaveformChart.tsx frontend/src/store/chart.ts
git commit -m "feat(frontend): WaveformChart — two uPlot instances at 20 FPS from ring buffer"
```

---

### Task 9: Recipes page — full CRUD

**Files:**
- Modify: `frontend/src/pages/Recipes.tsx`
- Create: `frontend/src/pages/RecipeForm.tsx`

Works against existing `/api/recipes` — backend must be running.

- [ ] **Step 1: Replace `frontend/src/pages/Recipes.tsx`**

```typescript
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { api } from '@/lib/api'
import type { Recipe } from '@/lib/types'
import { RecipeForm } from './RecipeForm'

export default function Recipes() {
  const qc = useQueryClient()
  const [edit, setEdit] = useState<Recipe | null>(null)
  const [open, setOpen] = useState(false)

  const { data: recipes = [], isLoading } = useQuery({ queryKey: ['recipes'], queryFn: api.recipes.list })
  const del = useMutation({ mutationFn: (id: number) => api.recipes.delete(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['recipes'] }) })

  const openAdd = () => { setEdit(null); setOpen(true) }
  const openEdit = (r: Recipe) => { setEdit(r); setOpen(true) }
  const saved = () => { setOpen(false); qc.invalidateQueries({ queryKey: ['recipes'] }) }

  if (isLoading) return <div className="text-slate-400 animate-pulse">Loading…</div>

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <h1 className="text-xl font-semibold">Recipes</h1>
        <Button onClick={openAdd}>+ New Recipe</Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{edit ? 'Edit Recipe' : 'New Recipe'}</DialogTitle>
          </DialogHeader>
          <RecipeForm recipe={edit} onSaved={saved} />
        </DialogContent>
      </Dialog>

      <div className="bg-white border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Position (mm)</TableHead>
              <TableHead>Speed (mm/s)</TableHead>
              <TableHead>Threshold (N)</TableHead>
              <TableHead>Loops</TableHead>
              <TableHead>Min / Max (N)</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {recipes.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{r.actuator_position_mm}</TableCell>
                <TableCell>{r.speed_mm_s}</TableCell>
                <TableCell>{r.clamp_threshold_n}</TableCell>
                <TableCell>{r.loops}</TableCell>
                <TableCell>{r.min_force_n ?? '—'} / {r.max_force_n ?? '—'}</TableCell>
                <TableCell>
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="outline" onClick={() => openEdit(r)}>Edit</Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="destructive">Delete</Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete "{r.name}"?</AlertDialogTitle>
                          <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => del.mutate(r.id)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {recipes.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-slate-400 py-10">
                  No recipes yet. Click "+ New Recipe" to create one.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `frontend/src/pages/RecipeForm.tsx`**

```typescript
import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import type { Recipe, RecipeCreate } from '@/lib/types'

interface Props { recipe: Recipe | null; onSaved: () => void }
type F = { name: string; actuator_position_mm: string; speed_mm_s: string; clamp_threshold_n: string; loops: string; hold_time_ms: string; min_force_n: string; max_force_n: string }

export function RecipeForm({ recipe: r, onSaved }: Props) {
  const { register, handleSubmit, formState: { errors } } = useForm<F>({
    defaultValues: {
      name: r?.name ?? '',
      actuator_position_mm: String(r?.actuator_position_mm ?? 50),
      speed_mm_s: String(r?.speed_mm_s ?? 10),
      clamp_threshold_n: String(r?.clamp_threshold_n ?? 30),
      loops: String(r?.loops ?? 5),
      hold_time_ms: String(r?.hold_time_ms ?? 500),
      min_force_n: r?.min_force_n != null ? String(r.min_force_n) : '',
      max_force_n: r?.max_force_n != null ? String(r.max_force_n) : '',
    },
  })

  const createM = useMutation({ mutationFn: api.recipes.create })
  const updateM = useMutation({ mutationFn: ({ id, data }: { id: number; data: Partial<RecipeCreate> }) => api.recipes.update(id, data) })
  const pending = createM.isPending || updateM.isPending

  const submit = async (v: F) => {
    const data: RecipeCreate = {
      name: v.name,
      actuator_position_mm: Number(v.actuator_position_mm),
      speed_mm_s: Number(v.speed_mm_s),
      clamp_threshold_n: Number(v.clamp_threshold_n),
      loops: Number(v.loops),
      hold_time_ms: Number(v.hold_time_ms),
      min_force_n: v.min_force_n ? Number(v.min_force_n) : null,
      max_force_n: v.max_force_n ? Number(v.max_force_n) : null,
    }
    if (r) await updateM.mutateAsync({ id: r.id, data })
    else await createM.mutateAsync(data)
    onSaved()
  }

  const field = (id: keyof F, label: string, extra?: object) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...register(id, { required: true, ...extra })} className="h-8 text-sm" />
      {errors[id] && <span className="text-xs text-red-500">Required</span>}
    </div>
  )

  return (
    <form onSubmit={handleSubmit(submit)} className="grid grid-cols-2 gap-3 py-2">
      <div className="col-span-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" {...register('name', { required: true })} className="h-8 text-sm mt-1" />
        {errors.name && <span className="text-xs text-red-500">Required</span>}
      </div>
      {field('actuator_position_mm', 'Position (mm)')}
      {field('speed_mm_s', 'Speed (mm/s)')}
      {field('clamp_threshold_n', 'Clamp Threshold (N)')}
      {field('loops', 'Loops')}
      {field('hold_time_ms', 'Hold Time (ms)')}
      <div className="flex flex-col gap-1">
        <Label htmlFor="min_force_n">Min Force (N, optional)</Label>
        <Input id="min_force_n" type="number" step="0.1" placeholder="—" {...register('min_force_n')} className="h-8 text-sm" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="max_force_n">Max Force (N, optional)</Label>
        <Input id="max_force_n" type="number" step="0.1" placeholder="—" {...register('max_force_n')} className="h-8 text-sm" />
      </div>
      <div className="col-span-2 flex justify-end pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : r ? 'Save Changes' : 'Create Recipe'}
        </Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 3: Start servers and verify Recipes page**

Backend (from `backend/`):
```bash
.venv\Scripts\activate && uvicorn app.main:app --reload --port 8000
```
Frontend (from `frontend/`):
```bash
npm run dev
```

Open `http://localhost:5173/recipes`. Verify:
- Empty state message visible
- "+ New Recipe" opens dialog, form submits, recipe appears
- Edit prefills and saves correctly
- Delete shows confirm dialog, removes row

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/
git commit -m "feat(frontend): Recipes CRUD page — list, create, edit, delete"
```

---

### Task 10: Run page — full operator UI

> **⚠️ Requires Phase C (Plan 1 Tasks 15–21) complete** — `/ws`, `/api/sessions` must exist.

**Files:**
- Modify: `frontend/src/pages/Run.tsx`
- Create: `frontend/src/hooks/useSessionControl.ts`

- [ ] **Step 1: Create `frontend/src/hooks/useSessionControl.ts`**

```typescript
import { useMutation } from '@tanstack/react-query'
import { useAppStore } from '@/store/app'
import { useChartStore } from '@/store/chart'
import { getWsClient } from '@/lib/ws'
import { api } from '@/lib/api'

export function useSessionControl() {
  const machineState = useAppStore((s) => s.machineState)
  const isRunning = !['IDLE', 'ABORTED', 'ERROR', 'DONE_B7'].includes(machineState)

  const startM = useMutation({
    mutationFn: (recipeId: number) => api.sessions.start(recipeId),
    onMutate: () => {
      useChartStore.getState().clear()
      useAppStore.getState().resetRun()
      getWsClient()
    },
  })

  const stopM = useMutation({ mutationFn: api.sessions.stop })

  return {
    isRunning,
    machineState,
    start: (recipeId: number) => startM.mutate(recipeId),
    stop: () => stopM.mutate(),
    isStarting: startM.isPending,
    isStopping: stopM.isPending,
    startError: startM.error,
  }
}
```

- [ ] **Step 2: Replace `frontend/src/pages/Run.tsx`**

```typescript
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StateBadge } from '@/components/StateBadge'
import { HwStatusBar } from '@/components/HwStatusBar'
import { WaveformChart } from '@/components/WaveformChart'
import { useAppStore } from '@/store/app'
import { useSessionControl } from '@/hooks/useSessionControl'
import { getWsClient } from '@/lib/ws'
import { api } from '@/lib/api'

export default function Run() {
  const [recipeId, setRecipeId] = useState<number | null>(null)
  const { data: recipes = [] } = useQuery({ queryKey: ['recipes'], queryFn: api.recipes.list })

  const { machineState, hwStatus, wsConnected, loopResults, currentLoop } = useAppStore((s) => ({
    machineState: s.machineState,
    hwStatus: s.hwStatus,
    wsConnected: s.wsConnected,
    loopResults: s.loopResults,
    currentLoop: s.currentLoop,
  }))

  const { isRunning, start, stop, isStarting, isStopping } = useSessionControl()

  useEffect(() => { getWsClient() }, [])

  const pass = loopResults.filter((r) => r.result === 'pass').length
  const fail = loopResults.filter((r) => r.result === 'fail').length

  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      {/* Status bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StateBadge state={machineState} />
          {currentLoop !== null && isRunning && (
            <span className="text-sm text-slate-500">Loop {currentLoop}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!wsConnected && (
            <Badge variant="destructive" className="text-xs animate-pulse">WS disconnected</Badge>
          )}
          <HwStatusBar status={hwStatus} />
        </div>
      </div>

      {/* Waveform */}
      <div className="bg-white border rounded-lg p-4 shadow-sm">
        <WaveformChart />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 bg-white border rounded-lg p-4 shadow-sm">
        <Select disabled={isRunning} onValueChange={(v) => setRecipeId(Number(v))}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select recipe…" />
          </SelectTrigger>
          <SelectContent>
            {recipes.map((r) => (
              <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          disabled={!recipeId || isRunning || isStarting}
          onClick={() => recipeId && start(recipeId)}
        >
          {isStarting ? 'Starting…' : 'Start'}
        </Button>

        {/* E-STOP: always visible, disabled only when already stopped */}
        <Button
          variant="destructive"
          className="ml-auto h-14 px-10 text-lg font-bold tracking-wide"
          disabled={!isRunning || isStopping}
          onClick={stop}
        >
          E-STOP
        </Button>
      </div>

      {/* Loop results */}
      {loopResults.length > 0 && (
        <div className="bg-white border rounded-lg p-4 shadow-sm">
          <div className="flex gap-5 mb-3 text-sm font-semibold">
            <span className="text-green-600">{pass} PASS</span>
            <span className="text-red-600">{fail} FAIL</span>
          </div>
          <div className="overflow-y-auto max-h-52">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-400 uppercase border-b">
                  <th className="text-left py-1 pr-4">Loop</th>
                  <th className="text-left py-1 pr-4">Result</th>
                  <th className="text-left py-1 pr-4">Peak (N)</th>
                  <th className="text-left py-1">Hold (ms)</th>
                </tr>
              </thead>
              <tbody>
                {loopResults.map((r) => (
                  <tr key={r.loop} className="border-b border-slate-100">
                    <td className="py-1 pr-4 font-mono">{r.loop}</td>
                    <td className={`py-1 pr-4 font-semibold ${r.result === 'pass' ? 'text-green-600' : 'text-red-600'}`}>
                      {r.result.toUpperCase()}
                    </td>
                    <td className="py-1 pr-4 font-mono">{r.peak_n.toFixed(1)}</td>
                    <td className="py-1 font-mono">{r.hold_ms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Run.tsx frontend/src/hooks/useSessionControl.ts
git commit -m "feat(frontend): Run page — chart + state badge + hw status + controls + loop results"
```

---

### Task 11: Playwright E2E smoke — Recipes CRUD

**Files:**
- Create: `frontend/playwright.config.ts`
- Create: `frontend/tests/e2e/recipes.spec.ts`

- [ ] **Step 1: Install Playwright chromium**

```bash
npx playwright install chromium
```

- [ ] **Step 2: Create `frontend/playwright.config.ts`**

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://localhost:5173' },
  webServer: [
    {
      command: 'cd ../backend && .venv\\Scripts\\python -m uvicorn app.main:app --port 8000',
      url: 'http://localhost:8000/api/recipes',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
    },
  ],
})
```

- [ ] **Step 3: Create `frontend/tests/e2e/recipes.spec.ts`**

```typescript
import { test, expect } from '@playwright/test'

test.describe('Recipes CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/recipes')
  })

  test('empty state shows prompt', async ({ page }) => {
    // Only if DB is fresh; otherwise skip this assertion
    const noRecipes = page.getByText('No recipes yet')
    const hasRows = page.getByRole('row').nth(1)  // first data row
    const isEmpty = !(await hasRows.isVisible().catch(() => false))
    if (isEmpty) await expect(noRecipes).toBeVisible()
  })

  test('create a recipe', async ({ page }) => {
    await page.getByRole('button', { name: '+ New Recipe' }).click()
    await page.getByLabel('Name').fill('E2E Smoke Recipe')
    await page.getByLabel('Position (mm)').fill('80')
    await page.getByLabel('Speed (mm/s)').fill('12')
    await page.getByLabel('Clamp Threshold (N)').fill('35')
    await page.getByLabel('Loops').fill('4')
    await page.getByLabel('Hold Time (ms)').fill('600')
    await page.getByRole('button', { name: 'Create Recipe' }).click()
    await expect(page.getByText('E2E Smoke Recipe')).toBeVisible()
  })

  test('edit a recipe', async ({ page }) => {
    // Assumes at least one recipe exists from prior test or seed
    await page.getByRole('button', { name: 'Edit' }).first().click()
    const nameInput = page.getByLabel('Name')
    await nameInput.clear()
    await nameInput.fill('Renamed Recipe')
    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(page.getByText('Renamed Recipe')).toBeVisible()
  })

  test('delete a recipe', async ({ page }) => {
    const rowsBefore = await page.getByRole('row').count()
    await page.getByRole('button', { name: 'Delete' }).first().click()
    await page.getByRole('button', { name: 'Delete' }).last().click()  // confirm
    await expect(page.getByRole('row')).toHaveCount(rowsBefore - 1)
  })
})
```

- [ ] **Step 4: Run E2E tests (requires both servers running)**

```bash
npx playwright test tests/e2e/recipes.spec.ts
```
Expected: 3–4 tests PASS.

- [ ] **Step 5: Run all unit tests**

```bash
npx vitest run
```
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/playwright.config.ts frontend/tests/e2e/
git commit -m "test(frontend): Playwright E2E smoke — Recipes CRUD"
```

---

### Task 12: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add frontend commands to Commands section in CLAUDE.md**

After the existing backend commands block, add:

```markdown
## Frontend commands

All frontend commands run from `frontend/`.

```powershell
npm install                  # first-time setup
npm run dev                  # dev server at http://localhost:5173
npm run build                # production build → frontend/dist/
npx vitest run               # unit tests (ws, stores)
npx playwright test          # E2E (both servers must be running)
```
```

- [ ] **Step 2: Update status in CLAUDE.md**

Change:
```
- ⏳ **Plan 2** — Frontend (Vite + ShadcnUI + uPlot) driven by mock backend.
```
To:
```
- ✅ **Plan 2** — Frontend committed. Vite + React + ShadcnUI + uPlot. Recipes CRUD done. Run page done (requires Phase C for live WS).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md — Plan 2 complete, add frontend commands"
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|---|---|
| Vite + React 19 + TypeScript | Task 1 |
| Tailwind 4 + ShadcnUI | Tasks 1–2 |
| React Router + Layout | Task 3 |
| WS singleton + auto-reconnect | Task 4 |
| Machine state store | Task 5 |
| Waveform ring buffer | Task 5 |
| REST API client | Task 6 |
| StateBadge (state display) | Task 7 |
| HwStatusBar (PLC/Imada/ESP32) | Task 7 |
| uPlot 20 FPS live chart | Task 8 |
| Recipes CRUD page | Task 9 |
| Run page: start/E-stop/state/chart/loops | Task 10 |
| Playwright smoke | Task 11 |
| CLAUDE.md updated | Task 12 |

**Deferred to Plan 4:** History page, RunDetail, Hardware page, Settings page, ESP32 calibration wizard.
**Blocked on Phase C:** Run page live WS (Tasks 10 is coded but won't function until `/ws` endpoint exists).

### Placeholder scan
No TBD, TODO, or "implement later" in any task. All steps have complete code.

### Type consistency
- `Recipe` / `RecipeCreate` / `RecipeUpdate` defined in Task 4 (`types.ts`), used in Tasks 6 + 9.
- `HwStatus` shape `{ plc, imada, esp32: boolean }` matches `useAppStore` (Task 5) and `HwStatusBar` (Task 7).
- `LoopResult` shape `{ loop, result, peak_n, hold_ms }` matches store (Task 5) and Run page table (Task 10).
- `ChannelState` exported from `store/chart.ts` (Task 8 note) — used in `WaveformChart`.
- `state_change` message uses `from`/`to` keys — matches spec §7 and backend implementation.

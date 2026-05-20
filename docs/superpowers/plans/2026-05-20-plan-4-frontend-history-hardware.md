# Plan 4 — History UI + Hardware Page + API Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the History page (run list + detail with per-loop chart), Hardware page (live status + reconnect + ESP32 calibration wizard), and fix broken session API endpoints in the frontend.

**Architecture:** All new pages use React Query for data fetching against the existing backend REST API. History list uses a filter bar backed by query params. History detail loads waveform data per-loop and renders it in uPlot. Hardware page polls `/api/hardware/status` every 3 s and exposes a two-step calibration wizard. API fixes are contained to `lib/api.ts` and `hooks/useSessionControl.ts`.

**Tech Stack:** Vite 6, React 19, TypeScript 5.6 (`erasableSyntaxOnly`), Tailwind CSS 4, ShadcnUI base-nova (`render={}` not `asChild`), Zustand 5, @tanstack/react-query 5, uPlot 1.6, lucide-react.

---

## File Structure

```
frontend/src/
  lib/
    types.ts          ← add TestRun, TestLoop, HardwareStatus, WaveformData types
    api.ts            ← fix sessions endpoints; add runs.*, hardware.* methods
  hooks/
    useSessionControl.ts  ← fix stop() to send run_id from app store
  pages/
    History.tsx       ← run list table + filter bar (NEW)
    HistoryDetail.tsx ← run detail: per-loop table + uPlot chart + CSV export (NEW)
    Hardware.tsx      ← device status + reconnect + calibration wizard (NEW)
  App.tsx             ← wire /history/:id route + replace Placeholder components
```

---

## Task 1: Add backend-aligned types + fix api.ts

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add new types to `frontend/src/lib/types.ts`**

Append these interfaces (do NOT change the existing `Recipe` type — Recipes page depends on it):

```typescript
// --- History / Runs ---

export interface TestLoop {
  id: number
  loop_index: number
  started_at: string
  finished_at: string | null
  peak_force_n: number | null
  avg_force_n: number | null
  hold_time_ms: number | null
  judgment: string | null
  waveform_file: string | null
}

export interface TestRun {
  id: number
  recipe_id: number
  operator: string | null
  batch_id: string | null
  shift: string | null
  started_at: string
  finished_at: string | null
  status: string          // 'running' | 'pass' | 'fail' | 'aborted' | 'error'
  abort_reason: string | null
  loops_completed: number
  waveform_dir: string | null
  loops: TestLoop[]
}

// --- Hardware ---

export interface HardwareStatus {
  plc: boolean
  imada: boolean
  esp32: boolean
}

// --- Waveform ---

export interface WaveformPoint {
  t_ms: number
  force_n: number
}
```

- [ ] **Step 2: Fix and extend `frontend/src/lib/api.ts`**

Replace the entire file:

```typescript
import type {
  Recipe, RecipeCreate, RecipeUpdate,
  TestRun, HardwareStatus, WaveformPoint,
} from './types'

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
    // Fixed: backend endpoint is /sessions/start, not /sessions
    start: (recipeId: number, mode: 'auto' | 'manual' = 'auto') =>
      req<{ run_id: number }>('POST', '/sessions/start', { recipe_id: recipeId, mode }),
    // Fixed: backend endpoint is POST /sessions/{run_id}/stop
    stop: (runId: number) =>
      req<{ ok: boolean }>('POST', `/sessions/${runId}/stop`),
  },
  runs: {
    list: (params?: { status?: string; recipe_id?: number; operator?: string; limit?: number; offset?: number }) => {
      const q = new URLSearchParams()
      if (params?.status) q.set('status', params.status)
      if (params?.recipe_id) q.set('recipe_id', String(params.recipe_id))
      if (params?.operator) q.set('operator', params.operator)
      if (params?.limit) q.set('limit', String(params.limit))
      if (params?.offset) q.set('offset', String(params.offset))
      const qs = q.toString()
      return req<TestRun[]>('GET', `/runs${qs ? `?${qs}` : ''}`)
    },
    get: (id: number) => req<TestRun>('GET', `/runs/${id}`),
    waveform: (runId: number, loopIdx: number) =>
      req<WaveformPoint[]>('GET', `/runs/${runId}/loops/${loopIdx}/waveform`),
    exportCsvUrl: (runId: number) => `/api/runs/${runId}/export.csv`,
  },
  hardware: {
    status: () => req<HardwareStatus>('GET', '/hardware/status'),
    reconnect: (device: 'plc' | 'imada' | 'esp32') =>
      req<{ ok: boolean }>('POST', '/hardware/reconnect', { device }),
    calibrate: (raw_at_zero: number, raw_at_known: number, known_force_n: number) =>
      req<{ slope: number; offset: number }>('POST', '/hardware/esp32/calibrate', {
        raw_at_zero, raw_at_known, known_force_n,
      }),
  },
}
```

- [ ] **Step 3: Run TypeScript check**

```powershell
cd c:\Users\Aimz\source\repos\pmd-pinch-test-mc\frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```
git add frontend/src/lib/types.ts frontend/src/lib/api.ts
git commit -m "fix(frontend): correct session endpoints; add runs/hardware API + types"
```

---

## Task 2: Fix useSessionControl stop endpoint

**Files:**
- Modify: `frontend/src/hooks/useSessionControl.ts`

The old `api.sessions.stop()` sent `DELETE /api/sessions/current` with no run_id. The backend requires `POST /api/sessions/{run_id}/stop`. Fix by reading `currentRunId` from the app store.

- [ ] **Step 1: Update `frontend/src/hooks/useSessionControl.ts`**

```typescript
import { useMutation } from '@tanstack/react-query'
import { useAppStore } from '@/store/app'
import { useChartStore } from '@/store/chart'
import { getWsClient } from '@/lib/ws'
import { api } from '@/lib/api'

export function useSessionControl() {
  const machineState = useAppStore((s) => s.machineState)
  const currentRunId = useAppStore((s) => s.currentRunId)
  const isRunning = !['IDLE', 'ABORTED', 'ERROR', 'DONE_B7'].includes(machineState)

  const startM = useMutation({
    mutationFn: (recipeId: number) => api.sessions.start(recipeId),
    onMutate: () => {
      useChartStore.getState().clear()
      useAppStore.getState().resetRun()
      getWsClient()
    },
  })

  const stopM = useMutation({
    mutationFn: () => {
      const runId = currentRunId ?? useAppStore.getState().currentRunId
      if (runId == null) return Promise.resolve({ ok: true })
      return api.sessions.stop(runId)
    },
  })

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

- [ ] **Step 2: Run TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```
git add frontend/src/hooks/useSessionControl.ts
git commit -m "fix(frontend): useSessionControl stop sends run_id to correct endpoint"
```

---

## Task 3: History list page

**Files:**
- Create: `frontend/src/pages/History.tsx`

- [ ] **Step 1: Create `frontend/src/pages/History.tsx`**

```typescript
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import type { TestRun } from '@/lib/types'

const STATUS_COLORS: Record<string, string> = {
  pass:    'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  fail:    'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  aborted: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  error:   'bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-100',
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-700'}>
      {status.toUpperCase()}
    </Badge>
  )
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

export default function History() {
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['runs', statusFilter],
    queryFn: () => api.runs.list(statusFilter !== 'all' ? { status: statusFilter } : undefined),
    refetchInterval: 5000,
  })

  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">History</h1>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pass">Pass</SelectItem>
            <SelectItem value="fail">Fail</SelectItem>
            <SelectItem value="aborted">Aborted</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <p className="text-muted-foreground text-sm">No runs found.</p>
      ) : (
        <div className="bg-card border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-xs text-muted-foreground uppercase">
                <th className="text-left px-4 py-2">Run ID</th>
                <th className="text-left px-4 py-2">Started</th>
                <th className="text-left px-4 py-2">Finished</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-left px-4 py-2">Loops</th>
                <th className="text-left px-4 py-2">Operator</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run: TestRun) => (
                <tr
                  key={run.id}
                  className="border-t hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 font-mono">
                    <Link to={`/history/${run.id}`} className="text-primary hover:underline">
                      #{run.id}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{fmt(run.started_at)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{fmt(run.finished_at)}</td>
                  <td className="px-4 py-3"><StatusBadge status={run.status} /></td>
                  <td className="px-4 py-3">{run.loops_completed}</td>
                  <td className="px-4 py-3 text-muted-foreground">{run.operator ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Run TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```
git add frontend/src/pages/History.tsx
git commit -m "feat(frontend): History list page with status filter"
```

---

## Task 4: History detail page

**Files:**
- Create: `frontend/src/pages/HistoryDetail.tsx`

- [ ] **Step 1: Create `frontend/src/pages/HistoryDetail.tsx`**

```typescript
import { useRef, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import type { TestLoop, WaveformPoint } from '@/lib/types'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

const STATUS_COLORS: Record<string, string> = {
  pass:    'bg-green-100 text-green-800',
  fail:    'bg-red-100 text-red-800',
  aborted: 'bg-amber-100 text-amber-800',
  error:   'bg-red-200 text-red-900',
  running: 'bg-blue-100 text-blue-800',
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' })
}

function LoopChart({ runId, loopIdx }: { runId: number; loopIdx: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<uPlot | null>(null)

  const { data: points = [], isLoading } = useQuery({
    queryKey: ['waveform', runId, loopIdx],
    queryFn: () => api.runs.waveform(runId, loopIdx),
  })

  useEffect(() => {
    if (!ref.current || isLoading || points.length === 0) return

    const ts = points.map((p: WaveformPoint) => p.t_ms / 1000)
    const fs = points.map((p: WaveformPoint) => p.force_n)

    if (chartRef.current) {
      chartRef.current.setData([ts, fs])
      return
    }

    chartRef.current = new uPlot(
      {
        width: ref.current.clientWidth || 700,
        height: 220,
        series: [
          { label: 'Time (s)' },
          { label: 'Force (N)', stroke: 'oklch(0.55 0.22 240)', width: 2 },
        ],
        axes: [
          { label: 'ms' },
          { label: 'N' },
        ],
      },
      [ts, fs],
      ref.current
    )

    return () => {
      chartRef.current?.destroy()
      chartRef.current = null
    }
  }, [points, isLoading])

  if (isLoading) return <Skeleton className="h-[220px] w-full" />
  if (points.length === 0) return <p className="text-xs text-muted-foreground">No waveform data</p>

  return <div ref={ref} />
}

export default function HistoryDetail() {
  const { id } = useParams<{ id: string }>()
  const runId = Number(id)
  const [selectedLoop, setSelectedLoop] = useState<number | null>(null)

  const { data: run, isLoading } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.runs.get(runId),
  })

  if (isLoading) {
    return (
      <div className="space-y-3 max-w-5xl">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!run) return <p className="text-muted-foreground">Run not found.</p>

  const loopToShow = selectedLoop ?? run.loops[0]?.loop_index ?? null

  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/history">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft size={14} /> Back
          </Button>
        </Link>
        <h1 className="text-xl font-semibold">Run #{run.id}</h1>
        <Badge className={STATUS_COLORS[run.status] ?? 'bg-slate-100'}>
          {run.status.toUpperCase()}
        </Badge>
        <a href={api.runs.exportCsvUrl(runId)} download>
          <Button variant="outline" size="sm" className="ml-auto gap-1">
            <Download size={14} /> Export CSV
          </Button>
        </a>
      </div>

      {/* Summary */}
      <div className="bg-card border rounded-lg p-4 grid grid-cols-3 gap-4 text-sm">
        <div><span className="text-muted-foreground">Started</span><div className="font-mono text-xs mt-0.5">{fmt(run.started_at)}</div></div>
        <div><span className="text-muted-foreground">Finished</span><div className="font-mono text-xs mt-0.5">{fmt(run.finished_at)}</div></div>
        <div><span className="text-muted-foreground">Loops completed</span><div className="font-mono mt-0.5">{run.loops_completed}</div></div>
        <div><span className="text-muted-foreground">Operator</span><div className="mt-0.5">{run.operator ?? '—'}</div></div>
        <div><span className="text-muted-foreground">Batch</span><div className="mt-0.5">{run.batch_id ?? '—'}</div></div>
        <div><span className="text-muted-foreground">Shift</span><div className="mt-0.5">{run.shift ?? '—'}</div></div>
      </div>

      {/* Loop table + chart */}
      {run.loops.length > 0 && (
        <div className="bg-card border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-xs text-muted-foreground uppercase">
                <th className="text-left px-4 py-2">Loop</th>
                <th className="text-left px-4 py-2">Judgment</th>
                <th className="text-left px-4 py-2">Peak (N)</th>
                <th className="text-left px-4 py-2">Avg (N)</th>
                <th className="text-left px-4 py-2">Hold (ms)</th>
                <th className="text-left px-4 py-2">Chart</th>
              </tr>
            </thead>
            <tbody>
              {run.loops.map((loop: TestLoop) => (
                <>
                  <tr
                    key={loop.id}
                    className={`border-t cursor-pointer transition-colors ${selectedLoop === loop.loop_index ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                    onClick={() => setSelectedLoop(selectedLoop === loop.loop_index ? null : loop.loop_index)}
                  >
                    <td className="px-4 py-2 font-mono">{loop.loop_index}</td>
                    <td className="px-4 py-2">
                      <span className={`font-semibold ${loop.judgment === 'pass' ? 'text-green-600' : 'text-red-600'}`}>
                        {loop.judgment?.toUpperCase() ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono">{loop.peak_force_n?.toFixed(1) ?? '—'}</td>
                    <td className="px-4 py-2 font-mono">{loop.avg_force_n?.toFixed(1) ?? '—'}</td>
                    <td className="px-4 py-2 font-mono">{loop.hold_time_ms ?? '—'}</td>
                    <td className="px-4 py-2 text-xs text-primary">
                      {selectedLoop === loop.loop_index ? '▲ hide' : '▼ show'}
                    </td>
                  </tr>
                  {selectedLoop === loop.loop_index && (
                    <tr key={`chart-${loop.id}`}>
                      <td colSpan={6} className="px-4 py-3 bg-muted/20">
                        <LoopChart runId={runId} loopIdx={loop.loop_index} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loopToShow !== null && run.loops.length > 0 && selectedLoop === null && (
        <p className="text-xs text-muted-foreground">Click a row to expand its waveform chart.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Run TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: no errors. If uPlot types cause issues, check `frontend/src/components/WaveformChart.tsx` for how it's imported and mirror that pattern.

- [ ] **Step 3: Commit**

```
git add frontend/src/pages/HistoryDetail.tsx
git commit -m "feat(frontend): History detail page — per-loop table + expandable waveform chart"
```

---

## Task 5: Hardware page + ESP32 calibration wizard

**Files:**
- Create: `frontend/src/pages/Hardware.tsx`

- [ ] **Step 1: Create `frontend/src/pages/Hardware.tsx`**

```typescript
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { RefreshCw, CheckCircle, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import type { HardwareStatus } from '@/lib/types'

type Device = 'plc' | 'imada' | 'esp32'

function DeviceRow({ label, ok, device, onReconnect, reconnecting }: {
  label: string
  ok: boolean
  device: Device
  onReconnect: (d: Device) => void
  reconnecting: boolean
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b last:border-0">
      <div className="flex items-center gap-3">
        {ok
          ? <CheckCircle size={18} className="text-green-500" />
          : <XCircle size={18} className="text-red-500" />
        }
        <span className="font-medium text-sm">{label}</span>
        <span className={`text-xs ${ok ? 'text-green-600' : 'text-red-500'}`}>
          {ok ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={reconnecting}
        onClick={() => onReconnect(device)}
        className="gap-1"
      >
        <RefreshCw size={13} className={reconnecting ? 'animate-spin' : ''} />
        Reconnect
      </Button>
    </div>
  )
}

type CalibStep = 'zero' | 'known' | 'result'

interface CalibState {
  rawAtZero: string
  rawAtKnown: string
  knownForceN: string
}

function CalibrationWizard() {
  const [step, setStep] = useState<CalibStep>('zero')
  const [form, setForm] = useState<CalibState>({ rawAtZero: '', rawAtKnown: '', knownForceN: '' })
  const [result, setResult] = useState<{ slope: number; offset: number } | null>(null)

  const calibM = useMutation({
    mutationFn: () => api.hardware.calibrate(
      Number(form.rawAtZero),
      Number(form.rawAtKnown),
      Number(form.knownForceN),
    ),
    onSuccess: (data) => {
      setResult(data)
      setStep('result')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const reset = () => {
    setStep('zero')
    setForm({ rawAtZero: '', rawAtKnown: '', knownForceN: '' })
    setResult(null)
  }

  return (
    <div className="bg-card border rounded-lg p-4 space-y-4">
      <h2 className="text-sm font-semibold">ESP32 Calibration Wizard</h2>
      <p className="text-xs text-muted-foreground">
        2-point linear fit: place no weight → record raw, then place known weight → record raw.
      </p>

      {step === 'zero' && (
        <div className="space-y-3">
          <p className="text-sm font-medium">Step 1 — Zero point (no weight on sensor)</p>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rawZero">Raw reading at zero load</Label>
            <Input
              id="rawZero"
              type="number"
              placeholder="e.g. 12345"
              value={form.rawAtZero}
              onChange={(e) => setForm((f) => ({ ...f, rawAtZero: e.target.value }))}
              className="w-48"
            />
          </div>
          <Button
            disabled={!form.rawAtZero}
            onClick={() => setStep('known')}
          >
            Next
          </Button>
        </div>
      )}

      {step === 'known' && (
        <div className="space-y-3">
          <p className="text-sm font-medium">Step 2 — Known weight</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="rawKnown">Raw reading with weight</Label>
              <Input
                id="rawKnown"
                type="number"
                placeholder="e.g. 23456"
                value={form.rawAtKnown}
                onChange={(e) => setForm((f) => ({ ...f, rawAtKnown: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="knownForce">Known force (N)</Label>
              <Input
                id="knownForce"
                type="number"
                step="0.1"
                placeholder="e.g. 10.0"
                value={form.knownForceN}
                onChange={(e) => setForm((f) => ({ ...f, knownForceN: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep('zero')}>Back</Button>
            <Button
              disabled={!form.rawAtKnown || !form.knownForceN || calibM.isPending}
              onClick={() => calibM.mutate()}
            >
              {calibM.isPending ? 'Computing…' : 'Compute'}
            </Button>
          </div>
        </div>
      )}

      {step === 'result' && result && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-green-600">✓ Calibration computed</p>
          <div className="bg-muted rounded p-3 font-mono text-sm space-y-1">
            <div>slope  = {result.slope.toFixed(6)} N/count</div>
            <div>offset = {result.offset.toFixed(2)}</div>
          </div>
          <p className="text-xs text-muted-foreground">
            Copy these values into <code>config.yaml</code> under{' '}
            <code>hardware.esp32.calibration</code> and restart the backend.
          </p>
          <Button variant="outline" onClick={reset}>Start over</Button>
        </div>
      )}
    </div>
  )
}

export default function Hardware() {
  const queryClient = useQueryClient()

  const { data: status, isLoading } = useQuery({
    queryKey: ['hw-status'],
    queryFn: api.hardware.status,
    refetchInterval: 3000,
  })

  const reconnectM = useMutation({
    mutationFn: (device: Device) => api.hardware.reconnect(device),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hw-status'] }),
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <h1 className="text-xl font-semibold">Hardware</h1>

      {/* Device status */}
      <div className="bg-card border rounded-lg px-4">
        {isLoading ? (
          <div className="space-y-3 py-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (
          (['plc', 'imada', 'esp32'] as Device[]).map((dev) => (
            <DeviceRow
              key={dev}
              label={dev.toUpperCase()}
              ok={(status as HardwareStatus | undefined)?.[dev] ?? false}
              device={dev}
              onReconnect={(d) => reconnectM.mutate(d)}
              reconnecting={reconnectM.isPending && reconnectM.variables === dev}
            />
          ))
        )}
      </div>

      <CalibrationWizard />
    </div>
  )
}
```

- [ ] **Step 2: Run TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```
git add frontend/src/pages/Hardware.tsx
git commit -m "feat(frontend): Hardware page — device status, reconnect, ESP32 calibration wizard"
```

---

## Task 6: Wire routes in App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Update `frontend/src/App.tsx`**

```typescript
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
```

- [ ] **Step 2: Run TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```
git add frontend/src/App.tsx
git commit -m "feat(frontend): wire History/:id + Hardware routes in App"
```

---

## Task 7: Final check — tsc + vitest

**Files:** none (verification only)

- [ ] **Step 1: Full TypeScript check**

```powershell
cd c:\Users\Aimz\source\repos\pmd-pinch-test-mc\frontend
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 2: Run frontend unit tests**

```powershell
npx vitest run
```

Expected: all pass (existing ws + store tests).

- [ ] **Step 3: Start dev servers and smoke-test in browser**

Terminal 1:
```powershell
cd c:\Users\Aimz\source\repos\pmd-pinch-test-mc\backend
python -m uvicorn app.main:app --port 8000 --reload
```

Terminal 2:
```powershell
cd c:\Users\Aimz\source\repos\pmd-pinch-test-mc\frontend
npm run dev
```

Open `http://localhost:5173` and verify:
- `/history` — page loads, shows "No runs found" or a list if runs exist
- `/history/1` — if run exists, shows summary + loop table
- `/hardware` — shows PLC/Imada/ESP32 status dots + Reconnect buttons + calibration wizard
- `/run` — start session still works (uses corrected endpoint)

- [ ] **Step 4: Commit any fixes found during smoke test**

```
git add -p
git commit -m "fix(frontend): smoke test fixes"
```

---

## Acceptance Criteria

- `npx tsc --noEmit` passes with 0 errors
- `npx vitest run` passes
- History page loads and shows run list with status filter
- History detail page shows summary + per-loop table; clicking a row shows waveform chart
- Export CSV button downloads the file
- Hardware page shows live device status (polling 3 s) with Reconnect buttons
- ESP32 calibration wizard completes 2-step flow and displays slope/offset
- Start Session and E-STOP work correctly (fixed endpoints)

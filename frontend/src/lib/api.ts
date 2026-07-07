import type {
  Recipe, RecipeCreate, RecipeUpdate,
  TestRun, HardwareStatus, WaveformPoint, UiSettings,
  Comparison, ComparisonCreate, ComparisonUpdate,
  RemovableDrive, ExportFileRequest, ExportFileResponse,
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
      if (params?.recipe_id != null) q.set('recipe_id', String(params.recipe_id))
      if (params?.operator) q.set('operator', params.operator)
      if (params?.limit != null) q.set('limit', String(params.limit))
      if (params?.offset != null) q.set('offset', String(params.offset))
      const qs = q.toString()
      return req<TestRun[]>('GET', `/runs${qs ? `?${qs}` : ''}`)
    },
    get: (id: number) => req<TestRun>('GET', `/runs/${id}`),
    // Backend returns columnar { t_ms: [...], force_n: [...] } (matches the parquet
    // layout). Normalize to a row array so chart code can map over points.
    waveform: async (runId: number, loopIdx: number): Promise<WaveformPoint[]> => {
      const res = await req<{ t_ms: number[]; force_n: number[] } | WaveformPoint[]>(
        'GET', `/runs/${runId}/loops/${loopIdx}/waveform`,
      )
      if (Array.isArray(res)) return res
      const { t_ms = [], force_n = [] } = res ?? {}
      const len = Math.min(t_ms.length, force_n.length)
      return Array.from({ length: len }, (_, i) => ({ t_ms: t_ms[i], force_n: force_n[i] }))
    },
    exportCsvUrl: (runId: number) => `/api/runs/${runId}/export.csv`,
    summaryCsvUrl: (runId: number) => `/api/runs/${runId}/summary.csv`,
    delete: (id: number) => req<void>('DELETE', `/runs/${id}`),
  },
  comparisons: {
    list: () => req<Comparison[]>('GET', '/comparisons'),
    get: (id: number) => req<Comparison>('GET', `/comparisons/${id}`),
    create: (data: ComparisonCreate) => req<Comparison>('POST', '/comparisons', data),
    update: (id: number, data: ComparisonUpdate) => req<Comparison>('PUT', `/comparisons/${id}`, data),
    delete: (id: number) => req<void>('DELETE', `/comparisons/${id}`),
  },
  settings: {
    get: () => req<Partial<UiSettings>>('GET', '/settings'),
    save: (data: UiSettings) => req<{ ok: boolean }>('PUT', '/settings', data),
  },
  hardware: {
    status: () => req<HardwareStatus>('GET', '/hardware/status'),
    reconnect: (device: 'plc' | 'imada' | 'esp32') =>
      req<{ ok: boolean }>('POST', '/hardware/reconnect', { device }),
    pulseBit: (addr: number, pulse_ms = 200) =>
      req<{ ok: boolean }>('POST', '/hardware/plc/bit', { addr, value: true, pulse_ms }),
    setBit: (addr: number, value: boolean) =>
      req<{ ok: boolean; addr: number; value: boolean }>('POST', '/hardware/plc/bit', { addr, value }),
    setWords: (words: Record<number, number>) =>
      req<{ ok: boolean }>('POST', '/hardware/plc/words', { words }),
    imadaTare: () =>
      req<{ ok: boolean }>('POST', '/hardware/imada/tare'),
    esp32Tare: () =>
      req<{ ok: boolean }>('POST', '/hardware/esp32/tare'),
    getForceLimit: () =>
      req<{ limit_gf: number | null; active: boolean; config_limit_gf: number | null }>('GET', '/hardware/esp32/force-limit'),
    setForceLimit: (limit_gf: number | null) =>
      req<{ ok: boolean; limit_gf: number | null }>('POST', '/hardware/esp32/force-limit', { limit_gf }),
    getClampOffset: () =>
      req<{ offset_gf: number }>('GET', '/hardware/esp32/clamp-offset'),
    setClampOffset: (offset_gf: number) =>
      req<{ ok: boolean; offset_gf: number }>('POST', '/hardware/esp32/clamp-offset', { offset_gf }),
    getImadaTensionLimit: () =>
      req<{ limit_n: number | null; active: boolean; config_limit_n: number | null }>('GET', '/hardware/imada/tension-limit'),
    setImadaTensionLimit: (limit_n: number | null) =>
      req<{ ok: boolean; limit_n: number | null }>('POST', '/hardware/imada/tension-limit', { limit_n }),
    ackImadaTensionAlarm: () =>
      req<{ ok: boolean }>('POST', '/hardware/imada/tension-alarm/ack', {}),
  },
  system: {
    // Informational only — feeds a live status line, NEVER a picker/select.
    // Backend re-resolves the actual save target fresh on every export-file call.
    removableDrives: () => req<{ drives: RemovableDrive[] }>('GET', '/system/removable-drives'),
    exportFile: (body: ExportFileRequest) =>
      req<ExportFileResponse>('POST', '/system/export-file', body),
  },
}

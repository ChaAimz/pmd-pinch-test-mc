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
      if (params?.limit != null) q.set('limit', String(params.limit))
      if (params?.offset != null) q.set('offset', String(params.offset))
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

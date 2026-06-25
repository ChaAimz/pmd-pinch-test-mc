import { create } from 'zustand'

export interface HwStatus { plc: boolean; imada: boolean; esp32: boolean }
// Mirrors backend loop_result WS payload (app/schemas/ws_messages.py WsLoopResult).
export interface LoopResult { loop: number; judgment: 'pass' | 'fail'; peak_force_n: number; min_force_n: number; avg_force_n: number; hold_time_ms: number; tension_end_ms: number | null; peak_clamp_n: number | null; avg_clamp_n: number | null }
export interface PlcBitState { value: boolean; ts: number }
export interface ErrorEntry { fromState: string; at: string; loop: number | null }

function makeInitialPlcBits(): Record<number, PlcBitState> {
  const bits: Record<number, PlcBitState> = {}
  // All MR addresses tracked in the UI — mirrors backend/config.yaml hardware.plc.device_map.bits
  // Web→PLC (commands)
  for (const addr of [800, 801, 802, 803, 804, 808, 810, 101, 201, 502]) bits[addr] = { value: false, ts: 0 }
  // PLC→Web (status/events)
  for (const addr of [805, 806, 807, 3, 2, 100, 200, 300, 301, 302, 303, 809, 811]) bits[addr] = { value: false, ts: 0 }
  return bits
}

interface AppState {
  wsConnected: boolean
  machineState: string
  currentRunId: number | null
  currentLoop: number | null
  hwStatus: HwStatus
  loopResults: LoopResult[]
  plcBits: Record<number, PlcBitState>
  latestImadaForce: number | null
  latestEsp32Force: number | null
  errors: ErrorEntry[]
  unseenErrorCount: number
  clampForceAlarm: string | null
  clampForceAlarmLimit: number | null   // limit_gf at the time the alarm fired
  maxStrokeAlarm: boolean
  setWsConnected: (v: boolean) => void
  handleStateChange: (msg: { type: string; from: string; to: string; run_id?: number; loop?: number; at?: string }) => void
  setHwStatus: (msg: { type: string; plc: boolean; imada: boolean; esp32: boolean }) => void
  addLoopResult: (msg: { type: string; run_id?: number; loop: number; peak_force_n: number; min_force_n: number; avg_force_n: number; hold_time_ms: number; tension_end_ms: number | null; peak_clamp_n?: number | null; avg_clamp_n?: number | null; judgment: 'pass' | 'fail' }) => void
  setRunFinished: (msg: { type: string; run_id: number; status: string; loops_completed: number }) => void
  resetRun: () => void
  setPlcBit: (msg: { type: string; addr: number; value: boolean }) => void
  setLatestImadaForce: (v: number | null) => void
  setLatestEsp32Force: (v: number | null) => void
  clearErrorCount: () => void
  setClampForceAlarm: (msg: string | null, limit_gf?: number | null) => void
  setMaxStrokeAlarm: (v: boolean) => void
}

export const initialAppState = {
  wsConnected: false,
  machineState: 'IDLE',
  currentRunId: null as number | null,
  currentLoop: null as number | null,
  hwStatus: { plc: false, imada: false, esp32: false } as HwStatus,
  loopResults: [] as LoopResult[],
  plcBits: makeInitialPlcBits() as Record<number, PlcBitState>,
  latestImadaForce: null as number | null,
  latestEsp32Force: null as number | null,
  errors: [] as ErrorEntry[],
  unseenErrorCount: 0,
  clampForceAlarm: null as string | null,
  clampForceAlarmLimit: null as number | null,
  maxStrokeAlarm: false,
}

export type AppStoreType = typeof useAppStore

export const useAppStore = create<AppState>((set) => ({
  ...initialAppState,
  setWsConnected: (v) => set({ wsConnected: v }),
  handleStateChange: ({ from, to, run_id, loop, at }) =>
    set((s) => ({
      machineState: to,
      currentRunId: run_id ?? s.currentRunId,
      currentLoop: loop ?? s.currentLoop,
      errors: to === 'ERROR'
        ? [...s.errors, { fromState: from, at: at ?? new Date().toISOString(), loop: loop ?? null }]
        : s.errors,
      unseenErrorCount: to === 'ERROR' ? s.unseenErrorCount + 1 : s.unseenErrorCount,
    })),
  setHwStatus: ({ plc, imada, esp32 }) => set({ hwStatus: { plc, imada, esp32 } }),
  addLoopResult: ({ type: _t, peak_clamp_n = null, avg_clamp_n = null, ...r }) =>
    set((s) => ({
      loopResults: s.loopResults.some((x) => x.loop === r.loop)
        ? s.loopResults
        : [...s.loopResults, { ...r, peak_clamp_n, avg_clamp_n }],
    })),
  setRunFinished: (_msg) => set({ machineState: 'IDLE' }),
  resetRun: () => set((s) => ({
    machineState: 'IDLE',
    currentRunId: null,
    currentLoop: null,
    loopResults: [],
    latestImadaForce: null,
    latestEsp32Force: null,
    errors: [],
    unseenErrorCount: 0,
    clampForceAlarm: null,
    clampForceAlarmLimit: null,
    // preserve live connection state — hwStatus, wsConnected, plcBits stay intact
    hwStatus: s.hwStatus,
    wsConnected: s.wsConnected,
    plcBits: s.plcBits,
  })),
  setPlcBit: ({ addr, value }) =>
    set((s) => ({
      plcBits: {
        ...s.plcBits,
        [addr]: { value, ts: Date.now() },
      },
    })),
  setLatestImadaForce: (v) => set({ latestImadaForce: v }),
  setLatestEsp32Force: (v) => set({ latestEsp32Force: v }),
  clearErrorCount: () => set({ unseenErrorCount: 0 }),
  setClampForceAlarm: (msg, limit_gf) => set((s) => ({
    clampForceAlarm: msg,
    clampForceAlarmLimit: msg === null ? null : (limit_gf !== undefined ? limit_gf : s.clampForceAlarmLimit),
  })),
  setMaxStrokeAlarm: (v) => set({ maxStrokeAlarm: v }),
}))

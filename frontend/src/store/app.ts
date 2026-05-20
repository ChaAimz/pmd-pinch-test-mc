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

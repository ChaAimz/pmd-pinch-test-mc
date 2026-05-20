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

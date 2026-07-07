import { describe, it, expect, beforeEach } from 'vitest'
import { useChartStore, MAX_SAMPLES, initialChartState } from '@/store/chart'

beforeEach(() => useChartStore.setState(initialChartState()))

describe('useChartStore', () => {
  it('starts with zero count', () => {
    expect(useChartStore.getState().imadaCount).toBe(0)
  })
  it('pushImadaBatch appends samples', () => {
    useChartStore.getState().pushImadaBatch([[100, 1.5], [150, 2.0]])
    expect(useChartStore.getState().imadaCount).toBe(2)
  })
  it('wraps at MAX_SAMPLES', () => {
    const big = Array.from({ length: MAX_SAMPLES + 5 }, (_, i) => [i * 10, i * 0.1] as [number, number])
    useChartStore.getState().pushImadaBatch(big)
    expect(useChartStore.getState().imadaCount).toBe(MAX_SAMPLES)
  })
  it('clear resets the channel', () => {
    useChartStore.getState().pushImadaBatch([[1, 1]])
    useChartStore.getState().clear()
    expect(useChartStore.getState().imadaCount).toBe(0)
  })
  it('armClear defers the wipe until the next batch (gated window hold)', () => {
    useChartStore.getState().pushImadaBatch([[100, 1.5], [150, 2.0]])
    expect(useChartStore.getState().imadaCount).toBe(2)
    // Arm at MR805 — the previous window must STAY until the new one starts drawing.
    useChartStore.getState().armClear()
    expect(useChartStore.getState().pendingClear).toBe(true)
    expect(useChartStore.getState().imadaCount).toBe(2)
    // First batch of the new window: buffer wipes, then only the new sample remains.
    useChartStore.getState().pushImadaBatch([[200, 3.0]])
    expect(useChartStore.getState().imadaCount).toBe(1)
    expect(useChartStore.getState().pendingClear).toBe(false)
  })
})

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
})

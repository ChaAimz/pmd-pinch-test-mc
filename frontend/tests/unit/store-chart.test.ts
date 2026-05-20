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

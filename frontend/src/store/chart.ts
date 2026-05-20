import { create } from 'zustand'

export const MAX_SAMPLES = 6000  // 60s at 100Hz

export interface ChannelState {
  timestamps: Float64Array
  force: Float32Array
  count: number
  head: number
}

interface ChartState {
  imada: ChannelState
  esp32: ChannelState
  imadaCount: number
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

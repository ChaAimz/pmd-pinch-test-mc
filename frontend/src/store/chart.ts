import { create } from 'zustand'
import type { WsSample } from '@/lib/types'

export const DEFAULT_MAX_SAMPLES = 30000
// Keep for backwards-compat — the live ring buffer size is now dynamic (store.maxSamples).
export const MAX_SAMPLES = DEFAULT_MAX_SAMPLES
// Hard ceiling on the live buffer. 500k × (8 + 4) bytes ≈ 6 MB — generous for a
// single-machine app. Only the charted Imada force stream is buffered (the ESP32
// clamp force is a scalar readout, kept in the app store, not plotted). Runs longer
// than this wrap the ring (oldest live samples drop); the full record is in parquet.
export const MAX_BUFFER_SAMPLES = 500000
export const MIN_BUFFER_SAMPLES = 1000

export interface ChannelState {
  timestamps: Float64Array
  force: Float32Array
  count: number
  head: number
}

interface ChartState {
  maxSamples: number
  imada: ChannelState
  imadaCount: number
  recording: boolean
  pushImadaBatch: (samples: WsSample[]) => void
  setRecording: (v: boolean) => void
  clear: () => void
  resizeBuffer: (n: number) => void
}

function makeChannel(n: number): ChannelState {
  return { timestamps: new Float64Array(n), force: new Float32Array(n), count: 0, head: 0 }
}

export function initialChartState(n = DEFAULT_MAX_SAMPLES) {
  return {
    maxSamples: n,
    imada: makeChannel(n),
    imadaCount: 0,
    recording: false,
  }
}

export function clampBufferSize(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_SAMPLES
  const ceil = Math.ceil(n)
  if (ceil > MAX_BUFFER_SAMPLES && import.meta.env.DEV) {
    // Continuous mode on a long/high-Hz run wants more than we'll hold live; the ring
    // will wrap and show only the most recent window. Full waveform is still in parquet.
    console.warn(
      `[chart] requested ${ceil} samples exceeds live cap ${MAX_BUFFER_SAMPLES}; ` +
      `live plot will show only the most recent ${MAX_BUFFER_SAMPLES} (full data in history).`,
    )
  }
  return Math.max(MIN_BUFFER_SAMPLES, Math.min(MAX_BUFFER_SAMPLES, ceil))
}

// Mutates the channel ring buffer IN PLACE and returns the new sample count.
//
// Safe to mutate (no immutable copy) because:
//   1. JS is single-threaded — the 50 ms chart-render timer in WaveformChart never
//      interleaves with this WS handler, so readers never see a torn buffer.
//   2. No component subscribes to the typed-array identity; every reader pulls fresh
//      data via useChartStore.getState(). So a new array reference would trigger no
//      re-render anyway — the old .slice() was pure cost.
//
// At a 100-loop continuous buffer (up to MAX_BUFFER_SAMPLES) a per-batch .slice()
// copied ~6 MB at 20 Hz ≈ 120 MB/s of GC churn → frame drops on the operator PC.
function pushSamples(ch: ChannelState, samples: WsSample[], maxSamples: number): number {
  const { timestamps, force } = ch
  let { count, head } = ch
  for (const [t_ms, force_n] of samples) {
    timestamps[head] = t_ms
    force[head] = force_n
    head = (head + 1) % maxSamples
    if (count < maxSamples) count++
  }
  ch.count = count
  ch.head = head
  return count
}

export type ChartStoreType = typeof useChartStore

export const useChartStore = create<ChartState>((set) => ({
  ...initialChartState(),
  pushImadaBatch: (samples) =>
    set((s) => ({ imadaCount: pushSamples(s.imada, samples, s.maxSamples) })),
  setRecording: (v) => set({ recording: v }),
  // Preserve the sized buffer — gated mode calls clear() on every loop boundary.
  clear: () => set((s) => initialChartState(s.maxSamples)),
  resizeBuffer: (n) => set(initialChartState(clampBufferSize(n))),
}))

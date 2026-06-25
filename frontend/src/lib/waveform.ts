import type { WaveformPoint } from './types'

/**
 * Drop the leading "pre-roll" block of Imada samples stamped t_ms === 0.
 *
 * The test runner times each sample relative to when MR805 (start-tension) fired
 * (`test_runner.py _collect_tension`). Imada samples that were already queued from
 * BEFORE B5 get a negative offset that the runner historically clamped to 0
 * (`if t_ms < 0: t_ms = 0`), so the entire pre-tension baseline buffer — including
 * its negative settling values — landed on a single t_ms = 0 column. In the
 * stitched all-cycles view `(t_ms - t0) / duration` squishes that whole block into
 * a vertical spike at every cycle boundary (the negative dips at C1..Cn).
 *
 * Dropping the leading t_ms === 0 run yields the clean tension pull. Robust for
 * both legacy parquet (which has the block baked in) and fixed runs (which have at
 * most one genuine t_ms = 0 sample). If every sample is 0 (a fully broken loop) the
 * input is returned unchanged so the chart isn't blanked.
 */
export function dropPreRoll(pts: WaveformPoint[]): WaveformPoint[] {
  let i = 0
  while (i < pts.length && pts[i].t_ms === 0) i++
  return i > 0 && i < pts.length ? pts.slice(i) : pts
}

/**
 * End index (exclusive) of the active signal in a waveform.
 *
 * Finds the force peak, then the last sample after the peak still above 5% of peak
 * force (floor 10 mN) — trims the decaying post-tension tail. Shared by the Run and
 * History pages so both render identically.
 */
export function activeEndIdx(pts: WaveformPoint[]): number {
  if (pts.length === 0) return 0
  let peakForce = 0
  let peakIdx = 0
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].force_n > peakForce) { peakForce = pts[i].force_n; peakIdx = i }
  }
  const threshold = Math.max(0.01, peakForce * 0.05)
  for (let k = pts.length - 1; k > peakIdx; k--) {
    if (pts[k].force_n >= threshold) return k + 1
  }
  return pts.length
}

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

/**
 * Peak-preserving downsample for line charts. Splits the input into ~maxOut/2
 * equal buckets and emits the MIN and MAX sample (by `getY`) of each bucket in
 * original order — so the judged peak force (and any trough) always survives,
 * unlike naive stride sampling which can drop the peak between two samples.
 *
 * Keeps the first and last sample. Returns the input unchanged when it already
 * fits in `maxOut`. Output length is ≲ maxOut + 2.
 *
 * Why this matters: the all-cycles stitch and the continuous live plot would
 * otherwise hold/feed hundreds of thousands of points; bounding the point count
 * keeps the browser's JS heap flat regardless of how many test cycles run.
 */
export function decimate<T>(items: T[], maxOut: number, getY: (t: T) => number): T[] {
  const n = items.length
  if (maxOut <= 2 || n <= maxOut) return items
  const idx = decimateIndices((i) => getY(items[i]), 0, n, maxOut)
  return idx.map((i) => items[i])
}

/**
 * Peak-preserving index selection over the half-open range [a, b). Splits it into
 * ~maxOut/2 equal buckets and returns the index of the MIN and MAX value (`getY`) in
 * each bucket, in order, always including `a` and `b-1`. Returns ≲ maxOut indices.
 *
 * Index-based (rather than array-based like `decimate`) so callers can run it straight
 * over a ring buffer / typed array without materialising the full range first — this is
 * what lets the live chart decimate up to 500k samples while allocating only the output.
 */
export function decimateIndices(getY: (i: number) => number, a: number, b: number, maxOut: number): number[] {
  const span = b - a
  if (span <= 0) return []
  if (maxOut <= 2 || span <= maxOut) {
    const idx = new Array<number>(span)
    for (let i = 0; i < span; i++) idx[i] = a + i
    return idx
  }
  const idx: number[] = [a]
  const bucketCount = Math.max(1, Math.floor(maxOut / 2))
  const bucketSize = span / bucketCount
  for (let bk = 0; bk < bucketCount; bk++) {
    const start = a + Math.floor(bk * bucketSize)
    const end = a + Math.min(span, Math.floor((bk + 1) * bucketSize))
    if (start >= end) continue
    let minI = start, maxI = start
    let minV = getY(start), maxV = minV
    for (let i = start + 1; i < end; i++) {
      const v = getY(i)
      if (v < minV) { minV = v; minI = i }
      if (v > maxV) { maxV = v; maxI = i }
    }
    const lo = Math.min(minI, maxI), hi = Math.max(minI, maxI)
    if (lo !== idx[idx.length - 1]) idx.push(lo)
    if (hi !== idx[idx.length - 1]) idx.push(hi)
  }
  if (idx[idx.length - 1] !== b - 1) idx.push(b - 1)
  return idx
}

/**
 * Smallest index i in [0, count) with `getX(i) >= target`, or `count` if none.
 * Requires `getX` to be non-decreasing in i (true for the live ring buffer, whose
 * timestamps only increase). Used to map a zoomed time window back to ring indices.
 */
export function lowerBoundIndex(count: number, getX: (i: number) => number, target: number): number {
  let lo = 0, hi = count
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (getX(mid) < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

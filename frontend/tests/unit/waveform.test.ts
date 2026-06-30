import { describe, it, expect } from 'vitest'
import { decimate, decimateIndices, lowerBoundIndex } from '@/lib/waveform'

// Each point is { i (time order), v (force) }. getY reads v.
type P = { i: number; v: number }
const mk = (n: number, f: (i: number) => number): P[] =>
  Array.from({ length: n }, (_, i) => ({ i, v: f(i) }))

describe('decimate', () => {
  it('returns the input unchanged when it already fits in maxOut', () => {
    const pts = mk(50, (i) => i)
    expect(decimate(pts, 100, (p) => p.v)).toBe(pts)
  })

  it('returns the input unchanged for tiny maxOut (<=2) rather than corrupting it', () => {
    const pts = mk(1000, (i) => i)
    expect(decimate(pts, 2, (p) => p.v)).toBe(pts)
  })

  it('bounds the output to roughly maxOut points', () => {
    const out = decimate(mk(100_000, (i) => Math.sin(i)), 2000, (p) => p.v)
    expect(out.length).toBeLessThanOrEqual(2000 + 2)
    expect(out.length).toBeGreaterThan(100)
  })

  it('keeps the first and last sample', () => {
    const pts = mk(10_000, (i) => i)
    const out = decimate(pts, 300, (p) => p.v)
    expect(out[0]).toBe(pts[0])
    expect(out[out.length - 1]).toBe(pts[pts.length - 1])
  })

  it('NEVER drops the global peak — the judged peak force must survive', () => {
    // Spike buried mid-stream, surrounded by low noise, far more points than maxOut.
    const peakIdx = 49_321
    const pts = mk(100_000, (i) => (i === peakIdx ? 999 : Math.sin(i) * 0.1))
    const out = decimate(pts, 300, (p) => p.v)
    const keptPeak = Math.max(...out.map((p) => p.v))
    expect(keptPeak).toBe(999)
    expect(out.some((p) => p.i === peakIdx)).toBe(true)
  })

  it('preserves a deep trough as well (min per bucket)', () => {
    const troughIdx = 12_345
    const pts = mk(100_000, (i) => (i === troughIdx ? -50 : 1 + Math.sin(i) * 0.1))
    const out = decimate(pts, 300, (p) => p.v)
    expect(Math.min(...out.map((p) => p.v))).toBe(-50)
  })

  it('keeps output in original (ascending-time) order — required for the value axis', () => {
    const out = decimate(mk(100_000, (i) => Math.sin(i / 7)), 1000, (p) => p.v)
    for (let k = 1; k < out.length; k++) {
      expect(out[k].i).toBeGreaterThan(out[k - 1].i)
    }
  })

  it('works on [x, y] tuples (the live-chart representation)', () => {
    const tuples: Array<[number, number]> = Array.from({ length: 5000 }, (_, i) => [i / 100, Math.cos(i)])
    const out = decimate(tuples, 200, (t) => t[1])
    expect(out.length).toBeLessThanOrEqual(202)
    expect(out[0]).toBe(tuples[0])
    expect(out[out.length - 1]).toBe(tuples[tuples.length - 1])
  })
})

describe('lowerBoundIndex', () => {
  const xs = Array.from({ length: 1000 }, (_, i) => i * 2) // 0,2,4,...,1998
  const getX = (i: number) => xs[i]

  it('finds the first index whose value is >= target', () => {
    expect(lowerBoundIndex(xs.length, getX, 0)).toBe(0)
    expect(lowerBoundIndex(xs.length, getX, 1)).toBe(1)   // first >=1 is xs[1]=2
    expect(lowerBoundIndex(xs.length, getX, 2)).toBe(1)
    expect(lowerBoundIndex(xs.length, getX, 1998)).toBe(999)
  })

  it('returns count when the target is beyond the last value', () => {
    expect(lowerBoundIndex(xs.length, getX, 5000)).toBe(1000)
  })
})

describe('decimateIndices (ring-buffer / windowed live path)', () => {
  it('returns every index when the range already fits', () => {
    expect(decimateIndices((i) => i, 0, 50, 100)).toEqual(Array.from({ length: 50 }, (_, i) => i))
  })

  it('includes the range endpoints a and b-1', () => {
    const idx = decimateIndices((i) => Math.sin(i), 100, 90_000, 300)
    expect(idx[0]).toBe(100)
    expect(idx[idx.length - 1]).toBe(89_999)
  })

  it('keeps a peak that lives INSIDE the window (zoom reveals it)', () => {
    const peak = 42_000
    const getY = (i: number) => (i === peak ? 999 : 0.1)
    const idx = decimateIndices(getY, 10_000, 80_000, 400)
    expect(idx).toContain(peak)
    expect(idx.length).toBeLessThanOrEqual(402)
  })

  it('emits indices in ascending order', () => {
    const idx = decimateIndices((i) => Math.sin(i / 5), 0, 100_000, 1000)
    for (let k = 1; k < idx.length; k++) expect(idx[k]).toBeGreaterThan(idx[k - 1])
  })

  it('handles an empty/degenerate range', () => {
    expect(decimateIndices((i) => i, 5, 5, 100)).toEqual([])
  })
})

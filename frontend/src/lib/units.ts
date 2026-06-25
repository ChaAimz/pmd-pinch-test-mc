// Clamp-force unit conversion — single source of truth.
// The DB always stores clamp force in Newtons; the operator may view it in
// gram-force (gf) via the esp32Unit setting. 1 N = 101.97… gf.

export const GF_PER_N = 101.97162129779283

export type ForceUnit = 'gf' | 'N'

/** Convert a Newton value to gram-force. */
export function nToGf(n: number): number {
  return n * GF_PER_N
}

/** Convert a gram-force value to Newtons. */
export function gfToN(gf: number): number {
  return gf / GF_PER_N
}

/**
 * Format a Newton clamp-force value for display in the operator's chosen unit.
 * gf → 1 decimal place; N → the value's own precision.
 */
export function formatClampForce(valueN: number, unit: ForceUnit): string {
  return unit === 'gf' ? nToGf(valueN).toFixed(1) : String(valueN)
}

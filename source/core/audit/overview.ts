import type { RequestOutcome } from './records.ts'

/** How many requests had each outcome, in one slot of time. */
export interface Slot {
  readonly at: string
  readonly forwarded: number
  readonly rejected: number
  readonly failed: number
}

export interface Ranked {
  readonly name: string
  readonly count: number
}

/**
 * What guards did over a window, at a glance: outcomes over time, why
 * requests were rejected, which actions and subjects were denied most, which
 * policies denied most, and how long requests took. Read from rollups, so
 * a long window costs no more than a short one — except `deniedSubjects`,
 * counted from the raw records, so only as far back as they are kept.
 */
export interface Overview {
  readonly from: string
  readonly to: string
  /** How long each slot of `series` is. */
  readonly stepMs: number
  readonly totals: Readonly<Record<RequestOutcome, number>>
  readonly rejections: readonly Ranked[]
  readonly series: readonly Slot[]
  readonly deniedActions: readonly Ranked[]
  readonly deniedSubjects: readonly Ranked[]
  readonly denyingPolicies: readonly Ranked[]
  /** In ms, each the upper bound of the latency bucket it falls in; none without requests. */
  readonly latency:
    | { readonly p50: number; readonly p95: number; readonly p99: number }
    | undefined
}

/** The slot lengths an overview picks from: the shortest that keeps a series within `MAX_SLOTS`. */
const STEPS_MS = [1, 5, 15, 60, 360, 1440].map((minutes) => minutes * 60_000)
const MAX_SLOTS = 120

/** How long each slot of an overview over `spanMs` is. */
export function stepFor(spanMs: number): number {
  return STEPS_MS.find((step) => spanMs / step <= MAX_SLOTS) ??
    STEPS_MS[STEPS_MS.length - 1]
}

/** The upper bound, in ms, of each latency bucket requests are counted in; the last catches everything slower. */
export const LATENCY_BUCKETS_MS = [
  1,
  2,
  5,
  10,
  20,
  50,
  100,
  200,
  500,
  1000,
  2000,
  5000,
  10000,
  Infinity,
] as const

/** The bucket a request that took `durationMs` is counted in. */
export function bucketOf(durationMs: number): number {
  return LATENCY_BUCKETS_MS.findIndex((bound) => durationMs <= bound)
}

/**
 * The latency `quantile` (0.95) of requests counted per bucket, as the
 * upper bound of the bucket it falls in: an estimate never lower than the
 * truth. Undefined when nothing was counted.
 */
export function quantileOf(
  counts: ReadonlyMap<number, number>,
  quantile: number,
): number | undefined {
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
  if (total === 0) return undefined
  let seen = 0
  for (let bucket = 0; bucket < LATENCY_BUCKETS_MS.length; bucket++) {
    seen += counts.get(bucket) ?? 0
    if (seen >= quantile * total) return LATENCY_BUCKETS_MS[bucket]
  }
  return LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1]
}

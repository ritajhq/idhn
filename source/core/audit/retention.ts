const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How long the audit keeps what: raw records, to look at single trails,
 * and rollups, the counts overviews are read from, for much longer.
 */
export class Retention {
  constructor(
    readonly rawDays: number = 30,
    readonly rollupDays: number = 365,
  ) {}

  /** Raw records from before this are let go. */
  rawBefore(now: Date): Date {
    return new Date(now.getTime() - this.rawDays * DAY_MS)
  }

  /** Rollups from before this are let go. */
  rollupsBefore(now: Date): Date {
    return new Date(now.getTime() - this.rollupDays * DAY_MS)
  }
}

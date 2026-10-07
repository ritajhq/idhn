import type { RequestOutcome } from './records.ts'

/** A time range: from `from`, up to but not including `to`. */
export class Window {
  constructor(readonly from: Date, readonly to: Date) {
    if (to.getTime() <= from.getTime()) {
      throw new RangeError('A window must end after it starts')
    }
  }

  /** The last `ms` before `now`. */
  static last(ms: number, now: Date = new Date()): Window {
    return new Window(new Date(now.getTime() - ms), now)
  }

  get spanMs(): number {
    return this.to.getTime() - this.from.getTime()
  }
}

/** Which trails to look at, beside when. Any left out matches every trail. */
export interface Filters {
  readonly resource?: string
  readonly action?: string
  readonly outcome?: RequestOutcome
  readonly rejection?: string
  readonly subject?: string
  /** Trails whose decision this policy had a say in. */
  readonly policy?: string
}

/** The most trails one page holds. */
export const MAX_PAGE = 200

/**
 * A page of trails to read: those in `window` matching `filters`, newest
 * first, `limit` at a time, from where the `cursor` of the previous page
 * left off.
 */
export class Query {
  readonly limit: number

  constructor(
    readonly window: Window,
    readonly filters: Filters = {},
    limit: number = 50,
    readonly cursor?: string,
  ) {
    this.limit = Math.max(1, Math.min(MAX_PAGE, Math.floor(limit)))
  }
}

/** Where a page of trails ended: the last one's time and record id. Opaque to whoever holds it. */
export class Cursor {
  constructor(readonly timestamp: number, readonly recordId: string) {}

  static parse(text: string): Cursor {
    const [timestamp, recordId] = atob(text).split(':')
    const at = Number(timestamp)
    if (!Number.isFinite(at) || !recordId) {
      throw new RangeError('Not a cursor this audit gave out')
    }
    return new Cursor(at, recordId)
  }

  toString(): string {
    return btoa(`${this.timestamp}:${this.recordId}`)
  }
}

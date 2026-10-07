import * as Horizon from '@ritaj/horizon'
import type { Rejected } from './faults.ts'

/** Which trails to look at, beside when. */
export interface Filters {
  resource?: string
  action?: string
  outcome?: 'forwarded' | 'rejected' | 'failed'
  rejection?: string
  subject?: string
  policy?: string
}

export interface Ranked {
  name: string
  count: number
}

/** What guards did over a window, at a glance (see `Audit.Overview` in `@idhn/audit`). */
export interface OverviewView {
  from: string
  to: string
  stepMs: number
  totals: { forwarded: number; rejected: number; failed: number }
  rejections: Ranked[]
  series: { at: string; forwarded: number; rejected: number; failed: number }[]
  deniedActions: Ranked[]
  deniedSubjects: Ranked[]
  denyingPolicies: Ranked[]
  latency: { p50: number; p95: number; p99: number } | undefined
}

export interface RequestView {
  recordId: string
  timestamp: string
  durationMs: number
  outcome: 'forwarded' | 'rejected' | 'failed'
  resource?: string
  action?: string
  identity?: { status: string; subject?: string }
  decisionId?: string
  rejection?: string
  error?: string
  method?: string
  path?: string
  source?: { app: string; resource?: string; instance: string }
}

export interface DecisionView {
  recordId: string
  decisionId: string
  timestamp: string
  durationMs: number
  action: string
  /** Redacted: see `Audit.Redaction`. */
  context: Record<string, unknown>
  outcome: 'allowed' | 'denied' | 'unavailable' | 'failed'
  results: { policy: string; verdict: 'allow' | 'deny' | 'neutral' }[]
  error?: string
}

/** A request with the decision it got, if a judge was asked. */
export interface TrailView {
  request: RequestView
  decision?: DecisionView
}

export interface TrailsPage {
  trails: TrailView[]
  /** Where the next page starts; none on the last. */
  next?: string
}

/** A time window, as every audit query takes one. */
class Windowed<T extends Horizon.DataStructure>
  extends Horizon.Query<T, Rejected> {
  private readonly since = this.c.String('', 'audit.since')
  private readonly until = this.c.String('', 'audit.until')

  constructor(from?: Date, to?: Date) {
    super()
    if (from) this.since.Write(from.toISOString())
    if (to) this.until.Write(to.toISOString())
  }

  /** Where the window starts. (`From` is who sent the query.) */
  get Since(): Date {
    return new Date(this.since.Read())
  }

  /** Where the window ends, not included. */
  get Until(): Date {
    return new Date(this.until.Read())
  }
}

/** What guards did over a window, for one resource or all. */
export class Overview extends Windowed<OverviewView> {
  private readonly resource = this.c.String('', 'audit.overview.resource')

  constructor(from?: Date, to?: Date, resource?: string) {
    super(from, to)
    if (resource) this.resource.Write(resource)
  }

  get Resource(): string | undefined {
    return this.resource.Read() || undefined
  }
}

/** A page of trails in a window, newest first. */
export class Trails extends Windowed<TrailsPage> {
  private readonly filters = this.c.Object<Filters>({}, 'audit.trails.filters')
  private readonly limit = this.c.Number(50, 'audit.trails.limit')
  private readonly cursor = this.c.String('', 'audit.trails.cursor')

  constructor(
    from?: Date,
    to?: Date,
    filters: Filters = {},
    limit = 50,
    cursor?: string,
  ) {
    super(from, to)
    this.filters.Write(filters)
    this.limit.Write(limit)
    if (cursor) this.cursor.Write(cursor)
  }

  get Filters(): Filters {
    return this.filters.Read()
  }

  get Limit(): number {
    return this.limit.Read()
  }

  get Cursor(): string | undefined {
    return this.cursor.Read() || undefined
  }
}

/** One trail, by its request's record id: none once it is no longer kept. */
export class Trail extends Horizon.Query<TrailView | null> {
  private readonly recordId = this.c.String('', 'audit.trail.record_id')

  constructor(recordId = '') {
    super()
    this.recordId.Write(recordId)
  }

  get RecordId(): string {
    return this.recordId.Read()
  }
}

Horizon.Query.Register(Overview, '/audit.overview')
Horizon.Query.Register(Trails, '/audit.trails')
Horizon.Query.Register(Trail, '/audit.trail')

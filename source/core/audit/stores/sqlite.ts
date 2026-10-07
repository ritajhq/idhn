import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { bucketOf, quantileOf } from '../latency.ts'
import { type Overview, type Ranked, type Slot, stepFor } from '../overview.ts'
import { Cursor, type Query, type Window } from '../query.ts'
import {
  Decision,
  Request,
  type RequestOutcome,
  resourceOf,
  Trail,
} from '../records.ts'
import type { Retention } from '../retention.ts'

/** How many of each ranking an overview lists. */
const TOP = 10

const MINUTE_MS = 60_000

/** What one `append` did: records kept, and records already kept before (delivered again). */
export interface Appended {
  readonly appended: number
  readonly duplicates: number
}

/**
 * The audit kept in SQLite: one file, no service to run, for a single node.
 *
 * Raw records are kept as they came, with the columns trails are filtered
 * by. Each record kept for the first time also counts towards per-minute
 * rollups, in the same transaction, so overviews read counts instead of
 * scanning records, and a record delivered again is neither kept nor
 * counted twice.
 */
export class Sqlite {
  private constructor(private readonly db: DatabaseSync) {}

  /** The audit kept in `db`, its tables created if they don't exist yet. */
  static open(db: DatabaseSync): Sqlite {
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS requests (
        record_id TEXT PRIMARY KEY,
        at INTEGER NOT NULL,
        resource TEXT,
        action TEXT,
        outcome TEXT NOT NULL,
        rejection TEXT,
        subject TEXT,
        decision_id TEXT,
        document TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS requests_at ON requests (at, record_id);
      CREATE INDEX IF NOT EXISTS requests_decision ON requests (decision_id);
      CREATE INDEX IF NOT EXISTS requests_subject ON requests (subject, at);
      CREATE TABLE IF NOT EXISTS decisions (
        record_id TEXT PRIMARY KEY,
        decision_id TEXT NOT NULL,
        at INTEGER NOT NULL,
        document TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS decisions_decision ON decisions (decision_id);
      CREATE INDEX IF NOT EXISTS decisions_at ON decisions (at);
      CREATE TABLE IF NOT EXISTS verdicts (
        decision_id TEXT NOT NULL,
        at INTEGER NOT NULL,
        policy TEXT NOT NULL,
        verdict TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS verdicts_policy ON verdicts (policy, decision_id);
      CREATE INDEX IF NOT EXISTS verdicts_at ON verdicts (at);
      CREATE TABLE IF NOT EXISTS request_rollup (
        minute INTEGER NOT NULL,
        resource TEXT NOT NULL,
        action TEXT NOT NULL,
        outcome TEXT NOT NULL,
        rejection TEXT NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (minute, resource, action, outcome, rejection)
      ) STRICT, WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS latency_rollup (
        minute INTEGER NOT NULL,
        resource TEXT NOT NULL,
        bucket INTEGER NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (minute, resource, bucket)
      ) STRICT, WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS verdict_rollup (
        minute INTEGER NOT NULL,
        resource TEXT NOT NULL,
        policy TEXT NOT NULL,
        verdict TEXT NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (minute, resource, policy, verdict)
      ) STRICT, WITHOUT ROWID;
    `)
    return new Sqlite(db)
  }

  /** Keeps every record not kept before, counting each towards the rollups, all at once or not at all. */
  append(records: readonly (Request | Decision)[]): Appended {
    let appended = 0
    this.transaction(() => {
      for (const record of records) {
        const kept = record instanceof Request
          ? this.appendRequest(record)
          : this.appendDecision(record)
        if (kept) appended++
      }
    })
    return { appended, duplicates: records.length - appended }
  }

  /** A page of trails, newest first, and the cursor to the next page if there is one. */
  trails(query: Query): { trails: Trail[]; next: string | undefined } {
    const where = [
      'at >= ?',
      'at < ?',
    ]
    const values: SQLInputValue[] = [
      query.window.from.getTime(),
      query.window.to.getTime(),
    ]
    const columns: [keyof typeof query.filters, string][] = [
      ['resource', 'resource'],
      ['action', 'action'],
      ['outcome', 'outcome'],
      ['rejection', 'rejection'],
      ['subject', 'subject'],
    ]
    for (const [filter, column] of columns) {
      const value = query.filters[filter]
      if (value === undefined) continue
      where.push(`${column} = ?`)
      values.push(value)
    }
    if (query.filters.policy !== undefined) {
      where.push(
        'decision_id IN (SELECT decision_id FROM verdicts WHERE policy = ?)',
      )
      values.push(query.filters.policy)
    }
    if (query.cursor !== undefined) {
      const cursor = Cursor.parse(query.cursor)
      where.push('(at < ? OR (at = ? AND record_id < ?))')
      values.push(cursor.timestamp, cursor.timestamp, cursor.recordId)
    }
    const rows = this.db.prepare(
      `SELECT document FROM requests WHERE ${where.join(' AND ')}
       ORDER BY at DESC, record_id DESC LIMIT ?`,
    ).all(...values, query.limit + 1)
    const requests = rows.slice(0, query.limit).map((row) =>
      requestOf(JSON.parse(String(row.document)))
    )
    const last = requests.at(-1)
    return {
      trails: this.joined(requests),
      next: rows.length > query.limit && last !== undefined
        ? new Cursor(last.timestamp.getTime(), last.recordId).toString()
        : undefined,
    }
  }

  /** The trail of the request kept as `recordId`, if it still is. */
  trail(recordId: string): Trail | undefined {
    const row = this.db.prepare(
      'SELECT document FROM requests WHERE record_id = ?',
    ).get(recordId)
    if (row === undefined) return undefined
    return this.joined([requestOf(JSON.parse(String(row.document)))])[0]
  }

  /** What guards did over `window`, for one resource or all of them. */
  overview(window: Window, resource?: string): Overview {
    const stepMs = stepFor(window.spanMs)
    const from = Math.floor(window.from.getTime() / MINUTE_MS)
    const to = Math.ceil(window.to.getTime() / MINUTE_MS)
    const scope = resource === undefined ? '' : ' AND resource = ?'
    const scoped = (...values: SQLInputValue[]) =>
      resource === undefined ? values : [...values, resource]

    const outcomes = this.db.prepare(
      `SELECT CAST((minute * ${MINUTE_MS}) / ? AS INTEGER) AS slot, outcome, SUM(count) AS count
       FROM request_rollup WHERE minute >= ? AND minute < ?${scope}
       GROUP BY slot, outcome ORDER BY slot`,
    ).all(...scoped(stepMs, from, to))
    const totals: Record<RequestOutcome, number> = {
      forwarded: 0,
      rejected: 0,
      failed: 0,
    }
    const slots = new Map<number, Record<RequestOutcome, number>>()
    for (const row of outcomes) {
      const outcome = String(row.outcome) as RequestOutcome
      const count = Number(row.count)
      totals[outcome] += count
      const slot = slots.get(Number(row.slot)) ??
        { forwarded: 0, rejected: 0, failed: 0 }
      slot[outcome] += count
      slots.set(Number(row.slot), slot)
    }
    const series: Slot[] = [...slots].map(([slot, counts]) => ({
      at: new Date(slot * stepMs).toISOString(),
      ...counts,
    }))

    const latency = new Map(
      this.db.prepare(
        `SELECT bucket, SUM(count) AS count FROM latency_rollup
         WHERE minute >= ? AND minute < ?${scope} GROUP BY bucket`,
      ).all(...scoped(from, to)).map((
        row,
      ) => [Number(row.bucket), Number(row.count)]),
    )
    const p50 = quantileOf(latency, 0.5)

    return {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      stepMs,
      totals,
      series,
      rejections: this.ranked(
        `SELECT rejection AS name, SUM(count) AS count FROM request_rollup
         WHERE minute >= ? AND minute < ? AND outcome = 'rejected'${scope}
         GROUP BY rejection`,
        scoped(from, to),
      ),
      deniedActions: this.ranked(
        `SELECT action AS name, SUM(count) AS count FROM request_rollup
         WHERE minute >= ? AND minute < ? AND action != ''
           AND rejection IN ('forbidden', 'unauthenticated')${scope}
         GROUP BY action`,
        scoped(from, to),
      ),
      deniedSubjects: this.ranked(
        `SELECT subject AS name, COUNT(*) AS count FROM requests
         WHERE at >= ? AND at < ? AND rejection = 'forbidden'
           AND subject IS NOT NULL${scope}
         GROUP BY subject`,
        scoped(window.from.getTime(), window.to.getTime()),
      ),
      denyingPolicies: this.ranked(
        `SELECT policy AS name, SUM(count) AS count FROM verdict_rollup
         WHERE minute >= ? AND minute < ? AND verdict = 'deny'${scope}
         GROUP BY policy`,
        scoped(from, to),
      ),
      latency: p50 === undefined ? undefined : {
        p50,
        p95: quantileOf(latency, 0.95)!,
        p99: quantileOf(latency, 0.99)!,
      },
    }
  }

  /** Lets go of what `retention` no longer keeps. */
  purge(retention: Retention, now: Date): void {
    const raw = retention.rawBefore(now).getTime()
    const rollups = Math.floor(
      retention.rollupsBefore(now).getTime() / MINUTE_MS,
    )
    this.transaction(() => {
      for (const table of ['requests', 'decisions', 'verdicts']) {
        this.db.prepare(`DELETE FROM ${table} WHERE at < ?`).run(raw)
      }
      for (
        const table of ['request_rollup', 'latency_rollup', 'verdict_rollup']
      ) {
        this.db.prepare(`DELETE FROM ${table} WHERE minute < ?`).run(rollups)
      }
    })
  }

  private appendRequest(request: Request): boolean {
    const { changes } = this.db.prepare(
      `INSERT OR IGNORE INTO requests
       (record_id, at, resource, action, outcome, rejection, subject, decision_id, document)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      request.recordId,
      request.timestamp.getTime(),
      request.resource ?? null,
      request.action ?? null,
      request.outcome,
      request.rejection ?? null,
      request.identity?.subject ?? null,
      request.decisionId ?? null,
      JSON.stringify(request),
    )
    if (changes === 0) return false
    const minute = Math.floor(request.timestamp.getTime() / MINUTE_MS)
    const resource = request.resource ?? ''
    this.db.prepare(
      `INSERT INTO request_rollup VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT DO UPDATE SET count = count + 1`,
    ).run(
      minute,
      resource,
      request.action ?? '',
      request.outcome,
      request.rejection ?? '',
    )
    this.db.prepare(
      `INSERT INTO latency_rollup VALUES (?, ?, ?, 1)
       ON CONFLICT DO UPDATE SET count = count + 1`,
    ).run(minute, resource, bucketOf(request.durationMs))
    return true
  }

  private appendDecision(decision: Decision): boolean {
    const at = decision.timestamp.getTime()
    const { changes } = this.db.prepare(
      `INSERT OR IGNORE INTO decisions (record_id, decision_id, at, document)
       VALUES (?, ?, ?, ?)`,
    ).run(decision.recordId, decision.decisionId, at, JSON.stringify(decision))
    if (changes === 0) return false
    const minute = Math.floor(at / MINUTE_MS)
    for (const result of decision.results) {
      this.db.prepare(
        'INSERT INTO verdicts (decision_id, at, policy, verdict) VALUES (?, ?, ?, ?)',
      ).run(decision.decisionId, at, result.policy, result.verdict)
      this.db.prepare(
        `INSERT INTO verdict_rollup VALUES (?, ?, ?, ?, 1)
         ON CONFLICT DO UPDATE SET count = count + 1`,
      ).run(minute, resourceOf(decision.action), result.policy, result.verdict)
    }
    return true
  }

  /** Each request with its decision, if one is kept. */
  private joined(requests: readonly Request[]): Trail[] {
    const ids = requests.flatMap((request) =>
      request.decisionId === undefined ? [] : [request.decisionId]
    )
    const decisions = new Map<string, Decision>()
    if (ids.length > 0) {
      const rows = this.db.prepare(
        `SELECT document FROM decisions WHERE decision_id IN (${
          ids.map(() => '?').join(', ')
        })`,
      ).all(...ids)
      for (const row of rows) {
        const decision = decisionOf(JSON.parse(String(row.document)))
        decisions.set(decision.decisionId, decision)
      }
    }
    return requests.map((request) =>
      new Trail(
        request,
        request.decisionId === undefined
          ? undefined
          : decisions.get(request.decisionId),
      )
    )
  }

  private ranked(sql: string, values: SQLInputValue[]): Ranked[] {
    return this.db.prepare(`${sql} ORDER BY count DESC, name LIMIT ${TOP}`)
      .all(...values)
      .map((row) => ({ name: String(row.name), count: Number(row.count) }))
  }

  private transaction(work: () => void): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      work()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}

/** A `Request` back from the JSON it was kept as. */
// deno-lint-ignore no-explicit-any
function requestOf(raw: any): Request {
  return new Request(
    raw.recordId,
    new Date(raw.timestamp),
    raw.durationMs,
    raw.outcome,
    raw.resource,
    raw.action,
    raw.identity,
    raw.decisionId,
    raw.rejection,
    raw.error,
    raw.method,
    raw.path,
    raw.source,
  )
}

/** A `Decision` back from the JSON it was kept as. */
// deno-lint-ignore no-explicit-any
function decisionOf(raw: any): Decision {
  return new Decision(
    raw.recordId,
    raw.decisionId,
    new Date(raw.timestamp),
    raw.durationMs,
    raw.action,
    raw.context,
    raw.outcome,
    raw.results,
    raw.error,
    raw.source,
  )
}

import {
  Decision,
  type DecisionOutcome,
  type Identity,
  Request,
  type RequestOutcome,
  resourceOf,
  type Result,
  type Verdict,
} from './records.ts'
import { SCHEMA, type Source } from './stamp.ts'

/** A line that says it is an audit record, but isn't a readable one. */
export class MalformedLineError extends Error {}

const REQUEST_OUTCOMES: readonly RequestOutcome[] = [
  'forwarded',
  'rejected',
  'failed',
]
const DECISION_OUTCOMES: readonly DecisionOutcome[] = [
  'allowed',
  'denied',
  'unavailable',
  'failed',
]
const VERDICTS: readonly Verdict[] = ['allow', 'deny', 'neutral']

/** What one log line is: an audit record, or a line of no concern to the audit (`guard.started`, say). */
export type Parsed =
  | { kind: 'request'; record: Request }
  | { kind: 'decision'; record: Decision }
  | { kind: 'ignored' }

/** How each audit event is read: a line's own fields, and the record id to give it. */
const READERS: Readonly<
  Record<string, (fields: Fields, recordId: string) => Parsed>
> = {
  'guard.request': (fields, recordId) => ({
    kind: 'request',
    record: readRequest(fields, recordId),
  }),
  'judge.decision': (fields, recordId) => ({
    kind: 'decision',
    record: readDecision(fields, recordId),
  }),
}

/**
 * Reads one JSON line as guards and judges write it. A line without a
 * `recordId` (written before lines carried one) is given one derived from
 * its text, so delivering it twice still keeps it once. Throws
 * `MalformedLineError` for an audit line it can't read, or one written in a
 * newer schema than this reads.
 */
export async function parseLine(text: string): Promise<Parsed> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new MalformedLineError('not JSON')
  }
  const fields = new Fields(raw, 'line')
  const read = READERS[fields.optionalString('event') ?? '']
  if (read === undefined) return { kind: 'ignored' }

  const schema = fields.optionalNumber('schema') ?? SCHEMA
  if (schema > SCHEMA) {
    throw new MalformedLineError(
      `written in audit schema ${schema}, newer than ${SCHEMA}`,
    )
  }
  return read(fields, fields.optionalString('recordId') ?? await digest(text))
}

function readRequest(fields: Fields, recordId: string): Request {
  const action = fields.optionalString('action')
  const source = readSource(fields)
  const identity = fields.optionalObject('identity')
  return new Request(
    recordId,
    fields.date('timestamp'),
    fields.number('durationMs'),
    fields.oneOf('outcome', REQUEST_OUTCOMES),
    action === undefined ? source?.resource : resourceOf(action),
    action,
    identity === undefined ? undefined : {
      status: identity.string('status'),
      subject: identity.optionalString('subject'),
    } satisfies Identity,
    fields.optionalString('decisionId'),
    fields.optionalString('rejection'),
    fields.optionalString('error'),
    fields.optionalString('method'),
    fields.optionalString('path'),
    source,
  )
}

function readDecision(fields: Fields, recordId: string): Decision {
  return new Decision(
    recordId,
    fields.string('decisionId'),
    fields.date('timestamp'),
    fields.number('durationMs'),
    fields.string('action'),
    fields.optionalObject('context')?.raw ?? {},
    fields.oneOf('outcome', DECISION_OUTCOMES),
    fields.array('results').map((result) =>
      ({
        policy: result.string('policy'),
        verdict: result.oneOf('verdict', VERDICTS),
      }) satisfies Result
    ),
    fields.optionalString('error'),
    readSource(fields),
  )
}

function readSource(fields: Fields): Source | undefined {
  const source = fields.optionalObject('source')
  if (source === undefined) return undefined
  return {
    app: source.string('app'),
    resource: source.optionalString('resource'),
    instance: source.string('instance'),
  }
}

async function digest(text: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )
  return Array.from(
    new Uint8Array(hash),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
}

/** The fields of one JSON object in a line, read by name, naming where any is wrong. */
class Fields {
  readonly raw: Record<string, unknown>

  constructor(raw: unknown, private readonly path: string) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new MalformedLineError(`${path} must be an object`)
    }
    this.raw = raw as Record<string, unknown>
  }

  string(name: string): string {
    const value = this.optionalString(name)
    if (value === undefined) this.fail(name, 'a string')
    return value
  }

  optionalString(name: string): string | undefined {
    const value = this.raw[name]
    if (value === undefined || value === null) return undefined
    if (typeof value !== 'string') this.fail(name, 'a string')
    return value
  }

  number(name: string): number {
    const value = this.optionalNumber(name)
    if (value === undefined) this.fail(name, 'a number')
    return value
  }

  optionalNumber(name: string): number | undefined {
    const value = this.raw[name]
    if (value === undefined || value === null) return undefined
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.fail(name, 'a number')
    }
    return value
  }

  date(name: string): Date {
    const date = new Date(this.string(name))
    if (Number.isNaN(date.getTime())) this.fail(name, 'an ISO date')
    return date
  }

  oneOf<T extends string>(name: string, allowed: readonly T[]): T {
    const value = this.string(name)
    if (!allowed.includes(value as T)) {
      this.fail(name, `one of ${allowed.join(', ')}`)
    }
    return value as T
  }

  optionalObject(name: string): Fields | undefined {
    const value = this.raw[name]
    if (value === undefined || value === null) return undefined
    return new Fields(value, `${this.path}.${name}`)
  }

  array(name: string): Fields[] {
    const value = this.raw[name]
    if (!Array.isArray(value)) this.fail(name, 'an array')
    return value.map((item, index) =>
      new Fields(item, `${this.path}.${name}[${index}]`)
    )
  }

  private fail(name: string, expected: string): never {
    throw new MalformedLineError(`${this.path}.${name} must be ${expected}`)
  }
}

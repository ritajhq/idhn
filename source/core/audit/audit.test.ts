import { assertEquals, assertRejects } from '@std/assert'
import { DatabaseSync } from 'node:sqlite'
import * as Access from '@idhn/access'
import * as Disclosure from '@idhn/disclosure'
import * as Guard from '@idhn/guard'
import * as Judge from '@idhn/judge'
import * as Log from '@idhn/log'
import * as Policy from '@idhn/policy'
import {
  Ingestion,
  MalformedLineError,
  parseLine,
  Query,
  Redaction,
  Retention,
  Stamp,
  Stores,
  Window,
} from './index.ts'

const T0 = new Date('2026-10-06T10:00:00.000Z')
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000)

/** The lines a guard and its judge write for one request, exactly as they write them. */
function linesFor(
  { minute, role, allowed, path = '/members', durationMs = 4 }: {
    minute: number
    role: string
    allowed: boolean
    path?: string
    durationMs?: number
  },
): string[] {
  const lines: string[] = []
  const guardLog = new Log.JsonLines(
    (line) => lines.push(line),
    new Stamp({ app: 'guard', resource: 'directory', instance: 'g-1' }).fields,
  )
  const judgeLog = new Log.JsonLines(
    (line) => lines.push(line),
    new Stamp({ app: 'judge', instance: 'j-1' }).fields,
  )
  const decisionId = crypto.randomUUID()
  const action = new Access.Action('directory.members.list')
  const identity = Access.Identity.authenticated(
    `u-${role}`,
    'https://auth.test',
    {
      role,
      email: `${role}@example.com`,
    },
  )
  const context = new Access.Context({ q: 'ada' }).with({
    auth: identity.toFact(),
  })
  const verdict = allowed ? Policy.Verdict.Allow : Policy.Verdict.Deny
  judgeLog.write(
    'judge.decision',
    Judge.DecisionRecord.decided(
      decisionId,
      at(minute),
      1,
      action,
      context,
      new Judge.Decision(allowed, [
        new Policy.Result(new Policy.Identifier('member.directory'), verdict),
      ]),
    ),
  )
  guardLog.write(
    'guard.request',
    new Guard.HttpRequestRecord(
      new Request(`http://guard.test${path}`),
      new Guard.RequestRecord(
        at(minute).toISOString(),
        durationMs,
        allowed ? 'forwarded' : 'rejected',
        action.name,
        { status: 'authenticated', subject: identity.subject },
        decisionId,
        allowed ? undefined : Guard.Rejection.Forbidden,
        undefined,
      ),
    ),
  )
  guardLog.write('guard.started', { enforcement: 'full' })
  return lines
}

function audit(redaction = new Redaction()) {
  const store = Stores.Sqlite.open(new DatabaseSync(':memory:'))
  return { store, ingestion: new Ingestion(store, redaction) }
}

Deno.test('parseLine: reads what guards and judges write, and ignores their other lines', async () => {
  const [decision, request, started] = linesFor({
    minute: 0,
    role: 'member',
    allowed: false,
  })
  const parsedRequest = await parseLine(request)
  assertEquals(parsedRequest.kind, 'request')
  if (parsedRequest.kind !== 'request') return
  assertEquals(parsedRequest.record.resource, 'directory')
  assertEquals(parsedRequest.record.identity, {
    status: 'authenticated',
    subject: 'u-member',
  })
  assertEquals(parsedRequest.record.path, '/members')
  assertEquals(parsedRequest.record.source?.instance, 'g-1')

  const parsedDecision = await parseLine(decision)
  if (parsedDecision.kind !== 'decision') throw new Error('not a decision')
  assertEquals(parsedDecision.record.denyingPolicies, ['member.directory'])
  assertEquals((await parseLine(started)).kind, 'ignored')
})

Deno.test('parseLine: refuses an unreadable audit line, and gives a line without an id one of its own', async () => {
  await assertRejects(() => parseLine('{oops'), MalformedLineError, 'not JSON')
  await assertRejects(
    () =>
      parseLine(
        JSON.stringify({
          event: 'guard.request',
          timestamp: T0.toISOString(),
          outcome: 'forwarded',
        }),
      ),
    MalformedLineError,
    'line.durationMs',
  )
  await assertRejects(
    () => parseLine(JSON.stringify({ event: 'judge.decision', schema: 99 })),
    MalformedLineError,
    'schema 99',
  )
  const old = JSON.stringify({
    event: 'guard.request',
    timestamp: T0.toISOString(),
    durationMs: 1,
    outcome: 'rejected',
  })
  const [first, again] = [await parseLine(old), await parseLine(old)]
  if (first.kind !== 'request' || again.kind !== 'request') {
    throw new Error('not requests')
  }
  assertEquals(first.record.recordId, again.record.recordId)
})

Deno.test('Redaction: covers auth but its status and subject, unless kept, and the facts configured', async () => {
  const [line] = linesFor({ minute: 0, role: 'admin', allowed: true })
  const parsed = await parseLine(line)
  if (parsed.kind !== 'decision') throw new Error('not a decision')

  const byDefault = new Redaction().apply(parsed.record).context
  assertEquals(byDefault.auth, {
    status: 'authenticated',
    subject: 'u-admin',
    issuer: Disclosure.MASK,
    claims: { role: Disclosure.MASK, email: Disclosure.MASK },
  })
  assertEquals(byDefault.q, 'ada')

  const configured = new Redaction(
    ['claims.role', 'issuer'],
    Disclosure.Disclosure.parse({ '/q': 'covered' }, 'facts'),
  )
    .apply(parsed.record).context
  assertEquals(configured.auth, {
    status: 'authenticated',
    subject: 'u-admin',
    issuer: 'https://auth.test',
    claims: { role: 'admin', email: Disclosure.MASK },
  })
  assertEquals(configured.q, Disclosure.MASK)
  // The record it was given keeps what it had.
  assertEquals(
    (parsed.record.context.auth as { claims: { email: string } }).claims.email,
    'admin@example.com',
  )
})

Deno.test('Ingestion: keeps each record once, however often it is delivered, reporting lines it cannot read', async () => {
  const { store, ingestion } = audit()
  const batch = linesFor({ minute: 0, role: 'member', allowed: false }).join(
    '\n',
  )

  assertEquals(await ingestion.ingest(`${batch}\n{oops\n`), {
    accepted: 2,
    duplicates: 0,
    ignored: 1,
    refused: [{ line: 4, reason: 'not JSON' }],
  })
  assertEquals((await ingestion.ingest(batch)).duplicates, 2)
  assertEquals(
    store.trails(new Query(Window.last(60 * 60_000, at(30)))).trails.length,
    1,
  )
})

Deno.test('Store: trails join each request to its decision, filter, and page newest first', async () => {
  const { store, ingestion } = audit()
  for (let minute = 0; minute < 5; minute++) {
    await ingestion.ingest(
      linesFor({
        minute,
        role: minute % 2 ? 'member' : 'admin',
        allowed: minute % 2 === 0,
      }).join('\n'),
    )
  }
  const window = new Window(T0, at(10))

  const first = store.trails(new Query(window, {}, 2))
  assertEquals(first.trails.map((trail) => trail.request.timestamp), [
    at(4),
    at(3),
  ])
  assertEquals(first.trails[1].decision?.outcome, 'denied')
  assertEquals(
    (first.trails[1].decision?.context.auth as { claims: { role: string } })
      .claims.role,
    Disclosure.MASK,
  )
  const second = store.trails(new Query(window, {}, 2, first.next))
  assertEquals(second.trails.map((trail) => trail.request.timestamp), [
    at(2),
    at(1),
  ])
  const third = store.trails(new Query(window, {}, 2, second.next))
  assertEquals([third.trails.length, third.next], [1, undefined])

  const denied = store.trails(
    new Query(window, { outcome: 'rejected', subject: 'u-member' }),
  )
  assertEquals(denied.trails.length, 2)
  assertEquals(
    store.trails(new Query(window, { policy: 'member.directory' })).trails
      .length,
    5,
  )
  assertEquals(
    store.trails(new Query(window, { policy: 'other' })).trails.length,
    0,
  )

  const one = first.trails[0]
  assertEquals(
    store.trail(one.request.recordId)?.decision?.decisionId,
    one.decision?.decisionId,
  )
})

Deno.test('Store: an overview counts outcomes over time, who and what was denied, and latency', async () => {
  const { store, ingestion } = audit()
  for (let minute = 0; minute < 10; minute++) {
    await ingestion.ingest(
      linesFor({
        minute,
        role: minute < 3 ? 'member' : 'admin',
        allowed: minute >= 3,
        durationMs: minute === 9 ? 900 : 4,
      }).join('\n'),
    )
  }
  const overview = store.overview(new Window(T0, at(60)))
  assertEquals(overview.stepMs, 60_000)
  assertEquals(overview.totals, { forwarded: 7, rejected: 3, failed: 0 })
  assertEquals(overview.series.length, 10)
  assertEquals(overview.series[0], {
    at: T0.toISOString(),
    forwarded: 0,
    rejected: 1,
    failed: 0,
  })
  assertEquals(overview.rejections, [{ name: 'forbidden', count: 3 }])
  assertEquals(overview.deniedActions, [{
    name: 'directory.members.list',
    count: 3,
  }])
  assertEquals(overview.deniedSubjects, [{ name: 'u-member', count: 3 }])
  assertEquals(overview.denyingPolicies, [{
    name: 'member.directory',
    count: 3,
  }])
  assertEquals(overview.latency, { p50: 5, p95: 1000, p99: 1000 })

  assertEquals(
    store.overview(new Window(T0, at(60)), 'elsewhere').totals.forwarded,
    0,
  )
})

Deno.test('Store: purging lets go of raw records first, and of rollups much later', async () => {
  const { store, ingestion } = audit()
  await ingestion.ingest(
    linesFor({ minute: 0, role: 'admin', allowed: true }).join('\n'),
  )
  const window = new Window(new Date(T0.getTime() - 1), at(1))
  const retention = new Retention(30, 365)

  store.purge(retention, new Date(T0.getTime() + 31 * 24 * 60 * 60_000))
  assertEquals(store.trails(new Query(window)).trails, [])
  assertEquals(store.overview(window).totals.forwarded, 1)

  store.purge(retention, new Date(T0.getTime() + 366 * 24 * 60 * 60_000))
  assertEquals(store.overview(window).totals.forwarded, 0)
})

Deno.test('Store: an overview over a long window counts each slot whole', async () => {
  const { store, ingestion } = audit()
  for (const minute of [0, 3, 14, 15, 29]) {
    await ingestion.ingest(
      linesFor({ minute, role: 'admin', allowed: true }).join('\n'),
    )
  }
  const overview = store.overview(new Window(T0, at(24 * 60)))
  assertEquals(overview.stepMs, 15 * 60_000)
  assertEquals(overview.series.map((slot) => [slot.at, slot.forwarded]), [
    [T0.toISOString(), 3],
    [at(15).toISOString(), 2],
  ])
})

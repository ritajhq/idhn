import { assertEquals } from '@std/assert'
import { DatabaseSync } from 'node:sqlite'
import * as Audit from '@idhn/audit'
import * as Contract from '@idhn/contract'
import * as Horizon from '@ritaj/horizon'
import { Client as HttpCourier } from '@ritaj/mux/client/http'
import { Server as HttpTransport } from '@ritaj/mux/server/http'
import { Intake } from './intake.ts'
import { Queries } from './queries.ts'
import { Server } from './server.ts'
import { Tail } from './tail.ts'

const T0 = new Date('2026-10-06T10:00:00.000Z')

/** A guard's `guard.request` line and its judge's `judge.decision` line for one denied request. */
function deniedRequest(minute: number, subject: string): string {
  const decisionId = crypto.randomUUID()
  const timestamp = new Date(T0.getTime() + minute * 60_000).toISOString()
  return [
    {
      event: 'judge.decision',
      recordId: crypto.randomUUID(),
      schema: 1,
      decisionId,
      timestamp,
      durationMs: 1,
      action: 'directory.members.list',
      context: {
        auth: {
          status: 'authenticated',
          subject,
          claims: { email: `${subject}@example.com` },
        },
      },
      outcome: 'denied',
      results: [{ policy: 'member.directory', verdict: 'deny' }],
    },
    {
      event: 'guard.request',
      recordId: crypto.randomUUID(),
      schema: 1,
      source: { app: 'guard', resource: 'directory', instance: 'g-1' },
      timestamp,
      durationMs: 3,
      outcome: 'rejected',
      action: 'directory.members.list',
      identity: { status: 'authenticated', subject },
      decisionId,
      rejection: 'forbidden',
      method: 'GET',
      path: '/members',
    },
  ].map((line) => JSON.stringify(line)).join('\n')
}

async function withAuditServer(
  test: (base: string, client: Horizon.Client) => Promise<void>,
  maxConcurrentBatches = 4,
) {
  const store = Audit.Stores.Sqlite.open(new DatabaseSync(':memory:'))
  const resolvers = new Horizon.Resolvers()
  new Queries(store).serve(resolvers)
  const transport = new HttpTransport()
  new Horizon.Server(resolvers, new Horizon.Handlers()).Use(transport)
  const server = new Server(
    new Intake(
      new Audit.Ingestion(store, new Audit.Redaction()),
      'shipper-token',
      maxConcurrentBatches,
    ),
    transport,
  )
  const http = Deno.serve(
    { port: 0, onListen: () => {} },
    (request) => server.handle(request),
  )
  const base = `http://localhost:${http.addr.port}`
  try {
    await test(
      base,
      new Horizon.Client(new HttpCourier(base), { timeout: 2000 }),
    )
  } finally {
    await http.shutdown()
  }
}

const post = (base: string, body: string, token = 'shipper-token') =>
  fetch(`${base}/records`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body,
  })

Deno.test("audit server: takes records from a shipper, and answers the console's queries over horizon", async () => {
  await withAuditServer(async (base, client) => {
    const response = await post(
      base,
      [deniedRequest(0, 'u-1'), deniedRequest(1, 'u-2')].join('\n'),
    )
    assertEquals(response.status, 200)
    assertEquals(await response.json(), {
      accepted: 4,
      duplicates: 0,
      ignored: 0,
      refused: [],
    })

    const until = new Date(T0.getTime() + 60 * 60_000)
    const overview = await client.Ask(
      new Contract.Audit.Overview(T0, until, 'directory'),
    )
    assertEquals(overview.totals, { forwarded: 0, rejected: 2, failed: 0 })
    assertEquals(overview.denyingPolicies, [{
      name: 'member.directory',
      count: 2,
    }])

    const page = await client.Ask(
      new Contract.Audit.Trails(T0, until, { subject: 'u-2' }),
    )
    assertEquals(page.trails.length, 1)
    const [trail] = page.trails
    assertEquals(trail.request.path, '/members')
    assertEquals(trail.decision?.results, [{
      policy: 'member.directory',
      verdict: 'deny',
    }])
    assertEquals(
      (trail.decision?.context.auth as { claims: { email: string } }).claims
        .email,
      '••••••',
    )
    assertEquals(
      (await client.Ask(new Contract.Audit.Trail(trail.request.recordId)))
        ?.request.recordId,
      trail.request.recordId,
    )
    assertEquals(await client.Ask(new Contract.Audit.Trail('gone')), null)
  })
})

Deno.test('audit server: refuses a shipper without the token, a window that ends before it starts, and tells a busy shipper to back off', async () => {
  await withAuditServer(async (base, client) => {
    const refused = await post(base, deniedRequest(0, 'u-1'), 'wrong')
    assertEquals(refused.status, 401)
    await refused.body?.cancel()

    const outcome = await client.Attempt(new Contract.Audit.Overview(T0, T0))
    assertEquals(
      !outcome.ok && outcome.fault instanceof Contract.Rejected && outcome.fault.Reason,
      'invalid_query',
    )
  })
  await withAuditServer(async (base) => {
    const busy = await post(base, deniedRequest(0, 'u-1'))
    assertEquals(busy.status, 503)
    assertEquals(busy.headers.get('retry-after'), '2')
    await busy.body?.cancel()
  }, 0)
})

Deno.test('Tail: hands on whole lines as they are appended, holding back a line not yet finished', async () => {
  const path = await Deno.makeTempFile()
  const tail = new Tail(path, 1000)
  const batches: string[] = []
  tail.OnLines.Do((lines) => batches.push(lines))

  await Deno.writeTextFile(path, 'one\ntwo\nthr')
  await tail.read()
  await Deno.writeTextFile(path, 'ee\n', { append: true })
  await tail.read()
  await tail.read()
  // Replaced by a shorter file: read again from its start.
  await Deno.writeTextFile(path, 'new\n')
  await tail.read()

  assertEquals(batches, ['one\ntwo', 'three', 'new'])
})

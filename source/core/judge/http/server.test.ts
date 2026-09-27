import { assertEquals, assertRejects } from '@std/assert'
import type * as Access from '@idhn/access'
import { Decision } from '../decision.ts'
import type { Behavior } from '../behavior.ts'
import { Server } from './server.ts'
import { Deadline } from '../deadline.ts'
import { UnavailableError } from '../unavailable-error.ts'

class FakeJudge implements Behavior {
  received: Array<{ action: Access.Action; context: Access.Context }> = []

  constructor(private readonly decision: Decision) {}

  decide(action: Access.Action, context: Access.Context): Promise<Decision> {
    this.received.push({ action, context })
    return Promise.resolve(this.decision)
  }
}

Deno.test('Server.handle: decides the request and responds with {allowed}', async () => {
  const judge = new FakeJudge(new Decision(true, [], 'd-1'))
  const handler = (request: Request) => new Server(judge).handle(request)

  const response = await handler(
    new Request('http://judge.test/decide', {
      method: 'POST',
      body: JSON.stringify({
        action: 'demo.home.visit',
        context: { vip: 'true' },
      }),
    }),
  )

  assertEquals(response.status, 200)
  assertEquals(await response.json(), { allowed: true, decisionId: 'd-1' })
  assertEquals(judge.received.length, 1)
  assertEquals(judge.received[0].action.name, 'demo.home.visit')
  assertEquals(judge.received[0].context.facts, { vip: 'true' })
})

Deno.test('Server.handle: responds 404 for any other path or method', async () => {
  const handler = (request: Request) =>
    new Server(new FakeJudge(new Decision(true))).handle(request)

  const wrongPath = await handler(
    new Request('http://judge.test/other', { method: 'POST', body: '{}' }),
  )
  const wrongMethod = await handler(new Request('http://judge.test/decide'))

  assertEquals(wrongPath.status, 404)
  assertEquals(wrongMethod.status, 404)
})

Deno.test('Server.handle: responds 400 on malformed JSON', async () => {
  const handler = (request: Request) =>
    new Server(new FakeJudge(new Decision(true))).handle(request)

  const response = await handler(
    new Request('http://judge.test/decide', {
      method: 'POST',
      body: 'not json',
    }),
  )

  assertEquals(response.status, 400)
})

Deno.test('Server.handle: responds 400 when action or context is missing', async () => {
  const handler = (request: Request) =>
    new Server(new FakeJudge(new Decision(true))).handle(request)

  const response = await handler(
    new Request('http://judge.test/decide', {
      method: 'POST',
      body: JSON.stringify({ action: 'demo.home.visit' }),
    }),
  )

  assertEquals(response.status, 400)
})

class FailingJudge implements Behavior {
  constructor(private readonly error: Error) {}

  decide(): Promise<Decision> {
    return Promise.reject(this.error)
  }
}

function decideRequest(): Request {
  return new Request('http://judge.test/decide', {
    method: 'POST',
    body: JSON.stringify({ action: 'demo.home.visit', context: {} }),
  })
}

Deno.test('Server.handle: answers a temporarily unavailable judgement 503 with Retry-After and the failed decision id', async () => {
  const server = new Server(
    new FailingJudge(
      new UnavailableError('directory is down', { decisionId: 'd-9' }),
    ),
  )

  const response = await server.handle(decideRequest())

  assertEquals(response.status, 503)
  assertEquals(response.headers.get('retry-after'), '5')
  assertEquals(await response.json(), { decisionId: 'd-9' })
})

Deno.test('Server.handle: lets any other failure propagate, for the process to answer as a fault', async () => {
  const server = new Server(new FailingJudge(new Error('entrypoint missing')))

  await assertRejects(
    () => server.handle(decideRequest()),
    Error,
    'entrypoint missing',
  )
})

class DeadlineCapturingJudge implements Behavior {
  received: Deadline | undefined

  decide(
    _action: Access.Action,
    _context: Access.Context,
    deadline: Deadline,
  ): Promise<Decision> {
    this.received = deadline
    return Promise.resolve(new Decision(true))
  }
}

function decideRequestWith(headers: Record<string, string>): Request {
  return new Request('http://judge.test/decide', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'demo.home.visit', context: {} }),
  })
}

Deno.test("Server.handle: judges within the caller's remaining wait, less the time the answer needs to travel back", async () => {
  const judge = new DeadlineCapturingJudge()

  await new Server(judge).handle(decideRequestWith({ 'x-deadline-ms': '2000' }))

  assertEquals(judge.received?.ms, 1900)
})

Deno.test('Server.handle: leaves the deadline to the judge when the caller says nothing about how long it will wait', async () => {
  const cases: Record<string, string>[] = [{}, { 'x-deadline-ms': 'soon' }]
  for (const headers of cases) {
    const judge = new DeadlineCapturingJudge()

    await new Server(judge).handle(decideRequestWith(headers))

    assertEquals(judge.received?.ms, Number.POSITIVE_INFINITY)
  }
})

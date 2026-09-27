import { assertEquals } from '@std/assert'
import type * as Access from '@idhn/access'
import { Decision } from '../decision.ts'
import type { Behavior } from '../behavior.ts'
import { Server } from './server.ts'

class FakeJudge implements Behavior {
  received: Array<{ action: Access.Action; context: Access.Context }> = []

  constructor(private readonly decision: Decision) {}

  decide(action: Access.Action, context: Access.Context): Promise<Decision> {
    this.received.push({ action, context })
    return Promise.resolve(this.decision)
  }
}

Deno.test('Server.handle: decides the request and responds with {allowed}', async () => {
  const judge = new FakeJudge(new Decision(true))
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
  assertEquals(await response.json(), { allowed: true })
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

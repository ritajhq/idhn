import { assertEquals } from '@std/assert'
import type { Action } from '../action.ts'
import type { Context } from '../context.ts'
import { Decision } from '../decision.ts'
import type { Judge } from '../judge.ts'
import { buildJudgeHandler } from './build-judge-handler.ts'

class FakeJudge implements Judge {
  received: Array<{ action: Action; context: Context }> = []

  constructor(private readonly decision: Decision) {}

  decide(action: Action, context: Context): Promise<Decision> {
    this.received.push({ action, context })
    return Promise.resolve(this.decision)
  }
}

Deno.test('buildJudgeHandler: decides the request and responds with {allowed}', async () => {
  const judge = new FakeJudge(new Decision(true))
  const handler = buildJudgeHandler(judge)

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

Deno.test('buildJudgeHandler: responds 404 for any other path or method', async () => {
  const handler = buildJudgeHandler(new FakeJudge(new Decision(true)))

  const wrongPath = await handler(
    new Request('http://judge.test/other', { method: 'POST', body: '{}' }),
  )
  const wrongMethod = await handler(new Request('http://judge.test/decide'))

  assertEquals(wrongPath.status, 404)
  assertEquals(wrongMethod.status, 404)
})

Deno.test('buildJudgeHandler: responds 400 on malformed JSON', async () => {
  const handler = buildJudgeHandler(new FakeJudge(new Decision(true)))

  const response = await handler(
    new Request('http://judge.test/decide', {
      method: 'POST',
      body: 'not json',
    }),
  )

  assertEquals(response.status, 400)
})

Deno.test('buildJudgeHandler: responds 400 when action or context is missing', async () => {
  const handler = buildJudgeHandler(new FakeJudge(new Decision(true)))

  const response = await handler(
    new Request('http://judge.test/decide', {
      method: 'POST',
      body: JSON.stringify({ action: 'demo.home.visit' }),
    }),
  )

  assertEquals(response.status, 400)
})

import { assertEquals, assertRejects } from '@std/assert'
import { Action } from '../action.ts'
import { Context } from '../context.ts'
import { JudgeHttpClient, JudgeRequestError } from './judge-http-client.ts'

async function withServer(
  handler: (request: Request) => Response | Promise<Response>,
  run: (server: URL) => Promise<void>,
): Promise<void> {
  const controller = new AbortController()
  const server = Deno.serve(
    { port: 0, signal: controller.signal, onListen: () => {} },
    handler,
  )
  const addr = server.addr as Deno.NetAddr
  try {
    await run(new URL(`http://localhost:${addr.port}/`))
  } finally {
    controller.abort()
    await server.finished
  }
}

Deno.test('JudgeHttpClient.decide: posts the action and context, and resolves with the decoded decision', async () => {
  await withServer(
    async (request) => {
      assertEquals(new URL(request.url).pathname, '/decide')
      assertEquals(request.method, 'POST')
      assertEquals(await request.json(), {
        action: 'demo.home.visit',
        context: { vip: 'true' },
      })
      return Response.json({ allowed: true })
    },
    async (server) => {
      const client = new JudgeHttpClient(server)

      const decision = await client.decide(
        new Action('demo.home.visit'),
        new Context({ vip: 'true' }),
      )

      assertEquals(decision.allowed, true)
    },
  )
})

Deno.test('JudgeHttpClient.decide: throws JudgeRequestError when the server responds with a non-ok status', async () => {
  await withServer(
    () => new Response('boom', { status: 500 }),
    async (server) => {
      const client = new JudgeHttpClient(server)

      await assertRejects(
        () => client.decide(new Action('demo.home.visit'), new Context()),
        JudgeRequestError,
      )
    },
  )
})

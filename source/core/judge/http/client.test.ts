import { assertEquals, assertRejects } from '@std/assert'
import * as Access from '@idhn/access'
import { Client, RequestError } from './client.ts'

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

Deno.test('Client.decide: posts the action and context, and resolves with the decoded decision', async () => {
  await withServer(
    async (request) => {
      assertEquals(new URL(request.url).pathname, '/decide')
      assertEquals(request.method, 'POST')
      assertEquals(await request.json(), {
        action: 'demo.home.visit',
        context: { vip: 'true' },
      })
      return Response.json({ allowed: true, decisionId: 'd-1' })
    },
    async (server) => {
      const client = new Client(server)

      const decision = await client.decide(
        new Access.Action('demo.home.visit'),
        new Access.Context({ vip: 'true' }),
      )

      assertEquals(decision.allowed, true)
      assertEquals(decision.id, 'd-1')
    },
  )
})

Deno.test('Client.decide: throws RequestError when the server responds with a non-ok status', async () => {
  await withServer(
    () => new Response('boom', { status: 500 }),
    async (server) => {
      const client = new Client(server)

      await assertRejects(
        () =>
          client.decide(
            new Access.Action('demo.home.visit'),
            new Access.Context(),
          ),
        RequestError,
      )
    },
  )
})

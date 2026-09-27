import { assertEquals, assertRejects } from '@std/assert'
import * as Access from '@idhn/access'
import { Client, RequestError } from './client.ts'
import { Deadline } from '../deadline.ts'
import { UnavailableError } from '../unavailable-error.ts'

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
        Deadline.in(2000),
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
            Deadline.in(2000),
          ),
        RequestError,
      )
    },
  )
})

Deno.test('Client.decide: throws UnavailableError naming the failed decision when the server answers 503', async () => {
  await withServer(
    () =>
      Response.json({ decisionId: 'd-9' }, {
        status: 503,
        headers: { 'retry-after': '5' },
      }),
    async (server) => {
      const error = await assertRejects(
        () =>
          new Client(server).decide(
            new Access.Action('demo.home.visit'),
            new Access.Context(),
            Deadline.in(2000),
          ),
        UnavailableError,
      )

      assertEquals(error.decisionId, 'd-9')
    },
  )
})

Deno.test('Client.decide: throws UnavailableError when the server cannot be reached', async () => {
  await assertRejects(
    () =>
      new Client(new URL('http://localhost:1/')).decide(
        new Access.Action('demo.home.visit'),
        new Access.Context(),
        Deadline.in(2000),
      ),
    UnavailableError,
    'could not be reached',
  )
})

Deno.test('Client.decide: throws UnavailableError when the server does not answer within the timeout', async () => {
  await withServer(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
      return Response.json({ allowed: true })
    },
    async (server) => {
      await assertRejects(
        () =>
          new Client(server).decide(
            new Access.Action('demo.home.visit'),
            new Access.Context(),
            Deadline.in(50),
          ),
        UnavailableError,
        'within 50ms',
      )
    },
  )
})

Deno.test('Client.decide: tells the server how long it will still wait', async () => {
  let sent: number | undefined
  await withServer(
    (request) => {
      sent = Number(request.headers.get('x-deadline-ms'))
      return Response.json({ allowed: true })
    },
    async (server) => {
      await new Client(server).decide(
        new Access.Action('demo.home.visit'),
        new Access.Context(),
        Deadline.in(2000),
      )
    },
  )

  assertEquals(
    sent !== undefined && sent > 1900 && sent <= 2000,
    true,
    `sent ${sent}`,
  )
})

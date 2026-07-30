import { assertEquals } from '@std/assert'
import { HttpServiceProvider } from './http-service-provider.ts'

async function withUpstream(
  handler: (request: Request) => Response | Promise<Response>,
  run: (upstream: URL) => Promise<void>,
): Promise<void> {
  const controller = new AbortController()
  const server = Deno.serve({
    port: 0,
    signal: controller.signal,
    onListen: () => {},
  }, handler)
  const addr = server.addr as Deno.NetAddr
  try {
    await run(new URL(`http://localhost:${addr.port}/`))
  } finally {
    controller.abort()
    await server.finished
  }
}

Deno.test('HttpServiceProvider.forward: proxies the request to the upstream and resolves with its response', async () => {
  await withUpstream(
    (request) => {
      assertEquals(request.method, 'POST')
      assertEquals(new URL(request.url).pathname, '/invoices/42/approve')
      assertEquals(request.headers.get('x-user-id'), 'alice')
      return new Response('approved', { status: 200 })
    },
    async (upstream) => {
      const { promise, resolve } = Promise.withResolvers<Response>()
      const request = new Request('https://gateway.test/invoices/42/approve', {
        method: 'POST',
        headers: { 'x-user-id': 'alice' },
      })
      const provider = new HttpServiceProvider(request, upstream, resolve)

      await provider.forward()
      const response = await promise

      assertEquals(response.status, 200)
      assertEquals(await response.text(), 'approved')
    },
  )
})

Deno.test('HttpServiceProvider.forward: relays the upstream body', async () => {
  await withUpstream(
    async (request) => new Response(await request.text(), { status: 201 }),
    async (upstream) => {
      const { promise, resolve } = Promise.withResolvers<Response>()
      const request = new Request('https://gateway.test/invoices', {
        method: 'POST',
        body: JSON.stringify({ amount: 500 }),
      })
      const provider = new HttpServiceProvider(request, upstream, resolve)

      await provider.forward()
      const response = await promise

      assertEquals(response.status, 201)
      assertEquals(await response.text(), '{"amount":500}')
    },
  )
})

Deno.test('HttpServiceProvider.forward: does not follow upstream redirects', async () => {
  await withUpstream(
    () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://example.test/elsewhere' },
      }),
    async (upstream) => {
      const { promise, resolve } = Promise.withResolvers<Response>()
      const request = new Request('https://gateway.test/a', { method: 'GET' })
      const provider = new HttpServiceProvider(request, upstream, resolve)

      await provider.forward()
      const response = await promise

      assertEquals(response.status, 302)
      assertEquals(
        response.headers.get('location'),
        'https://example.test/elsewhere',
      )
    },
  )
})

Deno.test('HttpServiceProvider.reject: resolves with a 403, without contacting any upstream', async () => {
  const { promise, resolve } = Promise.withResolvers<Response>()
  const request = new Request('https://gateway.test/a', { method: 'GET' })
  const provider = new HttpServiceProvider(
    request,
    new URL('http://localhost:1/'),
    resolve,
  )

  await provider.reject()
  const response = await promise

  assertEquals(response.status, 403)
})

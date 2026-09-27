import { assertEquals, assertRejects } from '@std/assert'
import { HttpServiceProvider } from './http-service-provider.ts'
import { Rejection } from '../rejection.ts'
import { ServiceUnreachableError } from '../service-provider.ts'
import { Bare, Served } from './reject-responses/index.ts'

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
      const provider = new HttpServiceProvider(
        request,
        upstream,
        resolve,
        new Bare(),
      )

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
      const provider = new HttpServiceProvider(
        request,
        upstream,
        resolve,
        new Bare(),
      )

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
      const provider = new HttpServiceProvider(
        request,
        upstream,
        resolve,
        new Bare(),
      )

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

Deno.test('HttpServiceProvider.reject: resolves with a bare 403 when given a bare reject response', async () => {
  const { promise, resolve } = Promise.withResolvers<Response>()
  const request = new Request('https://gateway.test/a', { method: 'GET' })
  const provider = new HttpServiceProvider(
    request,
    new URL('http://localhost:1/'),
    resolve,
    new Bare(),
  )

  await provider.reject(Rejection.Forbidden)
  const response = await promise

  assertEquals(response.status, 403)
  assertEquals(await response.text(), '')
})

Deno.test('HttpServiceProvider.reject: serves the configured reject response body and content-type', async () => {
  const { promise, resolve } = Promise.withResolvers<Response>()
  const request = new Request('https://gateway.test/a', { method: 'GET' })
  const rejectResponse = new Served(
    new TextEncoder().encode('<h1>Forbidden</h1>'),
    'text/html; charset=utf-8',
  )
  const provider = new HttpServiceProvider(
    request,
    new URL('http://localhost:1/'),
    resolve,
    rejectResponse,
  )

  await provider.reject(Rejection.Forbidden)
  const response = await promise

  assertEquals(response.status, 403)
  assertEquals(response.headers.get('content-type'), 'text/html; charset=utf-8')
  assertEquals(await response.text(), '<h1>Forbidden</h1>')
})

Deno.test('HttpServiceProvider.reject: answers 401 for an unauthenticated caller and 503 when the identity could not be checked', async () => {
  const statuses: number[] = []
  for (const rejection of [Rejection.Unauthenticated, Rejection.Unavailable]) {
    const { promise, resolve } = Promise.withResolvers<Response>()
    const provider = new HttpServiceProvider(
      new Request('https://gateway.test/a', { method: 'GET' }),
      new URL('http://localhost:1/'),
      resolve,
      new Bare(),
    )

    await provider.reject(rejection)
    statuses.push((await promise).status)
  }

  assertEquals(statuses, [401, 503])
})

async function rejected(
  rejection: Rejection,
  rejectResponse = new Bare(),
): Promise<Response> {
  const { promise, resolve } = Promise.withResolvers<Response>()
  const provider = new HttpServiceProvider(
    new Request('https://gateway.test/a', { method: 'GET' }),
    new URL('http://localhost:1/'),
    resolve,
    rejectResponse,
  )
  await provider.reject(rejection)
  return await promise
}

Deno.test('HttpServiceProvider.reject: tells an unavailable rejection when to retry, and no other', async () => {
  const unavailable = await rejected(Rejection.Unavailable)
  const forbidden = await rejected(Rejection.Forbidden)
  const unauthenticated = await rejected(Rejection.Unauthenticated)

  assertEquals(unavailable.headers.get('retry-after'), '5')
  assertEquals(forbidden.headers.get('retry-after'), null)
  assertEquals(unauthenticated.headers.get('retry-after'), null)
})

Deno.test("HttpServiceProvider.reject: keeps a served page's content-type next to Retry-After", async () => {
  const response = await rejected(
    Rejection.Unavailable,
    new Served(new TextEncoder().encode('<p>later</p>'), 'text/html'),
  )

  assertEquals(response.status, 503)
  assertEquals(response.headers.get('retry-after'), '5')
  assertEquals(response.headers.get('content-type'), 'text/html')
})

Deno.test('HttpServiceProvider.forward: throws ServiceUnreachableError when the upstream cannot be reached', async () => {
  const { resolve } = Promise.withResolvers<Response>()
  const provider = new HttpServiceProvider(
    new Request('https://gateway.test/a', { method: 'GET' }),
    new URL('http://localhost:1/'),
    resolve,
    new Bare(),
  )

  await assertRejects(
    () => provider.forward(),
    ServiceUnreachableError,
    'could not be reached',
  )
})

Deno.test("HttpServiceProvider.forward: relays an upstream error response as the service's own answer", async () => {
  await withUpstream(
    () => new Response('broken', { status: 500 }),
    async (upstream) => {
      const { promise, resolve } = Promise.withResolvers<Response>()
      const provider = new HttpServiceProvider(
        new Request('https://gateway.test/a', { method: 'GET' }),
        upstream,
        resolve,
        new Bare(),
      )

      await provider.forward()
      const response = await promise

      assertEquals(response.status, 500)
      assertEquals(await response.text(), 'broken')
    },
  )
})

Deno.test('HttpServiceProvider.reject: answers an unreachable service 502, without Retry-After', async () => {
  const response = await rejected(Rejection.Unreachable)

  assertEquals(response.status, 502)
  assertEquals(response.headers.get('retry-after'), null)
})

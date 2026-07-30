import { assertEquals, assertRejects } from '@std/assert'
import { loadRejectResponse } from './load-reject-response.ts'

const fixturesDir = new URL('./tests/fixtures/', import.meta.url)

Deno.test('loadRejectResponse: loads a local HTML file, inferring content-type from its extension', async () => {
  const result = await loadRejectResponse(
    new URL('forbidden.html', fixturesDir),
  )

  assertEquals(new TextDecoder().decode(result.body), '<h1>Forbidden</h1>\n')
  assertEquals(result.contentType, 'text/html; charset=utf-8')
})

Deno.test('loadRejectResponse: loads over HTTP, using the server-supplied content-type', async () => {
  const controller = new AbortController()
  const server = Deno.serve(
    { port: 0, signal: controller.signal, onListen: () => {} },
    () =>
      new Response('<p>nope</p>', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
  )
  const addr = server.addr as Deno.NetAddr
  try {
    const result = await loadRejectResponse(`http://localhost:${addr.port}/`)

    assertEquals(new TextDecoder().decode(result.body), '<p>nope</p>')
    assertEquals(result.contentType, 'text/html; charset=utf-8')
  } finally {
    controller.abort()
    await server.finished
  }
})

Deno.test('loadRejectResponse: rejects when the response is not ok', async () => {
  const controller = new AbortController()
  const server = Deno.serve(
    { port: 0, signal: controller.signal, onListen: () => {} },
    () => new Response('not found', { status: 404 }),
  )
  const addr = server.addr as Deno.NetAddr
  try {
    await assertRejects(
      () => loadRejectResponse(`http://localhost:${addr.port}/`),
      Error,
      '404',
    )
  } finally {
    controller.abort()
    await server.finished
  }
})

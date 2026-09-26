import { assertEquals, assertRejects } from '@std/assert'
import { Source } from './source.ts'

const fixturesDir = new URL('./tests/fixtures/', import.meta.url)

Deno.test('Source.load: loads a local HTML file, inferring content-type from its extension', async () => {
  const rejectResponse = await new Source(
    new URL('forbidden.html', fixturesDir),
  )
    .load()

  const response = rejectResponse.toResponse(403)
  assertEquals(response.status, 403)
  assertEquals(response.headers.get('content-type'), 'text/html; charset=utf-8')
  assertEquals(await response.text(), '<h1>Forbidden</h1>\n')
})

Deno.test('Source.load: loads over HTTP, using the server-supplied content-type', async () => {
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
    const rejectResponse = await new Source(`http://localhost:${addr.port}/`)
      .load()

    const response = rejectResponse.toResponse(403)
    assertEquals(await response.text(), '<p>nope</p>')
    assertEquals(
      response.headers.get('content-type'),
      'text/html; charset=utf-8',
    )
  } finally {
    controller.abort()
    await server.finished
  }
})

Deno.test('Source.load: rejects when the response is not ok', async () => {
  const controller = new AbortController()
  const server = Deno.serve(
    { port: 0, signal: controller.signal, onListen: () => {} },
    () => new Response('not found', { status: 404 }),
  )
  const addr = server.addr as Deno.NetAddr
  try {
    await assertRejects(
      () => new Source(`http://localhost:${addr.port}/`).load(),
      Error,
      '404',
    )
  } finally {
    controller.abort()
    await server.finished
  }
})

Deno.test('Source.load: yields a bare 403 when no url is configured', async () => {
  const rejectResponse = await new Source(undefined).load()

  const response = rejectResponse.toResponse(403)
  assertEquals(response.status, 403)
  assertEquals(await response.text(), '')
})

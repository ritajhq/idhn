import { assertEquals, assertRejects } from '@std/assert'
import { PolicySet } from '../policy-set.ts'
import { Publication } from '../publication.ts'
import { Client, FetchError } from './client.ts'
import { Server } from './server.ts'

/** Serves `publication` on a free port for the duration of `test`. */
async function serving(
  publication: Publication,
  test: (url: URL) => Promise<void>,
): Promise<void> {
  const server = new Server(publication)
  const http = Deno.serve(
    { port: 0, onListen: () => {} },
    async (request) => (await server.handle(request)) ?? new Response(null, { status: 404 }),
  )
  try {
    await test(new URL(`http://localhost:${http.addr.port}`))
  } finally {
    await http.shutdown()
  }
}

const set = new PolicySet(
  'abc123',
  new Uint8Array([0, 97, 115, 109]),
  'associations:\n  shop.browse: [catalog.browse]\n',
  'lookups: []\n',
)

Deno.test('Client.fetch: gets the published set, intact', async () => {
  const publication = new Publication()
  publication.publish(set)

  await serving(publication, async (url) => {
    const fetched = await new Client(url).fetch()

    assertEquals(fetched?.set, set)
  })
})

Deno.test('Client.fetch: gets nothing while the set is unchanged, then the newer one', async () => {
  const publication = new Publication()
  publication.publish(set)

  await serving(publication, async (url) => {
    const client = new Client(url)
    await client.fetch()

    assertEquals(await client.fetch(), null)

    const newer = new PolicySet('def456', set.bundle, set.registry)
    publication.publish(newer)
    assertEquals((await client.fetch())?.set.version, 'def456')
  })
})

Deno.test('Client.fetch: fails while nothing is published yet', async () => {
  await serving(new Publication(), async (url) => {
    await assertRejects(() => new Client(url).fetch(), FetchError)
  })
})

Deno.test('Client.fetch: fails when the builder cannot be reached', async () => {
  await assertRejects(
    () => new Client(new URL('http://localhost:1'), 500).fetch(),
    FetchError,
  )
})

Deno.test('Server.handle: leaves any other request to the caller', async () => {
  const response = await new Server(new Publication()).handle(
    new Request('http://builder/health'),
  )

  assertEquals(response, null)
})

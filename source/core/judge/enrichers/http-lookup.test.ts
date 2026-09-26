import { assertEquals, assertRejects } from '@std/assert'
import * as Access from '@idhn/access'
import {
  HttpLookup,
  type HttpLookupDefinition,
  LookupError,
} from './http-lookup.ts'

const action = new Access.Action('billing.invoice_approve')

async function withServer(
  handler: (request: Request) => Response | Promise<Response>,
  run: (origin: string) => Promise<void>,
): Promise<void> {
  const controller = new AbortController()
  const server = Deno.serve(
    { port: 0, signal: controller.signal, onListen: () => {} },
    handler,
  )
  const addr = server.addr as Deno.NetAddr
  try {
    await run(`http://localhost:${addr.port}`)
  } finally {
    controller.abort()
    await server.finished
  }
}

function definition(
  origin: string,
  overrides: Partial<HttpLookupDefinition> = {},
): HttpLookupDefinition {
  return {
    as: 'directory',
    url: `${origin}/agents/{subject}`,
    ttlSeconds: 0,
    optional: false,
    ...overrides,
  }
}

Deno.test('HttpLookup.enrich: fetches the URL filled from request facts and adds the response as a fact', async () => {
  const paths: string[] = []
  await withServer(
    (request) => {
      paths.push(new URL(request.url).pathname)
      return Response.json({ active: true })
    },
    async (origin) => {
      const lookup = new HttpLookup(definition(origin))

      const enriched = await lookup.enrich(
        action,
        new Access.Context({ subject: 'a b/c' }),
      )

      assertEquals(enriched.facts, {
        subject: 'a b/c',
        directory: { active: true },
      })
      assertEquals(paths, ['/agents/a%20b%2Fc'])
    },
  )
})

Deno.test('HttpLookup.enrich: leaves the context alone for an action the lookup does not apply to', async () => {
  let hits = 0
  await withServer(
    () => {
      hits++
      return Response.json({})
    },
    async (origin) => {
      const lookup = new HttpLookup(
        definition(origin, { actions: ['billing.something_else'] }),
      )
      const context = new Access.Context({ subject: 'alice' })

      assertEquals(await lookup.enrich(action, context), context)
      assertEquals(hits, 0)
    },
  )
})

Deno.test('HttpLookup.enrich: reuses a response within its ttl and refetches after it expires', async () => {
  let hits = 0
  let now = 0
  await withServer(
    () => {
      hits++
      return Response.json({ n: hits })
    },
    async (origin) => {
      const lookup = new HttpLookup(
        definition(origin, { ttlSeconds: 60 }),
        () => now,
      )
      const context = new Access.Context({ subject: 'alice' })

      await lookup.enrich(action, context)
      now = 59_000
      await lookup.enrich(action, context)
      assertEquals(hits, 1)

      now = 61_000
      const refreshed = await lookup.enrich(action, context)
      assertEquals(hits, 2)
      assertEquals(refreshed.facts.directory, { n: 2 })
    },
  )
})

Deno.test('HttpLookup.enrich: throws LookupError on a non-ok response when not optional', async () => {
  await withServer(
    () => new Response('boom', { status: 500 }),
    async (origin) => {
      const lookup = new HttpLookup(definition(origin))

      await assertRejects(
        () => lookup.enrich(action, new Access.Context({ subject: 'alice' })),
        LookupError,
        '500',
      )
    },
  )
})

Deno.test('HttpLookup.enrich: throws LookupError when a placeholder fact is missing and not optional', async () => {
  const lookup = new HttpLookup(definition('http://localhost:1'))

  await assertRejects(
    () => lookup.enrich(action, new Access.Context()),
    LookupError,
    'subject',
  )
})

Deno.test('HttpLookup.enrich: omits the fact instead of failing when optional', async () => {
  await withServer(
    () => new Response('boom', { status: 500 }),
    async (origin) => {
      const lookup = new HttpLookup(definition(origin, { optional: true }))
      const context = new Access.Context({ subject: 'alice' })

      assertEquals(await lookup.enrich(action, context), context)
    },
  )
})

Deno.test('HttpLookup.enrich: does not cache a failed response', async () => {
  let hits = 0
  await withServer(
    () => {
      hits++
      return hits === 1
        ? new Response('boom', { status: 500 })
        : Response.json({ active: true })
    },
    async (origin) => {
      const lookup = new HttpLookup(
        definition(origin, { ttlSeconds: 60, optional: true }),
      )
      const context = new Access.Context({ subject: 'alice' })

      await lookup.enrich(action, context)
      const second = await lookup.enrich(action, context)

      assertEquals(second.facts.directory, { active: true })
    },
  )
})

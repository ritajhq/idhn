import { assertEquals, assertRejects } from '@std/assert'
import * as Access from '@idhn/access'
import {
  HttpLookup,
  type HttpLookupDefinition,
  LookupError,
} from './http-lookup.ts'
import { UnavailableError } from '../unavailable-error.ts'

/** A deadline that never passes, for calls that aren't about deadlines. */
const noDeadline = new AbortController().signal

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
    timeoutMs: 2000,
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
        noDeadline,
      )

      assertEquals(enriched.facts, {
        subject: 'a b/c',
        directory: { active: true },
      })
      assertEquals(paths, ['/agents/a%20b%2Fc'])
    },
  )
})

Deno.test('HttpLookup.enrich: fills a dotted placeholder from a nested fact, such as the authenticated subject', async () => {
  const paths: string[] = []
  await withServer(
    (request) => {
      paths.push(new URL(request.url).pathname)
      return Response.json({ places: ['p-1'] })
    },
    async (origin) => {
      const lookup = new HttpLookup(
        definition(origin, {
          as: 'managed',
          url: `${origin}/managers/{auth.subject}/places`,
        }),
      )

      const enriched = await lookup.enrich(
        action,
        new Access.Context({
          auth: { status: 'authenticated', subject: 'u-1', claims: {} },
        }),
        noDeadline,
      )

      assertEquals(enriched.facts.managed, { places: ['p-1'] })
      assertEquals(paths, ['/managers/u-1/places'])
    },
  )
})

Deno.test('HttpLookup.enrich: throws LookupError when a dotted placeholder has no value, as for an anonymous identity', async () => {
  const lookup = new HttpLookup(
    definition('http://localhost:1', {
      url: 'http://x.internal/{auth.subject}',
    }),
  )

  await assertRejects(
    () =>
      lookup.enrich(
        action,
        new Access.Context({ auth: { status: 'anonymous', claims: {} } }),
        noDeadline,
      ),
    LookupError,
    'auth.subject',
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

      assertEquals(await lookup.enrich(action, context, noDeadline), context)
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

      await lookup.enrich(action, context, noDeadline)
      now = 59_000
      await lookup.enrich(action, context, noDeadline)
      assertEquals(hits, 1)

      now = 61_000
      const refreshed = await lookup.enrich(action, context, noDeadline)
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
        () =>
          lookup.enrich(
            action,
            new Access.Context({ subject: 'alice' }),
            noDeadline,
          ),
        LookupError,
        '500',
      )
    },
  )
})

Deno.test('HttpLookup.enrich: throws LookupError when a placeholder fact is missing and not optional', async () => {
  const lookup = new HttpLookup(definition('http://localhost:1'))

  await assertRejects(
    () => lookup.enrich(action, new Access.Context(), noDeadline),
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

      assertEquals(await lookup.enrich(action, context, noDeadline), context)
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

      await lookup.enrich(action, context, noDeadline)
      const second = await lookup.enrich(action, context, noDeadline)

      assertEquals(second.facts.directory, { active: true })
    },
  )
})

Deno.test('HttpLookup.enrich: throws UnavailableError when the service answers that it is temporarily unavailable', async () => {
  for (const status of [429, 502, 503, 504]) {
    await withServer(
      () => new Response('later', { status }),
      async (origin) => {
        const lookup = new HttpLookup(definition(origin))

        await assertRejects(
          () =>
            lookup.enrich(
              action,
              new Access.Context({ subject: 'alice' }),
              noDeadline,
            ),
          UnavailableError,
          String(status),
        )
      },
    )
  }
})

Deno.test('HttpLookup.enrich: throws UnavailableError when the service cannot be reached', async () => {
  const lookup = new HttpLookup(definition('http://localhost:1'))

  await assertRejects(
    () =>
      lookup.enrich(
        action,
        new Access.Context({ subject: 'alice' }),
        noDeadline,
      ),
    UnavailableError,
    'could not reach',
  )
})

Deno.test("HttpLookup.enrich: abandons the lookup when the judgement's deadline passes", async () => {
  await withServer(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
      return Response.json({ active: true })
    },
    async (origin) => {
      const lookup = new HttpLookup(definition(origin))

      await assertRejects(
        () =>
          lookup.enrich(
            action,
            new Access.Context({ subject: 'alice' }),
            AbortSignal.timeout(50),
          ),
        UnavailableError,
        "cut short by the judgement's deadline",
      )
    },
  )
})

Deno.test('HttpLookup.enrich: throws UnavailableError when the service does not answer within the timeout', async () => {
  await withServer(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
      return Response.json({ active: true })
    },
    async (origin) => {
      const lookup = new HttpLookup(definition(origin, { timeoutMs: 50 }))

      await assertRejects(
        () =>
          lookup.enrich(
            action,
            new Access.Context({ subject: 'alice' }),
            noDeadline,
          ),
        UnavailableError,
        'within 50ms',
      )
    },
  )
})

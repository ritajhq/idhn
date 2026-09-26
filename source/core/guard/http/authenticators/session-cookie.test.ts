import { assertEquals } from '@std/assert'
import type { SessionCookieAuthentication } from '../../manifest/http/schema.ts'
import * as Access from '@idhn/access'
import { Rejection } from '../../rejection.ts'
import { SessionCookie } from './session-cookie.ts'

const COOKIE = 'better-auth.session_token'

async function withAuthServer(
  handler: (request: Request) => Response | Promise<Response>,
  run: (sessionUrl: string) => Promise<void>,
): Promise<void> {
  const controller = new AbortController()
  const server = Deno.serve(
    { port: 0, signal: controller.signal, onListen: () => {} },
    handler,
  )
  const addr = server.addr as Deno.NetAddr
  try {
    await run(`http://localhost:${addr.port}/api/auth/get-session`)
  } finally {
    controller.abort()
    await server.finished
  }
}

function settings(
  sessionUrl: string,
  overrides: Partial<SessionCookieAuthentication> = {},
): SessionCookieAuthentication {
  return {
    scheme: 'session-cookie',
    sessionUrl,
    cookie: COOKIE,
    issuer: 'portal',
    claims: ['username', 'email', 'name', 'emailVerified'],
    ttlSeconds: 0,
    ...overrides,
  }
}

function requestWithCookie(cookie?: string): Request {
  return new Request('https://dashboard.test/places', {
    headers: cookie === undefined ? {} : { cookie },
  })
}

const aliceSession = {
  session: { id: 's-1', userId: 'u-1', expiresAt: '2099-01-01T00:00:00Z' },
  user: {
    id: 'u-1',
    username: 'alice',
    email: 'alice@example.test',
    name: 'Alice',
    emailVerified: true,
    image: null,
  },
}

Deno.test('SessionCookie: a request without the session cookie is anonymous and costs no lookup', async () => {
  let hits = 0
  await withAuthServer(
    () => {
      hits++
      return Response.json(aliceSession)
    },
    async (sessionUrl) => {
      const scheme = new SessionCookie(settings(sessionUrl))

      const none = await scheme.authenticatorFor(requestWithCookie())
        .authenticate()
      const unrelated = await scheme
        .authenticatorFor(requestWithCookie('theme=dark; lang=en'))
        .authenticate()
      const empty = await scheme
        .authenticatorFor(requestWithCookie(`${COOKIE}=`))
        .authenticate()

      assertEquals(none.status, 'anonymous')
      assertEquals(unrelated.status, 'anonymous')
      assertEquals(empty.status, 'anonymous')
      assertEquals(hits, 0)
    },
  )
})

Deno.test('SessionCookie: a valid session is authenticated as its user, forwarding only the session cookie', async () => {
  const forwarded: Array<string | null> = []
  await withAuthServer(
    (request) => {
      forwarded.push(request.headers.get('cookie'))
      return Response.json(aliceSession)
    },
    async (sessionUrl) => {
      const scheme = new SessionCookie(settings(sessionUrl))

      const identity = await scheme
        .authenticatorFor(requestWithCookie(`theme=dark; ${COOKIE}=abc.def`))
        .authenticate()

      assertEquals(identity.toFact(), {
        status: 'authenticated',
        subject: 'u-1',
        issuer: 'portal',
        claims: {
          username: 'alice',
          email: 'alice@example.test',
          name: 'Alice',
          emailVerified: true,
        },
      })
      assertEquals(forwarded, [`${COOKIE}=abc.def`])
    },
  )
})

Deno.test('SessionCookie: copies only the configured claims that the user has', async () => {
  await withAuthServer(
    () => Response.json({ ...aliceSession, user: { id: 'u-1', name: 'A' } }),
    async (sessionUrl) => {
      const scheme = new SessionCookie(
        settings(sessionUrl, { claims: ['name', 'username'] }),
      )

      const identity = await scheme
        .authenticatorFor(requestWithCookie(`${COOKIE}=abc`))
        .authenticate()

      assertEquals(identity.claims, { name: 'A' })
    },
  )
})

Deno.test('SessionCookie: a session cookie the auth server does not know is invalid', async () => {
  await withAuthServer(
    () => Response.json(null),
    async (sessionUrl) => {
      const scheme = new SessionCookie(settings(sessionUrl))

      const identity = await scheme
        .authenticatorFor(requestWithCookie(`${COOKIE}=expired`))
        .authenticate()

      assertEquals(identity.toFact(), { status: 'invalid', claims: {} })
    },
  )
})

Deno.test('SessionCookie: reports the identity as unavailable when the auth server answers with an error', async () => {
  await withAuthServer(
    () => new Response('boom', { status: 500 }),
    async (sessionUrl) => {
      const scheme = new SessionCookie(settings(sessionUrl))

      const identity = await scheme
        .authenticatorFor(requestWithCookie(`${COOKIE}=abc`))
        .authenticate()

      assertEquals(identity.toFact(), { status: 'unavailable', claims: {} })
    },
  )
})

Deno.test('SessionCookie: reports the identity as unavailable when the auth server answers with something that is not a session', async () => {
  await withAuthServer(
    () => Response.json({ user: { name: 'no id' } }),
    async (sessionUrl) => {
      const scheme = new SessionCookie(settings(sessionUrl))

      const identity = await scheme
        .authenticatorFor(requestWithCookie(`${COOKIE}=abc`))
        .authenticate()

      assertEquals(identity.status, 'unavailable')
    },
  )
})

Deno.test('SessionCookie: reports the identity as unavailable when the auth server cannot be reached', async () => {
  const scheme = new SessionCookie(
    settings('http://localhost:1/api/auth/get-session'),
  )

  const identity = await scheme
    .authenticatorFor(requestWithCookie(`${COOKIE}=abc`))
    .authenticate()

  assertEquals(identity.status, 'unavailable')
})

Deno.test('SessionCookie: reuses an answer for the same cookie within its ttl and asks again after it expires', async () => {
  let hits = 0
  let now = 0
  await withAuthServer(
    () => {
      hits++
      return Response.json(hits === 1 ? aliceSession : null)
    },
    async (sessionUrl) => {
      const scheme = new SessionCookie(
        settings(sessionUrl, { ttlSeconds: 5 }),
        () => now,
      )
      const authenticate = () =>
        scheme.authenticatorFor(requestWithCookie(`${COOKIE}=abc`))
          .authenticate()

      await authenticate()
      now = 4_000
      const cached = await authenticate()
      assertEquals(hits, 1)
      assertEquals(cached.status, 'authenticated')

      now = 6_000
      const revoked = await authenticate()
      assertEquals(hits, 2)
      assertEquals(revoked.status, 'invalid')
    },
  )
})

Deno.test('SessionCookie: caches each cookie separately', async () => {
  const seen: Array<string | null> = []
  await withAuthServer(
    (request) => {
      seen.push(request.headers.get('cookie'))
      return Response.json(aliceSession)
    },
    async (sessionUrl) => {
      const scheme = new SessionCookie(settings(sessionUrl, { ttlSeconds: 60 }))

      await scheme.authenticatorFor(requestWithCookie(`${COOKIE}=one`))
        .authenticate()
      await scheme.authenticatorFor(requestWithCookie(`${COOKIE}=two`))
        .authenticate()

      assertEquals(seen, [`${COOKIE}=one`, `${COOKIE}=two`])
    },
  )
})

Deno.test('SessionCookie: does not cache an unavailable identity', async () => {
  let hits = 0
  await withAuthServer(
    () => {
      hits++
      return hits === 1
        ? new Response('boom', { status: 503 })
        : Response.json(aliceSession)
    },
    async (sessionUrl) => {
      const scheme = new SessionCookie(settings(sessionUrl, { ttlSeconds: 60 }))
      const authenticate = () =>
        scheme.authenticatorFor(requestWithCookie(`${COOKIE}=abc`))
          .authenticate()

      const during = await authenticate()
      const identity = await authenticate()

      assertEquals(during.status, 'unavailable')

      assertEquals(identity.status, 'authenticated')
    },
  )
})

Deno.test('SessionCookie: challenges a denied caller without a valid session, and forbids an authenticated one', async () => {
  const authenticator = new SessionCookie(
    settings('http://localhost:1/api/auth/get-session'),
  ).authenticatorFor(requestWithCookie())

  assertEquals(
    [
      Access.Identity.authenticated('u-1', 'portal'),
      Access.Identity.anonymous(),
      Access.Identity.invalid(),
      Access.Identity.unavailable(),
    ].map((identity) => authenticator.rejectionFor(identity)),
    [
      Rejection.Forbidden,
      Rejection.Unauthenticated,
      Rejection.Unauthenticated,
      Rejection.Unavailable,
    ],
  )
})

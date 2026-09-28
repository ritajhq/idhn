import { assertEquals } from '@std/assert'
import type { SessionBearerAuthentication } from '../../manifest/http/schema.ts'
import * as Access from '@idhn/access'
import { Rejection } from '../../rejection.ts'
import { SessionBearer } from './session-bearer.ts'
import { aliceSession, withAuthServer } from './tests/auth-server.ts'

function settings(
  sessionUrl: string,
  overrides: Partial<SessionBearerAuthentication> = {},
): SessionBearerAuthentication {
  return {
    scheme: 'session-bearer',
    sessionUrl,
    issuer: 'portal',
    claims: ['username', 'email', 'name', 'emailVerified'],
    ttlSeconds: 0,
    timeoutMs: 2000,
    ...overrides,
  }
}

function requestWith(headers: Record<string, string> = {}): Request {
  return new Request('https://console.test/api/instances', { headers })
}

function bearer(token: string): Request {
  return requestWith({ authorization: `Bearer ${token}` })
}

Deno.test('SessionBearer: a request without a bearer token is anonymous and costs no lookup', async () => {
  let hits = 0
  await withAuthServer(
    () => {
      hits++
      return Response.json(aliceSession)
    },
    async (sessionUrl) => {
      const scheme = new SessionBearer(settings(sessionUrl))

      const identities = await Promise.all(
        [
          requestWith(),
          requestWith({ authorization: 'Basic YWxpY2U6c2VjcmV0' }),
          requestWith({ authorization: 'Bearer' }),
          requestWith({ authorization: 'Bearer ' }),
          requestWith({ authorization: 'Bearer two tokens' }),
          requestWith({ cookie: 'better-auth.session_token=abc.def' }),
        ].map((request) => scheme.authenticatorFor(request).authenticate()),
      )

      assertEquals(
        identities.map((identity) => identity.status),
        Array(6).fill('anonymous'),
      )
      assertEquals(hits, 0)
    },
  )
})

Deno.test('SessionBearer: a valid session is authenticated as its user, forwarding only the bearer header', async () => {
  const forwarded: Array<[string | null, string | null]> = []
  await withAuthServer(
    (request) => {
      forwarded.push([
        request.headers.get('authorization'),
        request.headers.get('cookie'),
      ])
      return Response.json(aliceSession)
    },
    async (sessionUrl) => {
      const scheme = new SessionBearer(settings(sessionUrl))

      const identity = await scheme
        .authenticatorFor(
          requestWith({
            authorization: 'Bearer raw-session-token',
            cookie: 'theme=dark',
          }),
        )
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
      assertEquals(forwarded, [['Bearer raw-session-token', null]])
    },
  )
})

Deno.test('SessionBearer: reads the auth scheme case-insensitively', async () => {
  const forwarded: Array<string | null> = []
  await withAuthServer(
    (request) => {
      forwarded.push(request.headers.get('authorization'))
      return Response.json(aliceSession)
    },
    async (sessionUrl) => {
      const scheme = new SessionBearer(settings(sessionUrl))

      const identity = await scheme
        .authenticatorFor(requestWith({ authorization: 'bearer abc.def' }))
        .authenticate()

      assertEquals(identity.status, 'authenticated')
      assertEquals(forwarded, ['Bearer abc.def'])
    },
  )
})

Deno.test('SessionBearer: copies only the configured claims that the user has', async () => {
  await withAuthServer(
    () => Response.json({ ...aliceSession, user: { id: 'u-1', name: 'A' } }),
    async (sessionUrl) => {
      const scheme = new SessionBearer(
        settings(sessionUrl, { claims: ['name', 'username'] }),
      )

      const identity = await scheme.authenticatorFor(bearer('abc'))
        .authenticate()

      assertEquals(identity.claims, { name: 'A' })
    },
  )
})

Deno.test('SessionBearer: a token the auth server does not know is invalid', async () => {
  await withAuthServer(
    () => Response.json(null),
    async (sessionUrl) => {
      const scheme = new SessionBearer(settings(sessionUrl))

      const identity = await scheme.authenticatorFor(bearer('expired'))
        .authenticate()

      assertEquals(identity.toFact(), { status: 'invalid', claims: {} })
    },
  )
})

Deno.test('SessionBearer: reports the identity as unavailable when the auth server answers with an error or not a session', async () => {
  const answers = [
    () => new Response('boom', { status: 500 }),
    () => Response.json({ user: { name: 'no id' } }),
  ]
  for (const answer of answers) {
    await withAuthServer(answer, async (sessionUrl) => {
      const scheme = new SessionBearer(settings(sessionUrl))

      const identity = await scheme.authenticatorFor(bearer('abc'))
        .authenticate()

      assertEquals(identity.toFact(), { status: 'unavailable', claims: {} })
    })
  }
})

Deno.test('SessionBearer: reports the identity as unavailable when the auth server cannot be reached or does not answer in time', async () => {
  const unreachable = new SessionBearer(
    settings('http://localhost:1/api/auth/get-session'),
  )
  assertEquals(
    (await unreachable.authenticatorFor(bearer('abc')).authenticate()).status,
    'unavailable',
  )

  await withAuthServer(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
      return Response.json(aliceSession)
    },
    async (sessionUrl) => {
      const slow = new SessionBearer(settings(sessionUrl, { timeoutMs: 50 }))

      const identity = await slow.authenticatorFor(bearer('abc'))
        .authenticate()

      assertEquals(identity.status, 'unavailable')
    },
  )
})

Deno.test('SessionBearer: caches each token for its ttl, and never an unavailable identity', async () => {
  const seen: Array<string | null> = []
  let now = 0
  await withAuthServer(
    (request) => {
      seen.push(request.headers.get('authorization'))
      return seen.length === 1
        ? new Response('boom', { status: 503 })
        : Response.json(aliceSession)
    },
    async (sessionUrl) => {
      const scheme = new SessionBearer(
        settings(sessionUrl, { ttlSeconds: 5 }),
        () => now,
      )
      const authenticate = (token: string) =>
        scheme.authenticatorFor(bearer(token)).authenticate()

      assertEquals((await authenticate('one')).status, 'unavailable')
      assertEquals((await authenticate('one')).status, 'authenticated')
      now = 4_000
      assertEquals((await authenticate('one')).status, 'authenticated')
      await authenticate('two')
      now = 10_000
      await authenticate('one')

      assertEquals(seen, [
        'Bearer one',
        'Bearer one',
        'Bearer two',
        'Bearer one',
      ])
    },
  )
})

Deno.test('SessionBearer: challenges a denied caller without a valid session, and forbids an authenticated one', () => {
  const authenticator = new SessionBearer(
    settings('http://localhost:1/api/auth/get-session'),
  ).authenticatorFor(requestWith())

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

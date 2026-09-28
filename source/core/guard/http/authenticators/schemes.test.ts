import { assertEquals, assertInstanceOf, assertThrows } from '@std/assert'
import * as Access from '@idhn/access'
import { Rejection } from '../../rejection.ts'
import { Anonymous } from './anonymous.ts'
import { FirstPresented } from './first-presented.ts'
import { SessionBearer } from './session-bearer.ts'
import { Schemes, UnsupportedSchemeError } from './schemes.ts'

Deno.test('Schemes.for: builds the scheme the manifest declares from its settings', async () => {
  const schemes = new Schemes({ none: () => new Anonymous() })

  const scheme = schemes.for({ scheme: 'none' })

  assertInstanceOf(scheme, Anonymous)
  const identity = await scheme
    .authenticatorFor(new Request('https://service.test/'))
    .authenticate()
  assertEquals(identity.status, 'anonymous')
})

Deno.test('Schemes.for: fails when the deployment does not support the declared scheme', () => {
  const schemes = new Schemes({})

  assertThrows(
    () => schemes.for({ scheme: 'none' }),
    UnsupportedSchemeError,
    'scheme "none" is not supported',
  )
})

Deno.test('Schemes.for: builds every listed scheme, the first presented one deciding', () => {
  const built: string[] = []
  const schemes = new Schemes({
    'session-bearer': (settings) => {
      built.push(settings.issuer)
      return new SessionBearer(settings)
    },
  })
  const bearer = (issuer: string) => ({
    scheme: 'session-bearer' as const,
    sessionUrl: 'http://localhost:1/api/auth/get-session',
    issuer,
    claims: [],
    ttlSeconds: 0,
    timeoutMs: 100,
  })

  const scheme = schemes.for([bearer('first'), bearer('second')])

  assertInstanceOf(scheme, FirstPresented)
  assertEquals(built, ['first', 'second'])
})

Deno.test('Schemes.for: fails when the deployment does not support one of the listed schemes', () => {
  const schemes = new Schemes({
    'session-bearer': (settings) => new SessionBearer(settings),
  })

  assertThrows(
    () =>
      schemes.for([{
        scheme: 'session-cookie',
        sessionUrl: 'http://localhost:1/api/auth/get-session',
        cookie: 'session',
        issuer: 'portal',
        claims: [],
        ttlSeconds: 0,
        timeoutMs: 100,
      }]),
    UnsupportedSchemeError,
    'scheme "session-cookie" is not supported',
  )
})

Deno.test('Anonymous: a denial is forbidden, since no one can authenticate', () => {
  assertEquals(
    new Anonymous().rejectionFor(Access.Identity.anonymous()),
    Rejection.Forbidden,
  )
})

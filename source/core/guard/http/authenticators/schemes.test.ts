import { assertEquals, assertInstanceOf, assertThrows } from '@std/assert'
import * as Access from '@idhn/access'
import { Rejection } from '../../rejection.ts'
import { Anonymous } from './anonymous.ts'
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

Deno.test('Anonymous: a denial is forbidden, since no one can authenticate', () => {
  assertEquals(
    new Anonymous().rejectionFor(Access.Identity.anonymous()),
    Rejection.Forbidden,
  )
})

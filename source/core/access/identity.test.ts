import { assertEquals, assertThrows } from '@std/assert'
import { Identity, InvalidIdentityError } from './identity.ts'

Deno.test('Identity.authenticated: carries subject, issuer and claims into its fact', () => {
  const identity = Identity.authenticated('u-1', 'https://auth.test', {
    username: 'alice',
  })

  assertEquals(identity.status, 'authenticated')
  assertEquals(identity.toFact(), {
    status: 'authenticated',
    subject: 'u-1',
    issuer: 'https://auth.test',
    claims: { username: 'alice' },
  })
})

Deno.test('Identity.authenticated: rejects an empty subject', () => {
  assertThrows(
    () => Identity.authenticated(' ', 'https://auth.test'),
    InvalidIdentityError,
  )
})

Deno.test('Identity.anonymous: has no subject, issuer or claims', () => {
  assertEquals(Identity.anonymous().toFact(), {
    status: 'anonymous',
    claims: {},
  })
})

Deno.test('Identity.invalid: has no subject, issuer or claims', () => {
  assertEquals(Identity.invalid().toFact(), { status: 'invalid', claims: {} })
})

Deno.test('Identity.unavailable: has no subject, issuer or claims', () => {
  assertEquals(Identity.unavailable().toFact(), {
    status: 'unavailable',
    claims: {},
  })
})

Deno.test('Identity: claims cannot be changed after construction', () => {
  const claims: Record<string, unknown> = { username: 'alice' }
  const identity = Identity.authenticated('u-1', 'https://auth.test', claims)

  claims.username = 'mallory'

  assertEquals(identity.claims, { username: 'alice' })
})

Deno.test('Identity.FACT: is the reserved auth fact', () => {
  assertEquals(Identity.FACT, 'auth')
})

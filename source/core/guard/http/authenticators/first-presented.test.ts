import { assertEquals, assertThrows } from '@std/assert'
import * as Access from '@idhn/access'
import type { Authenticator } from '../../authenticator.ts'
import { Rejection } from '../../rejection.ts'
import { FirstPresented } from './first-presented.ts'
import type { Scheme } from './scheme.ts'

/** A scheme whose credential is the header `name`: its value is the identity's status, and a denial is answered with `rejection`. */
class HeaderScheme implements Scheme {
  readonly asked: string[] = []

  constructor(
    private readonly name: string,
    private readonly rejection: Rejection,
  ) {}

  authenticatorFor(request: Request): Authenticator {
    const status = request.headers.get(this.name)
    // deno-lint-ignore no-this-alias
    const scheme = this
    return {
      // deno-lint-ignore require-await
      async authenticate() {
        if (status === null) {
          return Access.Identity.anonymous()
        }
        scheme.asked.push(status)
        return status === 'authenticated'
          ? Access.Identity.authenticated('u-1', scheme.name)
          : status === 'invalid'
          ? Access.Identity.invalid()
          : Access.Identity.unavailable()
      },
      rejectionFor: () => scheme.rejection,
    }
  }
}

function schemes() {
  const cookie = new HeaderScheme('x-cookie', Rejection.Unauthenticated)
  const bearer = new HeaderScheme('x-bearer', Rejection.Unavailable)
  return { cookie, bearer, both: new FirstPresented([cookie, bearer]) }
}

async function authenticate(scheme: Scheme, headers: Record<string, string>) {
  const authenticator = scheme.authenticatorFor(
    new Request('https://service.test/', { headers }),
  )
  const identity = await authenticator.authenticate()
  return { identity, rejection: authenticator.rejectionFor(identity) }
}

Deno.test('FirstPresented: the scheme whose credential the request presents decides who is asking and how a denial is answered', async () => {
  const { cookie, bearer, both } = schemes()

  const byCookie = await authenticate(both, { 'x-cookie': 'authenticated' })
  const byBearer = await authenticate(both, { 'x-bearer': 'invalid' })

  assertEquals(byCookie.identity.issuer, 'x-cookie')
  assertEquals(byBearer.identity.status, 'invalid')
  assertEquals(byBearer.rejection, Rejection.Unavailable)
  assertEquals(cookie.asked, ['authenticated'])
  assertEquals(bearer.asked, ['invalid'])
})

Deno.test('FirstPresented: an earlier scheme takes precedence, even when its credential is bad', async () => {
  const { bearer, both } = schemes()

  const { identity, rejection } = await authenticate(both, {
    'x-cookie': 'invalid',
    'x-bearer': 'authenticated',
  })

  assertEquals(identity.status, 'invalid')
  assertEquals(rejection, Rejection.Unauthenticated)
  assertEquals(bearer.asked, [])
})

Deno.test('FirstPresented: a request that presents no credential is anonymous, answered as the first scheme answers', async () => {
  const { both } = schemes()

  const { identity, rejection } = await authenticate(both, {})

  assertEquals(identity.status, 'anonymous')
  assertEquals(rejection, Rejection.Unauthenticated)
})

Deno.test('FirstPresented: needs at least one scheme', () => {
  assertThrows(() => new FirstPresented([]), Error, 'at least one scheme')
})

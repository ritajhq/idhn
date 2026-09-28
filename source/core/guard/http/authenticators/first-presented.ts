import type * as Access from '@idhn/access'
import type { Authenticator } from '../../authenticator.ts'
import type { Rejection } from '../../rejection.ts'
import type { Scheme } from './scheme.ts'

/**
 * Several schemes a caller may choose from, in precedence order: a browser
 * presents a session cookie, a CLI a bearer token, and one guard accepts
 * both. The first scheme whose credential a request presents decides who is
 * asking, and how a denial is answered. A later scheme is never tried when an
 * earlier one found its credential invalid or unavailable, so a bad
 * credential can't be masked by another one. A request that presents none is
 * anonymous, and answered as the first scheme answers.
 */
export class FirstPresented implements Scheme {
  constructor(private readonly schemes: readonly Scheme[]) {
    if (schemes.length === 0) {
      throw new Error('FirstPresented needs at least one scheme')
    }
  }

  authenticatorFor(request: Request): Authenticator {
    return new FirstPresentedAuthenticator(
      this.schemes.map((scheme) => scheme.authenticatorFor(request)),
    )
  }
}

/**
 * Asks each scheme's authenticator in turn. That costs no lookup for the
 * schemes before the deciding one, since a scheme reports a request that
 * presents none of its credential as anonymous without asking anyone.
 */
class FirstPresentedAuthenticator implements Authenticator {
  private decider: Authenticator

  constructor(private readonly authenticators: readonly Authenticator[]) {
    this.decider = authenticators[0]
  }

  async authenticate(): Promise<Access.Identity> {
    let identity: Access.Identity | undefined
    for (const authenticator of this.authenticators) {
      identity = await authenticator.authenticate()
      if (identity.status !== 'anonymous') {
        this.decider = authenticator
        return identity
      }
    }
    this.decider = this.authenticators[0]
    return identity!
  }

  rejectionFor(identity: Access.Identity): Rejection {
    return this.decider.rejectionFor(identity)
  }
}

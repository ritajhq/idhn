import * as Access from '@idhn/access'
import type { Authenticator } from '../../authenticator.ts'
import type { Scheme } from './scheme.ts'

/** The scheme of a service that authenticates no one: every request is anonymous, so policies see `auth.status == "anonymous"`. */
export class Anonymous implements Scheme, Authenticator {
  authenticatorFor(_request: Request): Authenticator {
    return this
  }

  // deno-lint-ignore require-await
  async authenticate(): Promise<Access.Identity> {
    return Access.Identity.anonymous()
  }
}

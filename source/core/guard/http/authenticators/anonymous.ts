import * as Access from '@idhn/access'
import type { Authenticator } from '../../authenticator.ts'
import { Rejection } from '../../rejection.ts'
import type { Scheme } from './scheme.ts'

/**
 * The scheme of a service that authenticates no one: every request is
 * anonymous, so policies see `auth.status == "anonymous"`. A denial is always
 * forbidden, since there is no way to authenticate that could change it.
 */
export class Anonymous implements Scheme, Authenticator {
  authenticatorFor(_request: Request): Authenticator {
    return this
  }

  // deno-lint-ignore require-await
  async authenticate(): Promise<Access.Identity> {
    return Access.Identity.anonymous()
  }

  rejectionFor(_identity: Access.Identity): Rejection {
    return Rejection.Forbidden
  }
}

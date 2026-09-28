import type { Authenticator } from '../../authenticator.ts'
import type { SessionBearerAuthentication } from '../../manifest/http/schema.ts'
import type { Scheme } from './scheme.ts'
import { SessionAuthenticator, SessionLookup } from './session-lookup.ts'

/** `Bearer`, matched case-insensitively as RFC 9110 has auth schemes, then the token (RFC 6750's `b64token`). */
const BEARER = /^Bearer +([A-Za-z0-9\-._~+/]+=*) *$/i

/**
 * Authenticates by a server-side session token carried in
 * `Authorization: Bearer <token>`, as a CLI or other non-browser client
 * presents it: only that header is forwarded to the auth server's session
 * endpoint (see `SessionLookup`), which must accept it (BetterAuth's `bearer`
 * plugin). A request without a bearer token (no `Authorization`, or another
 * auth scheme in it) is anonymous, and costs no lookup.
 */
export class SessionBearer implements Scheme {
  private readonly sessions: SessionLookup

  constructor(
    settings: SessionBearerAuthentication,
    now: () => number = Date.now,
  ) {
    this.sessions = new SessionLookup(
      settings,
      (token) => ({ authorization: `Bearer ${token}` }),
      now,
    )
  }

  authenticatorFor(request: Request): Authenticator {
    return new SessionAuthenticator(this.presentedToken(request), this.sessions)
  }

  private presentedToken(request: Request): string | undefined {
    return BEARER.exec(request.headers.get('authorization') ?? '')?.[1]
  }
}

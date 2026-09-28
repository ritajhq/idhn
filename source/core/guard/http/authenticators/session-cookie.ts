import type { Authenticator } from '../../authenticator.ts'
import type { SessionCookieAuthentication } from '../../manifest/http/schema.ts'
import type { Scheme } from './scheme.ts'
import { SessionAuthenticator, SessionLookup } from './session-lookup.ts'

/**
 * Authenticates by a server-side session carried in a cookie, as a browser
 * presents it: only the session cookie is forwarded to the auth server's
 * session endpoint (see `SessionLookup`). A request without the cookie is
 * anonymous, and costs no lookup.
 */
export class SessionCookie implements Scheme {
  private readonly sessions: SessionLookup

  constructor(
    private readonly settings: SessionCookieAuthentication,
    now: () => number = Date.now,
  ) {
    this.sessions = new SessionLookup(
      settings,
      (token) => ({ cookie: `${settings.cookie}=${token}` }),
      now,
    )
  }

  authenticatorFor(request: Request): Authenticator {
    return new SessionAuthenticator(this.presentedToken(request), this.sessions)
  }

  private presentedToken(request: Request): string | undefined {
    const prefix = `${this.settings.cookie}=`
    const pair = (request.headers.get('cookie') ?? '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix) && part.length > prefix.length)
    return pair?.slice(prefix.length)
  }
}

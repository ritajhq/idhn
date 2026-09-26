import * as Access from '@idhn/access'
import type { Authenticator } from '../../authenticator.ts'
import { type Rejection, REJECTION_FOR_IDENTITY } from '../../rejection.ts'
import type { SessionCookieAuthentication } from '../../manifest/http/schema.ts'
import type { Scheme } from './scheme.ts'

/** The auth server could not be asked, or gave an answer that is not a session. Never leaves this module: it becomes an unavailable identity. */
class SessionLookupError extends Error {}

interface CachedIdentity {
  identity: Access.Identity
  expiresAt: number
}

/**
 * Authenticates by a server-side session carried in a cookie: the session
 * cookie is forwarded to the auth server's session endpoint, which answers
 * with the session and its user, or with `null`. The user's `id` becomes the
 * subject, and the configured user fields become the claims. Answers are
 * cached per cookie (by its hash, never its value) for `ttlSeconds`, which is
 * how long a revoked session can still be seen as valid. When the auth server
 * cannot be asked, the identity is `unavailable`: never cached, and never an
 * error, so public actions keep working while the policies deny the rest.
 */
export class SessionCookie implements Scheme {
  private readonly cache = new Map<string, CachedIdentity>()

  constructor(
    private readonly settings: SessionCookieAuthentication,
    private readonly now: () => number = Date.now,
  ) {}

  authenticatorFor(request: Request): Authenticator {
    return new SessionCookieAuthenticator(request, this.settings.cookie, this)
  }

  /** The identity a presented session token proves: authenticated, invalid when the auth server knows no such session, or unavailable when it cannot say. */
  async identify(token: string): Promise<Access.Identity> {
    const key = await this.hash(token)
    const cached = this.cache.get(key)
    if (cached !== undefined && cached.expiresAt > this.now()) {
      return cached.identity
    }

    try {
      const identity = this.toIdentity(await this.fetchSession(token))
      this.remember(key, identity)
      return identity
    } catch (error) {
      if (!(error instanceof SessionLookupError)) {
        throw error
      }
      return Access.Identity.unavailable()
    }
  }

  private async fetchSession(token: string): Promise<unknown> {
    const response = await fetch(this.settings.sessionUrl, {
      headers: {
        accept: 'application/json',
        cookie: `${this.settings.cookie}=${token}`,
      },
    }).catch((error: unknown) => {
      throw new SessionLookupError(
        `Session lookup at ${this.settings.sessionUrl} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      )
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new SessionLookupError(
        `Session lookup got ${response.status} ${response.statusText} from ${
          new URL(this.settings.sessionUrl).origin
        }`,
      )
    }
    return await response.json()
  }

  private toIdentity(session: unknown): Access.Identity {
    if (session === null) {
      return Access.Identity.invalid()
    }

    const user = this.userOf(session)
    return Access.Identity.authenticated(
      user.id as string,
      this.settings.issuer,
      Object.fromEntries(
        this.settings.claims
          .filter((claim) => user[claim] !== undefined)
          .map((claim) => [claim, user[claim]]),
      ),
    )
  }

  private userOf(session: unknown): Record<string, unknown> {
    const user = (session as { user?: unknown } | undefined)?.user as
      | Record<string, unknown>
      | undefined
    if (typeof user?.id !== 'string' || user.id.length === 0) {
      throw new SessionLookupError(
        `Session lookup at ${this.settings.sessionUrl} answered with neither null nor a session with a user id`,
      )
    }
    return user
  }

  private remember(key: string, identity: Access.Identity): void {
    if (this.settings.ttlSeconds === 0) {
      return
    }

    const now = this.now()
    for (const [staleKey, stale] of this.cache) {
      if (stale.expiresAt <= now) {
        this.cache.delete(staleKey)
      }
    }
    this.cache.set(key, {
      identity,
      expiresAt: now + this.settings.ttlSeconds * 1000,
    })
  }

  private async hash(token: string): Promise<string> {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(token),
    )
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }
}

/** Extracts the session cookie from one request; a request without it is anonymous, and costs no lookup. */
class SessionCookieAuthenticator implements Authenticator {
  constructor(
    private readonly request: Request,
    private readonly cookie: string,
    private readonly sessions: SessionCookie,
  ) {}

  async authenticate(): Promise<Access.Identity> {
    const token = this.presentedToken()
    if (token === undefined) {
      return Access.Identity.anonymous()
    }
    return await this.sessions.identify(token)
  }

  /** A caller without a valid session is told to sign in (401), one whose session could not be checked to retry (503). */
  rejectionFor(identity: Access.Identity): Rejection {
    return REJECTION_FOR_IDENTITY[identity.status]
  }

  private presentedToken(): string | undefined {
    const prefix = `${this.cookie}=`
    const pair = (this.request.headers.get('cookie') ?? '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix) && part.length > prefix.length)
    return pair?.slice(prefix.length)
  }
}

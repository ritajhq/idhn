import * as Access from '@idhn/access'
import type { Authenticator } from '../../authenticator.ts'
import { type Rejection, REJECTION_FOR_IDENTITY } from '../../rejection.ts'
import type { SessionAuthentication } from '../../manifest/http/schema.ts'

/** The auth server could not be asked, or gave an answer that is not a session. Never leaves this module: it becomes an unavailable identity. */
class SessionLookupError extends Error {}

interface CachedIdentity {
  identity: Access.Identity
  expiresAt: number
}

/**
 * Resolves a session token to the identity it proves, for every scheme backed
 * by a server-side session: the token is presented to the auth server's
 * session endpoint the way the scheme's `present` says (as a cookie, as a
 * bearer header), and nothing else of the caller's request is forwarded. The
 * endpoint answers with the session and its user, or with `null`. The user's
 * `id` becomes the subject, and the configured user fields become the claims.
 * Answers are cached per token (by its hash, never its value) for
 * `ttlSeconds`, which is how long a revoked session can still be seen as
 * valid. When the auth server cannot be asked, or doesn't answer within
 * `timeoutMs`, the identity is `unavailable`: never cached, and never an
 * error, so public actions keep working while the policies deny the rest.
 */
export class SessionLookup {
  private readonly cache = new Map<string, CachedIdentity>()

  constructor(
    private readonly settings: SessionAuthentication,
    private readonly present: (token: string) => Record<string, string>,
    private readonly now: () => number = Date.now,
  ) {}

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

  /** The auth server's whole answer, within `timeoutMs` or as a failed lookup. */
  private async fetchSession(token: string): Promise<unknown> {
    const signal = AbortSignal.timeout(this.settings.timeoutMs)
    try {
      return await this.exchange(token, signal)
    } catch (error) {
      if (!signal.aborted) {
        throw error
      }
      throw new SessionLookupError(
        `Session lookup at ${this.settings.sessionUrl} got no answer within ${this.settings.timeoutMs}ms`,
        { cause: error },
      )
    }
  }

  private async exchange(token: string, signal: AbortSignal): Promise<unknown> {
    const response = await fetch(this.settings.sessionUrl, {
      headers: {
        accept: 'application/json',
        ...this.present(token),
      },
      signal,
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

/** Authenticates one request by the session token a scheme found in it; a request that presents none is anonymous, and costs no lookup. */
export class SessionAuthenticator implements Authenticator {
  constructor(
    private readonly token: string | undefined,
    private readonly sessions: SessionLookup,
  ) {}

  async authenticate(): Promise<Access.Identity> {
    if (this.token === undefined) {
      return Access.Identity.anonymous()
    }
    return await this.sessions.identify(this.token)
  }

  /** A caller without a valid session is told to sign in (401), one whose session could not be checked to retry (503). */
  rejectionFor(identity: Access.Identity): Rejection {
    return REJECTION_FOR_IDENTITY[identity.status]
  }
}

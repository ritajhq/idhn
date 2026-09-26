import {
  expectArray,
  expectNonNegativeNumber,
  expectObject,
  expectOneOf,
  expectString,
  expectUrl,
} from '../expect.ts'
import type {
  HttpAuthentication,
  HttpAuthentications,
  HttpAuthenticationScheme,
  NoAuthentication,
  SessionCookieAuthentication,
} from './schema.ts'

/** BetterAuth's session cookie name when it is not served over `https` (where it gains a `__Secure-` prefix). */
const DEFAULT_SESSION_COOKIE = 'better-auth.session_token'
const DEFAULT_SESSION_CLAIMS = ['username', 'email', 'name', 'emailVerified']
const DEFAULT_SESSION_TTL_SECONDS = 5

/** One settings parser per scheme: given the raw `authentication` object (its `scheme` already validated), builds that scheme's settings. */
const SCHEME_PARSERS: {
  [S in HttpAuthenticationScheme]: (
    settings: Record<string, unknown>,
    path: string,
  ) => HttpAuthentications[S]
} = {
  none: () => NO_AUTHENTICATION,
  'session-cookie': parseSessionCookie,
}

const SCHEMES = Object.keys(SCHEME_PARSERS) as HttpAuthenticationScheme[]

/** A manifest that declares no authentication authenticates no one, since that predates the `authentication` block. */
const NO_AUTHENTICATION: NoAuthentication = { scheme: 'none' }

/**
 * Parses a manifest's `authentication` block, dispatching on its `scheme`
 * the way `parseManifest` dispatches on `protocol`. Only says the settings are
 * well-formed; whether this deployment supports the scheme is checked at
 * startup, when `main.ts` builds it.
 */
export function parseHttpAuthentication(
  raw: unknown,
  path: string,
): HttpAuthentication {
  if (raw === undefined) {
    return NO_AUTHENTICATION
  }
  const settings = expectObject(raw, path)
  const scheme = expectOneOf(settings.scheme, SCHEMES, `${path}.scheme`)
  return SCHEME_PARSERS[scheme](settings, path)
}

function parseSessionCookie(
  settings: Record<string, unknown>,
  path: string,
): SessionCookieAuthentication {
  const sessionUrl = expectUrl(settings.session_url, `${path}.session_url`)
  return {
    scheme: 'session-cookie',
    sessionUrl,
    cookie: settings.cookie === undefined
      ? DEFAULT_SESSION_COOKIE
      : expectString(settings.cookie, `${path}.cookie`),
    issuer: settings.issuer === undefined
      ? new URL(sessionUrl).origin
      : expectString(settings.issuer, `${path}.issuer`),
    claims: settings.claims === undefined
      ? DEFAULT_SESSION_CLAIMS
      : expectArray(settings.claims, `${path}.claims`).map((claim, index) =>
        expectString(claim, `${path}.claims[${index}]`)
      ),
    ttlSeconds: settings.ttl_seconds === undefined
      ? DEFAULT_SESSION_TTL_SECONDS
      : expectNonNegativeNumber(settings.ttl_seconds, `${path}.ttl_seconds`),
  }
}

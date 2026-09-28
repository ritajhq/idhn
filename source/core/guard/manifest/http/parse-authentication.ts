import {
  expectArray,
  expectNonNegativeNumber,
  expectObject,
  expectOneOf,
  expectPositiveNumber,
  expectString,
  expectUrl,
  ManifestParseError,
} from '../expect.ts'
import type {
  ChallengingAuthentication,
  HttpAuthentication,
  HttpAuthenticationDeclaration,
  HttpAuthentications,
  HttpAuthenticationScheme,
  NoAuthentication,
  SessionAuthentication,
  SessionBearerAuthentication,
  SessionCookieAuthentication,
} from './schema.ts'

/** BetterAuth's session cookie name when it is not served over `https` (where it gains a `__Secure-` prefix). */
const DEFAULT_SESSION_COOKIE = 'better-auth.session_token'
const DEFAULT_SESSION_CLAIMS = ['username', 'email', 'name', 'emailVerified']
const DEFAULT_SESSION_TTL_SECONDS = 5
const DEFAULT_SESSION_TIMEOUT_MS = 2000

/** One settings parser per scheme: given the raw `authentication` object (its `scheme` already validated), builds that scheme's settings. */
const SCHEME_PARSERS: {
  [S in HttpAuthenticationScheme]: (
    settings: Record<string, unknown>,
    path: string,
  ) => HttpAuthentications[S]
} = {
  none: () => NO_AUTHENTICATION,
  'session-cookie': parseSessionCookie,
  'session-bearer': parseSessionBearer,
}

const SCHEMES = Object.keys(SCHEME_PARSERS) as HttpAuthenticationScheme[]

/** A manifest that declares no authentication authenticates no one, since that predates the `authentication` block. */
const NO_AUTHENTICATION: NoAuthentication = { scheme: 'none' }

/**
 * Parses a manifest's `authentication` block: one scheme, or a list of the
 * schemes a caller may choose from, in precedence order. Each dispatches on
 * its `scheme` the way `parseManifest` dispatches on `protocol`. Only says the
 * settings are well-formed; whether this deployment supports each scheme is
 * checked at startup, when `main.ts` builds it.
 */
export function parseHttpAuthentication(
  raw: unknown,
  path: string,
): HttpAuthenticationDeclaration {
  if (raw === undefined) {
    return NO_AUTHENTICATION
  }
  if (Array.isArray(raw)) {
    return parseSchemeList(raw, path)
  }
  return parseScheme(raw, path)
}

function parseScheme(raw: unknown, path: string): HttpAuthentication {
  const settings = expectObject(raw, path)
  const scheme = expectOneOf(settings.scheme, SCHEMES, `${path}.scheme`)
  return SCHEME_PARSERS[scheme](settings, path)
}

/** Every entry must be a scheme a caller can present a credential for: `none` presents nothing, so it could never be chosen. */
function parseSchemeList(
  raw: unknown[],
  path: string,
): ChallengingAuthentication[] {
  if (raw.length === 0) {
    throw new ManifestParseError(
      `${path} must list at least one scheme, or be left out to authenticate no one`,
    )
  }
  return raw.map((entry, index) => {
    const authentication = parseScheme(entry, `${path}[${index}]`)
    if (authentication.scheme === 'none') {
      throw new ManifestParseError(
        `${path}[${index}].scheme "none" can't be listed with other schemes, since it presents no credential; leave the block out to authenticate no one`,
      )
    }
    return authentication
  })
}

function parseSessionCookie(
  settings: Record<string, unknown>,
  path: string,
): SessionCookieAuthentication {
  return {
    scheme: 'session-cookie',
    ...parseSession(settings, path),
    cookie: settings.cookie === undefined
      ? DEFAULT_SESSION_COOKIE
      : expectString(settings.cookie, `${path}.cookie`),
  }
}

function parseSessionBearer(
  settings: Record<string, unknown>,
  path: string,
): SessionBearerAuthentication {
  return { scheme: 'session-bearer', ...parseSession(settings, path) }
}

/** The settings every session-backed scheme shares. */
function parseSession(
  settings: Record<string, unknown>,
  path: string,
): SessionAuthentication {
  const sessionUrl = expectUrl(settings.session_url, `${path}.session_url`)
  return {
    sessionUrl,
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
    timeoutMs: settings.timeout_ms === undefined
      ? DEFAULT_SESSION_TIMEOUT_MS
      : expectPositiveNumber(settings.timeout_ms, `${path}.timeout_ms`),
  }
}

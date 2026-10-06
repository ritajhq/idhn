import type * as Disclosure from '@idhn/disclosure'

/** A single header match criterion: presence-only, or presence with an exact value. */
export interface HeaderCriterion {
  name: string
  value?: string
}

/** Which parts of a request an action's rule matches against. */
export interface Match {
  method: string | string[]
  path: string | string[]
  header?: string | string[] | HeaderCriterion[]
}

export type BodyType = 'json' | 'form' | 'text'

export type FromProperty = 'path' | 'query' | 'header' | 'body' | 'constant'

/** Where an extracted context value comes from, and how to read it. */
export interface From {
  property: FromProperty
  /**
   * What to read. For `"body"` with `json` or `form`, a dot-path (`data.place`)
   * or, when it starts with `/`, a JSON Pointer (`/data/action.place`) for keys
   * that themselves contain dots.
   */
  using: string
  /** Only meaningful when `property` is `"body"`. */
  type?: BodyType
}

/** One declared context fact to pull out of a matched request. */
export interface ExtractEntry {
  from: From
  as: string
  /** Only meaningful when `from.property` is `"query"`, `"header"`, or `"body"`. Defaults to `false`. */
  optional?: boolean
}

/**
 * One action's matching rule, the context facts to extract when it matches,
 * and the fields of its answer to restrict: each one's JSON Pointer, and how
 * it is shown when no policy says otherwise (`covered` unless declared).
 */
export interface HttpManifestAction {
  name: string
  match: Match
  extract?: ExtractEntry[]
  restrict?: Disclosure.Disclosure
}

/** The authentication of a service that authenticates no one: every request is anonymous. The default when a manifest declares none. */
export interface NoAuthentication {
  scheme: 'none'
}

/**
 * A session carried in a cookie and kept server-side by an auth server
 * (BetterAuth, for one): the session cookie is forwarded to `sessionUrl`,
 * which answers with the session's user, or with `null` when there is no
 * valid session.
 */
export interface SessionCookieAuthentication {
  scheme: 'session-cookie'
  /** The auth server's session endpoint, e.g. BetterAuth's `GET /api/auth/get-session`. */
  sessionUrl: string
  /** The session cookie's name. A request without it is anonymous and costs no lookup. */
  cookie: string
  /** Who vouches for the identity, reported as `auth.issuer`. */
  issuer: string
  /** The user fields copied into `auth.claims`. The user's `id` is always `auth.subject`. */
  claims: readonly string[]
  /** How long an answer may be reused for the same cookie. The cost is revocation lag. `0` disables caching. */
  ttlSeconds: number
  /** How long to wait for the auth server's whole answer before the identity counts as unavailable. */
  timeoutMs: number
}

/**
 * Every authentication scheme an HTTP manifest can declare, mapped to its
 * settings. A new scheme adds one entry here and one settings parser in
 * `parse-authentication.ts`; `main.ts` decides whether a deployment supports
 * it. Settings are non-secret by design — secrets never go in a manifest.
 */
export interface HttpAuthentications {
  none: NoAuthentication
  'session-cookie': SessionCookieAuthentication
}

export type HttpAuthenticationScheme = keyof HttpAuthentications

/** The one authentication scheme a service declares, with its settings. */
export type HttpAuthentication = HttpAuthentications[HttpAuthenticationScheme]

/** A service's declared actions: how to recognize them from an HTTP request, and what context to extract. */
export interface HttpManifest {
  protocol: 'http'
  id: string
  authentication: HttpAuthentication
  actions: HttpManifestAction[]
}

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

/** One action's matching rule and the context facts to extract when it matches. */
export interface HttpManifestAction {
  name: string
  match: Match
  extract?: ExtractEntry[]
}

/** The authentication of a service that authenticates no one: every request is anonymous. The default when a manifest declares none. */
export interface NoAuthentication {
  scheme: 'none'
}

/**
 * What every scheme backed by a server-side session shares: the presented
 * session token is forwarded to an auth server (BetterAuth, for one) at
 * `sessionUrl`, which answers with the session's user, or with `null` when
 * there is no valid session. Schemes differ only in how the request carries
 * the token.
 */
export interface SessionAuthentication {
  /** The auth server's session endpoint, e.g. BetterAuth's `GET /api/auth/get-session`. */
  sessionUrl: string
  /** Who vouches for the identity, reported as `auth.issuer`. */
  issuer: string
  /** The user fields copied into `auth.claims`. The user's `id` is always `auth.subject`. */
  claims: readonly string[]
  /** How long an answer may be reused for the same token. The cost is revocation lag. `0` disables caching. */
  ttlSeconds: number
  /** How long to wait for the auth server's whole answer before the identity counts as unavailable. */
  timeoutMs: number
}

/** A session token carried in a cookie, as a browser presents it. */
export interface SessionCookieAuthentication extends SessionAuthentication {
  scheme: 'session-cookie'
  /** The session cookie's name. A request without it is anonymous and costs no lookup. */
  cookie: string
}

/**
 * A session token carried in `Authorization: Bearer <token>`, as a CLI or
 * other non-browser client presents it (BetterAuth's device flow hands one
 * out). The auth server must accept it that way (BetterAuth's `bearer`
 * plugin). A request without a bearer token is anonymous and costs no lookup.
 */
export interface SessionBearerAuthentication extends SessionAuthentication {
  scheme: 'session-bearer'
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
  'session-bearer': SessionBearerAuthentication
}

export type HttpAuthenticationScheme = keyof HttpAuthentications

/** One authentication scheme, with its settings. */
export type HttpAuthentication = HttpAuthentications[HttpAuthenticationScheme]

/** A scheme a caller can present a credential for, which is every scheme but `none`. */
export type ChallengingAuthentication = Exclude<
  HttpAuthentication,
  NoAuthentication
>

/**
 * How a service authenticates: one scheme, or several a caller may choose
 * from (a browser's cookie or a CLI's bearer token, for one), in precedence
 * order. With several, the first scheme whose credential a request presents
 * decides who is asking; `none` can't be one of them, since it presents
 * nothing.
 */
export type HttpAuthenticationDeclaration =
  | HttpAuthentication
  | readonly ChallengingAuthentication[]

/** A service's declared actions: how to recognize them from an HTTP request, and what context to extract. */
export interface HttpManifest {
  protocol: 'http'
  id: string
  authentication: HttpAuthenticationDeclaration
  actions: HttpManifestAction[]
}

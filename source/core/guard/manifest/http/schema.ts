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
 * Every authentication scheme an HTTP manifest can declare, mapped to its
 * settings. A new scheme adds one entry here and one settings parser in
 * `parse-authentication.ts`; `main.ts` decides whether a deployment supports
 * it. Settings are non-secret by design — secrets never go in a manifest.
 */
export interface HttpAuthentications {
  none: NoAuthentication
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

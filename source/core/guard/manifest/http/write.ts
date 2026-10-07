import type {
  HttpAuthentication,
  HttpAuthentications,
  HttpAuthenticationScheme,
  HttpManifest,
  HttpManifestAction,
} from './schema.ts'

/** One settings writer per scheme: the inverse of its parser in `parse-authentication.ts`. */
const SCHEME_WRITERS: {
  [S in HttpAuthenticationScheme]: (
    settings: HttpAuthentications[S],
  ) => Record<string, unknown>
} = {
  none: () => ({ scheme: 'none' }),
  'session-cookie': (settings) => ({
    scheme: 'session-cookie',
    session_url: settings.sessionUrl,
    cookie: settings.cookie,
    issuer: settings.issuer,
    claims: settings.claims,
    ttl_seconds: settings.ttlSeconds,
    timeout_ms: settings.timeoutMs,
  }),
}

/** The HTTP manifest in the syntax `parseHttpManifest` reads. */
export function writeHttpManifest(
  manifest: HttpManifest,
): Record<string, unknown> {
  return {
    id: manifest.id,
    protocol: manifest.protocol,
    authentication: writeAuthentication(manifest.authentication),
    actions: manifest.actions.map(writeAction),
  }
}

function writeAuthentication(
  authentication: HttpAuthentication,
): Record<string, unknown> {
  const write = SCHEME_WRITERS[authentication.scheme] as (
    settings: HttpAuthentication,
  ) => Record<string, unknown>
  return write(authentication)
}

function writeAction(action: HttpManifestAction): Record<string, unknown> {
  return withoutUndefined({
    name: action.name,
    match: withoutUndefined({ ...action.match }),
    extract: action.extract?.map((entry) =>
      withoutUndefined({
        from: withoutUndefined({ ...entry.from }),
        as: entry.as,
        optional: entry.optional,
      })
    ),
    restrict: action.restrict === undefined
      ? undefined
      : Object.entries(action.restrict.toJSON()).map(([field, show]) => ({
        field,
        show,
      })),
  })
}

function withoutUndefined(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  )
}

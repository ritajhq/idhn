import { expectObject, expectOneOf } from '../expect.ts'
import type {
  HttpAuthentication,
  HttpAuthentications,
  HttpAuthenticationScheme,
  NoAuthentication,
} from './schema.ts'

/** One settings parser per scheme: given the raw `authentication` object (its `scheme` already validated), builds that scheme's settings. */
const SCHEME_PARSERS: {
  [S in HttpAuthenticationScheme]: (
    settings: Record<string, unknown>,
    path: string,
  ) => HttpAuthentications[S]
} = {
  none: () => NO_AUTHENTICATION,
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

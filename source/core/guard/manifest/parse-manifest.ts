import {
  expectObject,
  expectOneOf,
  expectRegoSafeIdentifier,
  ManifestParseError,
} from './expect.ts'
import { parseHttpManifest } from './http/parse.ts'
import type { Manifest, Protocol } from './schema.ts'

export { ManifestParseError }

/** One parser per protocol: given the manifest's already-validated `id` and its raw root, builds that protocol's `Manifest`. */
const PROTOCOL_PARSERS: {
  [P in Protocol]: (
    id: string,
    root: Record<string, unknown>,
  ) => Manifest<P>
} = {
  http: parseHttpManifest,
}

const PROTOCOLS = Object.keys(PROTOCOL_PARSERS) as Protocol[]

/** A manifest that doesn't say which protocol it declares actions for is an HTTP one, since that predates the `protocol` field. */
const DEFAULT_PROTOCOL: Protocol = 'http'

/** Parses and validates a raw (already YAML/JSON-decoded) value as a `Manifest`. Throws `ManifestParseError` on any structural problem. */
export function parseManifest(raw: unknown): Manifest {
  const root = expectObject(raw, 'manifest')
  const id = expectRegoSafeIdentifier(root.id, 'manifest.id')
  const protocol = root.protocol === undefined
    ? DEFAULT_PROTOCOL
    : expectOneOf(root.protocol, PROTOCOLS, 'manifest.protocol')
  return PROTOCOL_PARSERS[protocol](id, root)
}

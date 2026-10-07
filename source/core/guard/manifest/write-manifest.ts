import { writeHttpManifest } from './http/write.ts'
import type { Manifest, Protocol } from './schema.ts'

/** One writer per protocol: the inverse of that protocol's parser in `parse-manifest.ts`. */
const PROTOCOL_WRITERS: {
  [P in Protocol]: (manifest: Manifest<P>) => Record<string, unknown>
} = {
  http: writeHttpManifest,
}

/**
 * `manifest` in its own syntax, every default spelled out, as plain JSON:
 * what `parseManifest` reads back into the same manifest. How a guard serves
 * its manifest, so whoever reads it parses it as the guard did.
 */
export function writeManifest(manifest: Manifest): Record<string, unknown> {
  return PROTOCOL_WRITERS[manifest.protocol](manifest)
}

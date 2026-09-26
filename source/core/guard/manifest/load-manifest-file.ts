import { parse as parseYaml } from '@std/yaml'
import { ManifestParseError, parseManifest } from './parse-manifest.ts'
import type { Manifest, Protocol } from './schema.ts'

/**
 * Reads and parses a YAML manifest file from disk. `protocol` is the one the
 * calling entry point serves; a manifest declared for another protocol is
 * rejected up front rather than silently never matching.
 */
export async function loadManifestFile<P extends Protocol>(
  path: string | URL,
  protocol: P,
): Promise<Manifest<P>> {
  const text = await Deno.readTextFile(path)
  const manifest = parseManifest(parseYaml(text))
  if (manifest.protocol !== protocol) {
    throw new ManifestParseError(
      `manifest.protocol is "${manifest.protocol}", but this entry point serves "${protocol}"`,
    )
  }
  return manifest as Manifest<P>
}

import { parse as parseYaml } from '@std/yaml'
import { parseManifest } from './parse-manifest.ts'
import type { Manifest } from './schema.ts'

/** Reads and parses a YAML manifest file from disk. */
export async function loadManifestFile(path: string | URL): Promise<Manifest> {
  const text = await Deno.readTextFile(path)
  return parseManifest(parseYaml(text))
}

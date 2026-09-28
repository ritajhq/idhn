import { dirname, join } from '@std/path'
import { TarStream, type TarStreamInput } from '@std/tar/tar-stream'

/** A valid policy source tree: one public policy, governing one action. */
export const VALID_TREE: Record<string, string> = {
  'policies/public.rego': 'package shop.public\n\nallow := true\n',
  'policies/public_test.rego': 'package shop.public_test\n\nimport data.shop.public\n\ntest_allows if public.allow\n',
  'policies.yaml': 'associations:\n  shop.browse: [shop.public]\n',
  'enrichment.yaml': 'lookups: []\n',
}

/** Writes `files` (path → content) under `dir`. */
export async function writeTree(dir: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await Deno.mkdir(join(dir, dirname(path)), { recursive: true })
    await Deno.writeTextFile(join(dir, path), content)
  }
}

/** `files` (path → content) as a tar archive, as `git archive` would make it. */
export async function tarOf(files: Record<string, string>): Promise<Uint8Array<ArrayBuffer>> {
  const entries: TarStreamInput[] = Object.entries(files).map(([path, content]) => {
    const bytes = new TextEncoder().encode(content)
    return { type: 'file', path, size: bytes.length, readable: ReadableStream.from([bytes]) }
  })
  return new Uint8Array(
    await new Response(ReadableStream.from(entries).pipeThrough(new TarStream())).arrayBuffer(),
  )
}

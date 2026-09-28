import { assertEquals } from '@std/assert'
import type { SourceTree } from '../source-tree.ts'
import { VALID_TREE, writeTree } from '../test-fixtures.ts'
import { Directory, type Watching } from './directory.ts'

function nextTree(source: Directory): Promise<SourceTree> {
  return new Promise((resolve) => source.OnSources.DoOnce((tree) => resolve(tree)))
}

for (const watching of ['native', 'poll'] as Watching[]) {
  Deno.test({
    name: `Directory (${watching}): announces the sources, then again once they change`,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      const dir = await Deno.makeTempDir()
      await writeTree(dir, VALID_TREE)
      const source = new Directory(dir, watching, 200)

      const initial = nextTree(source)
      await source.start()
      const first = await initial

      const changed = nextTree(source)
      await Deno.writeTextFile(`${dir}/policies.yaml`, 'associations: {}\n')
      const second = await changed

      assertEquals(first.dir, dir)
      assertEquals(first.version === second.version, false)
    },
  })
}

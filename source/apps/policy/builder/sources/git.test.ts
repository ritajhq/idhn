import { assertEquals } from '@std/assert'
import { join } from '@std/path'
import type { SourceTree } from '../source-tree.ts'
import { VALID_TREE, writeTree } from '../test-fixtures.ts'
import { Git } from './git.ts'

async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await new Deno.Command('git', {
    args: ['-C', dir, '-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args],
    stdout: 'piped',
  }).output()
  return new TextDecoder().decode(stdout).trim()
}

/** A repository holding `files`, committed on `main`; its commit. */
async function repositoryWith(dir: string, files: Record<string, string>): Promise<string> {
  await writeTree(dir, files)
  await git(dir, 'add', '.')
  await git(dir, 'commit', '-q', '-m', 'policies')
  return git(dir, 'rev-parse', 'HEAD')
}

/** The next tree `source` announces. */
function nextTree(source: Git): Promise<SourceTree> {
  return new Promise((resolve) => source.OnSources.DoOnce((tree) => resolve(tree)))
}

Deno.test({
  name: 'Git: announces the cloned commit, then each new one',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const origin = await Deno.makeTempDir()
    await git(origin, 'init', '-q', '-b', 'main')
    const first = await repositoryWith(origin, VALID_TREE)
    const source = new Git(`file://${origin}`, 'main', join(await Deno.makeTempDir(), 'work'), 200)

    const cloned = nextTree(source)
    await source.start()
    assertEquals((await cloned).version, first)

    const fetched = nextTree(source)
    const second = await repositoryWith(origin, { 'policies.yaml': 'associations: {}\n' })
    const tree = await fetched
    assertEquals(tree.version, second)
    assertEquals(await Deno.readTextFile(tree.registryPath), 'associations: {}\n')
  },
})

import { basename, join } from '@std/path'
import * as Policy from '@idhn/policy'
import { CompileError } from './compiler.ts'
import { SourceTree } from './source-tree.ts'

/** The version a set built from the base alone is published as. */
const BASE_VERSION = 'base'

/** What the base's files are prefixed with among a tree's policies, so they never clash with its own. */
const FILE_PREFIX = 'base.'

/**
 * Policies the deployment owns rather than whoever publishes sources: its
 * `policies/*.rego` and the associations in its `policies.yaml` (anything
 * else in it is ignored). Every tree is built with the base beneath it, so
 * no publication can take them away — the console's own actions, governed
 * here, stay reachable whatever the console publishes.
 *
 * A tree may not replace a base policy, nor govern an action the base
 * governs: with deny-overrides, one more policy on such an action could deny
 * it. Either refuses the tree, like any other compile problem.
 *
 * The judges' first set comes from the base alone (`alone`), so they have
 * policies before anything is published.
 */
export class Base {
  private constructor(
    private readonly tree: SourceTree | undefined,
  ) {}

  /** The base in `dir`. */
  static at(dir: string): Base {
    return new Base(new SourceTree(dir, BASE_VERSION))
  }

  /** No base: trees are built as they are. */
  static none(): Base {
    return new Base(undefined)
  }

  /** The base as a tree of its own, to build before anything is published; none when there is no base. */
  get alone(): SourceTree | undefined {
    return this.tree
  }

  /** Builds `tree` with the base beneath it, through `build`. Throws `CompileError` when `tree` would override the base. */
  async beneath<T>(
    tree: SourceTree,
    build: (merged: SourceTree) => Promise<T>,
  ): Promise<T> {
    if (this.tree === undefined || tree === this.tree) return build(tree)
    const merged = await this.merge(this.tree, tree)
    try {
      return await build(merged)
    } finally {
      await Deno.remove(merged.dir, { recursive: true }).catch(() => {})
    }
  }

  private async merge(base: SourceTree, tree: SourceTree): Promise<SourceTree> {
    const baseAssociations = await this.associationsOf(base)
    const associations = await this.associationsOf(tree)
    const basePolicies = await this.packagesIn(base.policiesDir)
    const problems = [
      ...[...await this.packagesIn(tree.policiesDir)]
        .filter((name) => basePolicies.has(name))
        .map((name) =>
          `${name} is a base policy, which only the deployment can change`
        ),
      ...[...associations.keys()]
        .filter((action) => baseAssociations.has(action))
        .map((action) =>
          `policies.yaml: ${action} is governed by the base policies, which only the deployment can change`
        ),
    ]
    if (problems.length > 0) throw new CompileError(problems)

    const merged = new SourceTree(
      await Deno.makeTempDir({ prefix: 'based-' }),
      tree.version,
    )
    await this.copy(tree.dir, merged.dir)
    await Deno.mkdir(merged.policiesDir, { recursive: true })
    for (const file of await this.regoFiles(base.policiesDir)) {
      await Deno.copyFile(
        join(base.policiesDir, file),
        join(merged.policiesDir, `${FILE_PREFIX}${file}`),
      )
    }
    await Deno.writeTextFile(
      merged.registryPath,
      JSON.stringify({
        associations: Object.fromEntries([
          ...baseAssociations,
          ...associations,
        ]),
      }),
    )
    return merged
  }

  /** Action → the names of the policies governing it. Throws `CompileError` when the registry is missing or malformed. */
  private async associationsOf(
    tree: SourceTree,
  ): Promise<Map<string, string[]>> {
    let text: string
    try {
      text = await Deno.readTextFile(tree.registryPath)
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new CompileError([`${basename(tree.registryPath)} is missing`])
      }
      throw error
    }
    try {
      const parsed = new Policy.Registries.Associations().parse(text)
      return new Map(
        [...parsed].map(([action, policies]) => [action, policies.map(String)]),
      )
    } catch (error) {
      throw new CompileError([
        `policies.yaml: ${error instanceof Error ? error.message : error}`,
      ])
    }
  }

  /** The packages the `.rego` files in `dir` declare. */
  private async packagesIn(dir: string): Promise<Set<string>> {
    const packages = new Set<string>()
    for (const file of await this.regoFiles(dir)) {
      const declared = (await Deno.readTextFile(join(dir, file))).match(
        /^package\s+([\w.]+)/m,
      )?.[1]
      if (declared !== undefined) packages.add(declared)
    }
    return packages
  }

  private async regoFiles(dir: string): Promise<string[]> {
    const files: string[] = []
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isFile && entry.name.endsWith('.rego')) files.push(entry.name)
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error
    }
    return files
  }

  /** Copies the tree in `from` into `to`; trees are small, plain files. */
  private async copy(from: string, to: string): Promise<void> {
    const pending = ['']
    while (pending.length > 0) {
      const relative = pending.pop()!
      await Deno.mkdir(join(to, relative), { recursive: true })
      for await (const entry of Deno.readDir(join(from, relative))) {
        const path = join(relative, entry.name)
        if (entry.isDirectory) pending.push(path)
        if (entry.isFile) await Deno.copyFile(join(from, path), join(to, path))
      }
    }
  }
}

import { basename } from '@std/path'
import * as Distribution from '@idhn/distribution'
import * as Judge from '@idhn/judge'
import * as Policy from '@idhn/policy'
import { type Opa, OpaError } from './opa.ts'
import type { SourceTree } from './source-tree.ts'

/** Why a source tree could not become a policy set — every problem found, for whoever published it. */
export class CompileError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Policies rejected:\n- ${problems.join('\n- ')}`)
  }
}

const TEST_SUFFIX = '_test.rego'

/**
 * Turns a `SourceTree` into the `PolicySet` judges pull, or refuses it with
 * every reason at once. Beyond what opa itself checks (`opa check`, then
 * `opa test` when there are tests), it holds the conventions judges rely on:
 * every policy the registry names is a package among the policies, and every
 * package is compiled with its `allow` rule as the entrypoint judges evaluate
 * — and its `show` rule too, when it has one, saying how the answer's
 * restricted fields may be shown — the place for any further Rego rules to
 * enforce.
 */
export class Compiler {
  constructor(private readonly opa: Opa) {}

  async compile(tree: SourceTree): Promise<Distribution.PolicySet> {
    const policies = await this.policyFiles(tree)
    const sources = policies.filter((file) => !file.endsWith(TEST_SUFFIX))
    const packages = await this.packagesOf(sources)
    const showing = await this.packagesShowing(sources)
    const registry = await this.readRequired(tree.registryPath)
    const enrichment = await this.readOptional(tree.enrichmentPath)
    const data = await this.readOptional(tree.dataPath)

    // Everything that can be judged without running the policies, all at
    // once, so one refusal lists every problem to fix.
    const problems = [
      ...this.registryProblems(registry, packages),
      ...this.enrichmentProblems(enrichment),
      ...this.dataProblems(data),
      ...await this.opaProblems(() => this.opa.check(tree.policiesDir)),
    ]
    if (problems.length > 0) {
      throw new CompileError(problems)
    }

    // Tests and compilation need policies that check.
    const testProblems = policies.some((file) => file.endsWith(TEST_SUFFIX))
      ? await this.opaProblems(() => this.opa.test(tree.policiesDir))
      : []
    if (testProblems.length > 0) {
      throw new CompileError(testProblems)
    }

    let bundle: Uint8Array | undefined
    const buildProblems = await this.opaProblems(async () => {
      bundle = await this.opa.build(
        tree.policiesDir,
        [
          ...[...packages].map((name) => `${name.replaceAll('.', '/')}/allow`),
          ...[...showing].map((name) => `${name.replaceAll('.', '/')}/show`),
        ],
      )
    })
    if (bundle === undefined) {
      throw new CompileError(buildProblems)
    }

    return new Distribution.PolicySet(
      tree.version,
      bundle,
      registry,
      enrichment,
      data,
    )
  }

  /** What opa reported as wrong while doing `step`, if anything. */
  private async opaProblems(step: () => Promise<void>): Promise<string[]> {
    try {
      await step()
      return []
    } catch (error) {
      if (error instanceof OpaError) return [error.message]
      throw error
    }
  }

  private async policyFiles(tree: SourceTree): Promise<string[]> {
    const files: string[] = []
    try {
      for await (const entry of Deno.readDir(tree.policiesDir)) {
        if (entry.isFile && entry.name.endsWith('.rego')) {
          files.push(`${tree.policiesDir}/${entry.name}`)
        }
      }
    } catch (error) {
      throw new CompileError([
        `no policies directory: ${
          error instanceof Error ? error.message : error
        }`,
      ])
    }
    if (files.length === 0) {
      throw new CompileError(['no .rego files in policies/'])
    }
    return files.sort()
  }

  /**
   * The packages declaring a `show` rule. opa refuses an entrypoint naming no
   * rule, so only these get one; a rule is spotted by its head at the start
   * of a line (`show[…] := …`, `show := …`, `show contains …`).
   */
  private async packagesShowing(
    files: readonly string[],
  ): Promise<Set<string>> {
    const showing = new Set<string>()
    for (const file of files) {
      const source = await Deno.readTextFile(file)
      const declared = source.match(/^package\s+([\w.]+)/m)?.[1]
      if (declared !== undefined && /^show\b/m.test(source)) {
        showing.add(declared)
      }
    }
    return showing
  }

  /** The package each policy file declares — the policy's name. */
  private async packagesOf(files: readonly string[]): Promise<Set<string>> {
    const packages = new Set<string>()
    for (const file of files) {
      const declared = (await Deno.readTextFile(file)).match(
        /^package\s+([\w.]+)/m,
      )?.[1]
      if (declared === undefined) {
        throw new CompileError([`${basename(file)} declares no package`])
      }
      packages.add(declared)
    }
    return packages
  }

  private registryProblems(
    registry: string,
    packages: ReadonlySet<string>,
  ): string[] {
    try {
      const associations = new Policy.Registries.Associations().parse(registry)
      return [...associations]
        .flatMap(([action, governing]) =>
          governing
            .filter((policy) => !packages.has(policy.toString()))
            .map((policy) =>
              `policies.yaml: ${action} is governed by ${policy}, which no policy file declares`
            )
        )
    } catch (error) {
      return [
        `policies.yaml: ${error instanceof Error ? error.message : error}`,
      ]
    }
  }

  private enrichmentProblems(enrichment: string | undefined): string[] {
    if (enrichment === undefined) return []
    try {
      new Judge.Enrichers.Definitions().parse(enrichment)
      return []
    } catch (error) {
      return [
        `enrichment.yaml: ${error instanceof Error ? error.message : error}`,
      ]
    }
  }

  private dataProblems(data: string | undefined): string[] {
    if (data === undefined) return []
    try {
      JSON.parse(data)
      return []
    } catch (error) {
      return [`data.json: ${error instanceof Error ? error.message : error}`]
    }
  }

  private async readRequired(path: string): Promise<string> {
    const text = await this.readOptional(path)
    if (text === undefined) {
      throw new CompileError([`${basename(path)} is missing`])
    }
    return text
  }

  private async readOptional(path: string): Promise<string | undefined> {
    try {
      return await Deno.readTextFile(path)
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined
      throw error
    }
  }
}

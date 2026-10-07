import { Delegate, type Emitter } from '@duesabati/evento'
import type * as Distribution from '@idhn/distribution'
import { CompileError, type Compiler } from './compiler.ts'
import type { SourceTree } from './source-tree.ts'

/** How one build went: the set now published, or every reason the sources were refused. */
export type BuildOutcome =
  | { built: true; set: Distribution.PolicySet }
  | { built: false; version: string; problems: readonly string[] }

/** How a dry run went: whether the sources would build, and every reason they wouldn't. */
export type CheckOutcome =
  | { passed: true }
  | { passed: false; problems: readonly string[] }

/**
 * Builds source trees into policy sets and publishes each one that compiles,
 * so judges pull it from then on. One that doesn't compile is refused and
 * published nothing: judges keep the last good set. Builds never overlap —
 * one asked for while another runs waits for it — so the last source tree
 * asked for is always the last one published.
 *
 * Every outcome is announced on `OnBuilt` or `OnRefused`, and returned to
 * whoever asked (an upload, answered with it). A `check` builds without
 * publishing, announces nothing, and need not wait for builds.
 */
export class Builds {
  private readonly built = new Delegate<[Distribution.PolicySet]>()
  private readonly refused = new Delegate<[string, readonly string[]]>()
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly compiler: Compiler,
    private readonly publication: Distribution.Publication,
  ) {}

  get OnBuilt(): Emitter<[Distribution.PolicySet]> {
    return this.built
  }

  get OnRefused(): Emitter<[string, readonly string[]]> {
    return this.refused
  }

  /** Whether `tree` would build — every reason it wouldn't, if not — publishing nothing. */
  async check(tree: SourceTree): Promise<CheckOutcome> {
    try {
      await this.compiler.compile(tree)
      return { passed: true }
    } catch (error) {
      if (!(error instanceof CompileError)) throw error
      return { passed: false, problems: error.problems }
    }
  }

  /** Build `tree` and, if it compiles, publish it. */
  build(tree: SourceTree): Promise<BuildOutcome> {
    const outcome = this.queue.then(() => this.buildNow(tree))
    this.queue = outcome.catch(() => {})
    return outcome
  }

  private async buildNow(tree: SourceTree): Promise<BuildOutcome> {
    try {
      const set = await this.compiler.compile(tree)
      this.publication.publish(set)
      this.built.Invoke(set)
      return { built: true, set }
    } catch (error) {
      if (!(error instanceof CompileError)) throw error
      this.refused.Invoke(tree.version, error.problems)
      return { built: false, version: tree.version, problems: error.problems }
    }
  }
}

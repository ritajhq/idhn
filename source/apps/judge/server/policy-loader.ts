import { Delegate, type Emitter } from '@duesabati/evento'
import type * as Distribution from '@idhn/distribution'
import type * as Judge from '@idhn/judge'
import type { JudgeAssembly } from './judge-assembly.ts'

/**
 * Builds a judge from each policy set it is given and hands it to the running
 * `Judge.Reloadable`. A set that fails to build leaves the judge it already
 * has in place, so a bad set never takes the judge down — it keeps judging
 * with the last good one, or stays unavailable if there has never been one.
 * Loads never overlap, and happen in the order the sets were given, so the
 * last set given is the one judged with.
 */
export class PolicyLoader {
  private readonly loaded = new Delegate<[Distribution.PolicySet]>()
  private readonly failed = new Delegate<[Distribution.PolicySet, unknown]>()
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly assembly: JudgeAssembly,
    private readonly judge: Judge.Reloadable,
  ) {}

  get OnLoaded(): Emitter<[Distribution.PolicySet]> {
    return this.loaded
  }

  get OnFailed(): Emitter<[Distribution.PolicySet, unknown]> {
    return this.failed
  }

  /** Judge with `set` from now on, once it has been built; settles once it has, or failed to. */
  load(set: Distribution.PolicySet): Promise<void> {
    this.queue = this.queue.then(() => this.loadNow(set))
    return this.queue
  }

  private async loadNow(set: Distribution.PolicySet): Promise<void> {
    try {
      this.judge.replace(await this.assembly.assemble(set))
      this.loaded.Invoke(set)
    } catch (error) {
      this.failed.Invoke(set, error)
    }
  }
}

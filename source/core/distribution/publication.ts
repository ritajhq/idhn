import { Delegate, type Emitter } from '@duesabati/evento'
import type { PolicySet } from './policy-set.ts'

/**
 * The policy set currently offered to judges — the last one published — or
 * none yet. Publishing replaces it for every judge that asks from then on,
 * announced on `OnPublished`.
 */
export class Publication {
  private readonly published = new Delegate<[PolicySet]>()
  private set: PolicySet | undefined

  get OnPublished(): Emitter<[PolicySet]> {
    return this.published
  }

  /** What judges are offered now, if anything has been published yet. */
  get current(): PolicySet | undefined {
    return this.set
  }

  /** Offer `set` to judges from now on. */
  publish(set: PolicySet): void {
    this.set = set
    this.published.Invoke(set)
  }
}

import type { Identifier } from './identifier.ts'
import type { Verdict } from './verdict.ts'

/** The outcome of evaluating one policy against a `Context`. */
export class Result {
  readonly policy: Identifier
  readonly verdict: Verdict

  constructor(policy: Identifier, verdict: Verdict) {
    this.policy = policy
    this.verdict = verdict
  }
}

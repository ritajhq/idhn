import type { Policy } from './policy.ts'
import type { Verdict } from './verdict.ts'

/** The outcome of evaluating one `Policy` against a `Context`. */
export class PolicyResult {
  readonly policy: Policy
  readonly verdict: Verdict

  constructor(policy: Policy, verdict: Verdict) {
    this.policy = policy
    this.verdict = verdict
  }
}

import type { DecisionStrategy } from './decision-strategy.ts'
import { Decision } from './decision.ts'
import * as Policy from '@idhn/policy'

/**
 * Any explicit `Deny` wins. Otherwise allows only if at least one policy
 * explicitly `Allow`ed. When there are no results, or all results are
 * `Neutral`, falls back to a caller-supplied default `Decision` — there's
 * no universally correct answer for "nothing governed this action".
 */
export class DenyOverridesStrategy implements DecisionStrategy {
  constructor(readonly fallback: Decision) {}

  combine(results: readonly Policy.Result[]): Decision {
    const applicable = results.filter((result) =>
      result.verdict !== Policy.Verdict.Neutral
    )
    if (applicable.length === 0) {
      return this.fallback
    }

    const denied = applicable.some((result) =>
      result.verdict === Policy.Verdict.Deny
    )
    return new Decision(!denied, results)
  }
}

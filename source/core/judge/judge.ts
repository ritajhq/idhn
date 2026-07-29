import type { Action } from './action.ts'
import type { Context } from './context.ts'
import type { Decision } from './decision.ts'
import type { DecisionStrategy } from './decision-strategy.ts'
import type { PolicyEngine } from './policy-engine.ts'
import type { PolicyResult } from './policy-result.ts'
import type { PolicyRepository } from './policy-repository.ts'

/**
 * Answers "is this action allowed?" by resolving the policies that govern
 * it, evaluating each, and combining the results into one `Decision`. Holds
 * no infrastructure of its own — every collaborator is injected as an
 * interface.
 */
export class Judge {
  constructor(
    private readonly policies: PolicyRepository,
    private readonly engine: PolicyEngine,
    private readonly strategy: DecisionStrategy,
  ) {}

  async decide(action: Action, context: Context): Promise<Decision> {
    const policies = await this.policies.findPoliciesFor(action)
    const results: PolicyResult[] = await Promise.all(
      policies.map((policy) => this.engine.evaluate(policy, context)),
    )
    return this.strategy.combine(results)
  }
}

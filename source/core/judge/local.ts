import type * as Access from '@idhn/access'
import type * as Policy from '@idhn/policy'
import type { Decision } from './decision.ts'
import type { DecisionStrategy } from './decision-strategy.ts'
import type { Behavior } from './behavior.ts'
import type { Enricher } from './enricher.ts'

/**
 * Answers "is this action allowed?" in-process, by resolving the policies
 * that govern it, enriching the context with whatever facts those policies
 * can't get from the request alone, evaluating each policy, and combining the
 * results into one `Decision`. Holds no infrastructure of its own — every
 * collaborator is injected as an interface.
 */
export class Local implements Behavior {
  constructor(
    private readonly policies: Policy.Repository,
    private readonly engine: Policy.Engine,
    private readonly strategy: DecisionStrategy,
    private readonly enricher: Enricher,
  ) {}

  async decide(
    action: Access.Action,
    context: Access.Context,
  ): Promise<Decision> {
    const policies = await this.policies.findPoliciesFor(action)
    if (policies.length === 0) {
      return this.strategy.combine([])
    }

    const enriched = await this.enricher.enrich(action, context)
    const results: Policy.Result[] = await Promise.all(
      policies.map((policy) => this.engine.evaluate(policy, enriched)),
    )
    return this.strategy.combine(results)
  }
}

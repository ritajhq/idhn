import { Delegate, type Emitter } from '@duesabati/evento'
import type * as Access from '@idhn/access'
import type * as Policy from '@idhn/policy'
import type { Decision } from './decision.ts'
import type { DecisionRecord } from './decision-record.ts'
import { DecisionRecording } from './decision-recording.ts'
import type { DecisionStrategy } from './decision-strategy.ts'
import type { Behavior } from './behavior.ts'
import type { Enricher } from './enricher.ts'

/**
 * Answers "is this action allowed?" in-process, by resolving the policies
 * that govern it, enriching the context with whatever facts those policies
 * can't get from the request alone, evaluating each policy, and combining the
 * results into one `Decision`. Holds no infrastructure of its own — every
 * collaborator is injected as an interface.
 *
 * Every judgement, including one that fails, is announced on `OnDecision`
 * before `decide` settles, identified by the same id as the `Decision` it
 * returns.
 */
export class Local implements Behavior {
  private readonly decision = new Delegate<[DecisionRecord]>()

  constructor(
    private readonly policies: Policy.Repository,
    private readonly engine: Policy.Engine,
    private readonly strategy: DecisionStrategy,
    private readonly enricher: Enricher,
  ) {}

  get OnDecision(): Emitter<[DecisionRecord]> {
    return this.decision
  }

  async decide(
    action: Access.Action,
    context: Access.Context,
  ): Promise<Decision> {
    const recording = new DecisionRecording(action, context)
    try {
      const decision = (await this.judge(action, context, recording))
        .identifiedAs(recording.decisionId)
      this.decision.Invoke(recording.decided(decision))
      return decision
    } catch (error) {
      this.decision.Invoke(recording.failed(error))
      throw error
    }
  }

  private async judge(
    action: Access.Action,
    context: Access.Context,
    recording: DecisionRecording,
  ): Promise<Decision> {
    const policies = await this.policies.findPoliciesFor(action)
    if (policies.length === 0) {
      return this.strategy.combine([])
    }

    const enriched = await this.enricher.enrich(action, context)
    recording.evaluatedAgainst(enriched)
    const results: Policy.Result[] = await Promise.all(
      policies.map((policy) => this.engine.evaluate(policy, enriched)),
    )
    return this.strategy.combine(results)
  }
}

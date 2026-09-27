import { Delegate, type Emitter } from '@duesabati/evento'
import type * as Access from '@idhn/access'
import type * as Policy from '@idhn/policy'
import type { Decision } from './decision.ts'
import type { DecisionRecord } from './decision-record.ts'
import { DecisionRecording } from './decision-recording.ts'
import type { DecisionStrategy } from './decision-strategy.ts'
import type { Behavior } from './behavior.ts'
import type { Enricher } from './enricher.ts'
import type { Deadline } from './deadline.ts'
import { UnavailableError } from './unavailable-error.ts'

/**
 * Answers "is this action allowed?" in-process, by resolving the policies
 * that govern it, enriching the context with whatever facts those policies
 * can't get from the request alone, evaluating each policy, and combining the
 * results into one `Decision`. Holds no infrastructure of its own — every
 * collaborator is injected as an interface.
 *
 * Every judgement, including one that fails, is announced on `OnDecision`
 * before `decide` settles, identified by the same id as the `Decision` it
 * returns — or, when it fails for being temporarily unavailable, as the
 * `UnavailableError` it throws.
 *
 * Every judgement is reached by the asker's deadline — or `maxMs`, if that
 * comes first — or not at all: past it, the enrichers are told to abandon
 * what they are still gathering, and the judgement fails as unavailable right
 * away, whether or not they listen. The asker therefore always gets an
 * answer while it is still waiting, and the id of the judgement it was about.
 */
export class Local implements Behavior {
  private readonly decision = new Delegate<[DecisionRecord]>()

  constructor(
    private readonly policies: Policy.Repository,
    private readonly engine: Policy.Engine,
    private readonly strategy: DecisionStrategy,
    private readonly enricher: Enricher,
    /** The longest any judgement may take, whatever the asker would wait. */
    private readonly maxMs: number = Number.POSITIVE_INFINITY,
  ) {}

  get OnDecision(): Emitter<[DecisionRecord]> {
    return this.decision
  }

  async decide(
    action: Access.Action,
    context: Access.Context,
    askersDeadline: Deadline,
  ): Promise<Decision> {
    const recording = new DecisionRecording(action, context)
    const deadline = askersDeadline.within(this.maxMs)
    try {
      const decision = (await this.withinDeadline(
        this.judge(action, context, recording, deadline),
        deadline,
      )).identifiedAs(recording.decisionId)
      this.decision.Invoke(recording.decided(decision))
      return decision
    } catch (error) {
      const failure = deadline.passed
        ? this.pastDeadline(error, deadline)
        : error
      this.decision.Invoke(recording.failed(failure))
      if (failure instanceof UnavailableError) {
        throw failure.identifiedAs(recording.decisionId)
      }
      throw failure
    }
  }

  /** `judgement`'s outcome, or a rejection as soon as `deadline` aborts, whichever comes first. A judgement still running then is left to settle unobserved. */
  private withinDeadline<T>(
    judgement: Promise<T>,
    deadline: Deadline,
  ): Promise<T> {
    const { signal } = deadline
    return new Promise<T>((resolve, reject) => {
      const abandon = () => reject(signal.reason)
      signal.addEventListener('abort', abandon, { once: true })
      judgement.then(resolve, reject).finally(() =>
        signal.removeEventListener('abort', abandon)
      )
    })
  }

  private pastDeadline(error: unknown, deadline: Deadline): UnavailableError {
    return new UnavailableError(
      `The judgement was not reached within ${deadline.ms}ms`,
      { cause: error },
    )
  }

  private async judge(
    action: Access.Action,
    context: Access.Context,
    recording: DecisionRecording,
    deadline: Deadline,
  ): Promise<Decision> {
    const policies = await this.policies.findPoliciesFor(action)
    if (policies.length === 0) {
      return this.strategy.combine([])
    }

    const enriched = await this.enricher.enrich(
      action,
      context,
      deadline.signal,
    )
    recording.evaluatedAgainst(enriched)
    const results: Policy.Result[] = await Promise.all(
      policies.map((policy) => this.engine.evaluate(policy, enriched)),
    )
    return this.strategy.combine(results)
  }
}

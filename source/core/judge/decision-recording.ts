import type * as Access from '@idhn/access'
import type { Decision } from './decision.ts'
import { DecisionRecord } from './decision-record.ts'

/**
 * Keeps track of one judgement while it is being made — its id, when it
 * started, and the context the policies were actually evaluated against — so
 * a `DecisionRecord` can be produced however it ends.
 */
export class DecisionRecording {
  readonly decisionId = crypto.randomUUID()
  private readonly startedAt = new Date()
  private readonly start = performance.now()
  private evaluated: Access.Context

  constructor(
    private readonly action: Access.Action,
    context: Access.Context,
  ) {
    this.evaluated = context
  }

  /** The context the policies are evaluated against, once enrichment has added to it. */
  evaluatedAgainst(context: Access.Context): void {
    this.evaluated = context
  }

  decided(decision: Decision): DecisionRecord {
    return DecisionRecord.decided(
      this.decisionId,
      this.startedAt,
      this.elapsedMs(),
      this.action,
      this.evaluated,
      decision,
    )
  }

  failed(error: unknown): DecisionRecord {
    return DecisionRecord.failed(
      this.decisionId,
      this.startedAt,
      this.elapsedMs(),
      this.action,
      this.evaluated,
      error,
    )
  }

  private elapsedMs(): number {
    return Math.round((performance.now() - this.start) * 1000) / 1000
  }
}

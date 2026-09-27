import type * as Access from '@idhn/access'
import type * as Policy from '@idhn/policy'
import type { Decision } from './decision.ts'

export type DecisionOutcome = 'allowed' | 'denied' | 'failed'

/** One policy's say in a judgement, as recorded. */
export interface RecordedResult {
  readonly policy: string
  readonly verdict: Policy.Verdict
}

/**
 * What happened when one action was judged: the context the policies saw,
 * each policy's verdict and the outcome, or why no outcome was reached. Plain,
 * self-describing data, so it can be serialized as a structured log entry.
 */
export class DecisionRecord {
  private constructor(
    readonly decisionId: string,
    readonly timestamp: string,
    readonly durationMs: number,
    readonly action: string,
    readonly context: Readonly<Record<string, unknown>>,
    readonly outcome: DecisionOutcome,
    readonly results: readonly RecordedResult[],
    readonly error: string | undefined,
  ) {}

  static decided(
    decisionId: string,
    startedAt: Date,
    durationMs: number,
    action: Access.Action,
    context: Access.Context,
    decision: Decision,
  ): DecisionRecord {
    return new DecisionRecord(
      decisionId,
      startedAt.toISOString(),
      durationMs,
      action.name,
      context.facts,
      decision.allowed ? 'allowed' : 'denied',
      decision.results.map((result) => ({
        policy: result.policy.toString(),
        verdict: result.verdict,
      })),
      undefined,
    )
  }

  static failed(
    decisionId: string,
    startedAt: Date,
    durationMs: number,
    action: Access.Action,
    context: Access.Context,
    error: unknown,
  ): DecisionRecord {
    return new DecisionRecord(
      decisionId,
      startedAt.toISOString(),
      durationMs,
      action.name,
      context.facts,
      'failed',
      [],
      error instanceof Error ? error.message : String(error),
    )
  }
}

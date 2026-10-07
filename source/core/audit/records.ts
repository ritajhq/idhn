import type { Source } from './stamp.ts'

export type RequestOutcome = 'forwarded' | 'rejected' | 'failed'
export type DecisionOutcome = 'allowed' | 'denied' | 'unavailable' | 'failed'
export type Verdict = 'allow' | 'deny' | 'neutral'

/** Who was behind a request: enough to attribute it. */
export interface Identity {
  readonly status: string
  readonly subject: string | undefined
}

/** One policy's say in a decision. */
export interface Result {
  readonly policy: string
  readonly verdict: Verdict
}

/** What a guard did with one request, as its `guard.request` line said. */
export class Request {
  constructor(
    readonly recordId: string,
    readonly timestamp: Date,
    readonly durationMs: number,
    readonly outcome: RequestOutcome,
    /** The resource the guard guards: the action's first segment, or the guard's own when no action matched. */
    readonly resource: string | undefined,
    readonly action: string | undefined,
    readonly identity: Identity | undefined,
    readonly decisionId: string | undefined,
    readonly rejection: string | undefined,
    readonly error: string | undefined,
    readonly method: string | undefined,
    readonly path: string | undefined,
    readonly source: Source | undefined,
  ) {}
}

/** How a judge decided one action, as its `judge.decision` line said, its context redacted. */
export class Decision {
  constructor(
    readonly recordId: string,
    readonly decisionId: string,
    readonly timestamp: Date,
    readonly durationMs: number,
    readonly action: string,
    readonly context: Readonly<Record<string, unknown>>,
    readonly outcome: DecisionOutcome,
    readonly results: readonly Result[],
    readonly error: string | undefined,
    readonly source: Source | undefined,
  ) {}

  /** The policies that denied it. */
  get denyingPolicies(): string[] {
    return this.results.filter((result) => result.verdict === 'deny')
      .map((result) => result.policy)
  }
}

/** A request with the decision it got, if a judge was asked: the two arrive separately and are joined by `decisionId`. */
export class Trail {
  constructor(
    readonly request: Request,
    readonly decision: Decision | undefined,
  ) {}
}

/** The resource an action belongs to: a manifest id is one identifier, so the first segment of every action it declares. */
export function resourceOf(action: string): string {
  return action.split('.')[0]
}

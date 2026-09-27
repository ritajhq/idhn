import type * as Access from '@idhn/access'
import type { Rejection } from './rejection.ts'

export type RequestOutcome = 'forwarded' | 'rejected' | 'failed'

/**
 * What a `Guard` did with one request: the action it resolved to, who was
 * behind it, the judgement it got — by id, to match the judge's own record of
 * how it was reached — and whether it was forwarded, rejected and why, or
 * failed. Plain, self-describing data, so it can be serialized as a structured
 * log entry. Fields the guard never got to (no action matched, the judge was
 * unreachable) are left out.
 */
export class RequestRecord {
  constructor(
    readonly timestamp: string,
    readonly durationMs: number,
    readonly outcome: RequestOutcome,
    readonly action: string | undefined,
    readonly identity: RecordedIdentity | undefined,
    readonly decisionId: string | undefined,
    readonly rejection: Rejection | undefined,
    readonly error: string | undefined,
  ) {}
}

/** Who was behind a request, as recorded: enough to attribute it, without the claims the judge's record already carries. */
export interface RecordedIdentity {
  readonly status: Access.IdentityStatus
  readonly subject: string | undefined
}

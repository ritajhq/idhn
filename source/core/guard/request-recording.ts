import type * as Access from '@idhn/access'
import type * as Judge from '@idhn/judge'
import type { Rejection } from './rejection.ts'
import { type RequestOutcome, RequestRecord } from './request-record.ts'

/**
 * Keeps track of one request while a `Guard` handles it, told each step as
 * it happens, so a `RequestRecord` can be produced however far it got.
 */
export class RequestRecording {
  private readonly startedAt = new Date()
  private readonly start = performance.now()
  private outcome: RequestOutcome = 'failed'
  private action: Access.Action | undefined
  private identity: Access.Identity | undefined
  private decisionId: string | undefined
  private rejection: Rejection | undefined
  private error: string | undefined

  resolved(action: Access.Action): void {
    this.action = action
  }

  authenticated(identity: Access.Identity): void {
    this.identity = identity
  }

  judged(decision: Judge.Decision): void {
    this.decisionId = decision.id
  }

  /** The judge could not answer for now: the request is about to be rejected as unavailable. */
  unavailable(error: Judge.UnavailableError): void {
    this.decisionId = error.decisionId
    this.error = error.message
  }

  forwarded(): void {
    this.outcome = 'forwarded'
  }

  rejected(rejection: Rejection): void {
    this.outcome = 'rejected'
    this.rejection = rejection
  }

  /** The protected service could not be reached: the request is about to be answered as unreachable. */
  unreachable(error: Error): void {
    this.error = error.message
  }

  /** The service's answer could not be restricted: the request is about to be answered as withheld. */
  withheld(error: Error): void {
    this.error = error.message
  }

  failed(error: unknown): void {
    this.outcome = 'failed'
    this.error = error instanceof Error ? error.message : String(error)
  }

  toRecord(): RequestRecord {
    return new RequestRecord(
      this.startedAt.toISOString(),
      Math.round((performance.now() - this.start) * 1000) / 1000,
      this.outcome,
      this.action?.name,
      this.identity === undefined ? undefined : {
        status: this.identity.status,
        subject: this.identity.subject,
      },
      this.decisionId,
      this.rejection,
      this.error,
    )
  }
}

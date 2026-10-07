import { Rejection } from '../rejection.ts'
import type { RejectResponse } from './reject-responses/reject-response.ts'

/** How each reason for rejecting a request is said in HTTP. */
const REJECTION_STATUS: Readonly<Record<Rejection, number>> = {
  [Rejection.Forbidden]: 403,
  [Rejection.Unauthenticated]: 401,
  [Rejection.Unavailable]: 503,
  [Rejection.Unreachable]: 502,
  [Rejection.Withheld]: 502,
}

/** How long a caller is told to wait before trying again after a `503`. */
const RETRY_AFTER_SECONDS = 5

/** Headers each reason for rejecting a request calls for: only unavailability says when to try again. */
const REJECTION_HEADERS: Readonly<Record<Rejection, HeadersInit>> = {
  [Rejection.Forbidden]: {},
  [Rejection.Unauthenticated]: {},
  [Rejection.Unavailable]: { 'retry-after': String(RETRY_AFTER_SECONDS) },
  [Rejection.Unreachable]: {},
  [Rejection.Withheld]: {},
}

/**
 * Says a rejection in HTTP, with the injected `RejectResponse` as its body:
 * `403` forbidden, `401` unauthenticated, `503` with `Retry-After` when the
 * caller's identity or the judgement could not be had for now, `502` when
 * the protected service could not be reached or its answer had to be
 * withheld.
 */
export class RejectionAnswers {
  constructor(private readonly rejectResponse: RejectResponse) {}

  answer(rejection: Rejection): Response {
    return this.rejectResponse.toResponse(
      REJECTION_STATUS[rejection],
      REJECTION_HEADERS[rejection],
    )
  }
}

import type * as Disclosure from '@idhn/disclosure'

/**
 * How many milliseconds the caller of `POST /decide` will still wait for its
 * answer, measured when the request is sent. Relative rather than a point in
 * time, so the two processes' clocks never need to agree.
 */
export const DEADLINE_HEADER = 'x-deadline-ms'

/** The `POST /decide` request/response bodies shared by the client and the handler. */
export interface DecideRequestBody {
  action: string
  context: Record<string, unknown>
}

/** The `503` body of a judgement that was temporarily unavailable. */
export interface UnavailableResponseBody {
  decisionId?: string
}

export interface DecideResponseBody {
  allowed: boolean
  /** Identifies the judgement, so the caller's records can be matched against the judge's. */
  decisionId?: string
  /** How much of the answer's restricted fields the caller may see, when any policy said: `{ "<pointer>": <presentation> }`. */
  disclosure?: Record<string, Disclosure.PresentationSpec>
}

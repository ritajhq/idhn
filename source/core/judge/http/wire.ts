/** The `POST /decide` request/response bodies shared by the client and the handler. */
export interface DecideRequestBody {
  action: string
  context: Record<string, unknown>
}

export interface DecideResponseBody {
  allowed: boolean
  /** Identifies the judgement, so the caller's records can be matched against the judge's. */
  decisionId?: string
}

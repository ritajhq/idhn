/** The `POST /decide` request/response bodies shared by the client and the handler. */
export interface DecideRequestBody {
  action: string
  context: Record<string, unknown>
}

export interface DecideResponseBody {
  allowed: boolean
}

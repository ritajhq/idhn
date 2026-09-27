/** What a `Guard` answers with when a request is rejected. Polymorphic so a service with no custom page needs no special-casing. */
export interface RejectResponse {
  /** The rejection as an HTTP response with `status` (401, 403 or 503, depending on why the request was rejected) and any `headers` that reason calls for. */
  toResponse(status: number, headers?: HeadersInit): Response
}

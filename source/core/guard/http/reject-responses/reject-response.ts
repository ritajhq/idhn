/** What a `Guard` answers with when a request is rejected. Polymorphic so a service with no custom page needs no special-casing. */
export interface RejectResponse {
  toResponse(): Response
}

export const REJECT_STATUS = 403

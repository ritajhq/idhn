import { REJECT_STATUS, type RejectResponse } from './reject-response.ts'

/** A rejection with no body: a bare empty `403`. What a service gets when it configures no custom page. */
export class Bare implements RejectResponse {
  toResponse(): Response {
    return new Response(null, { status: REJECT_STATUS })
  }
}

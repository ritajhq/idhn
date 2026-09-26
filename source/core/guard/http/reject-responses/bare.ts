import type { RejectResponse } from './reject-response.ts'

/** A rejection with no body, just its status. What a service gets when it configures no custom page. */
export class Bare implements RejectResponse {
  toResponse(status: number): Response {
    return new Response(null, { status })
  }
}

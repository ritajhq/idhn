import type { RejectResponse } from './reject-response.ts'

/** A rejection serving a fixed body, e.g. loaded once at startup from a configured URL. */
export class Served implements RejectResponse {
  constructor(
    private readonly body: Uint8Array<ArrayBuffer>,
    private readonly contentType: string,
  ) {}

  toResponse(status: number): Response {
    return new Response(this.body, {
      status,
      headers: { 'content-type': this.contentType },
    })
  }
}

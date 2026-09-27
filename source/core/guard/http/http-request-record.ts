import { RequestRecord } from '../request-record.ts'

/**
 * A `RequestRecord` for a request that arrived over HTTP, with the method and
 * path the transport-agnostic `Guard` never sees — the only way to tell which
 * request it was when no action matched it.
 */
export class HttpRequestRecord extends RequestRecord {
  readonly method: string
  readonly path: string

  constructor(request: Request, record: RequestRecord) {
    super(
      record.timestamp,
      record.durationMs,
      record.outcome,
      record.action,
      record.identity,
      record.decisionId,
      record.rejection,
      record.error,
    )
    this.method = request.method
    this.path = new URL(request.url).pathname
  }
}

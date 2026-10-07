import type * as Audit from '@idhn/audit'

/** The largest batch taken, far above what shippers send at once. */
const MAX_BATCH_BYTES = 5 * 1024 * 1024

/** How long a shipper told to back off is asked to wait. */
const RETRY_AFTER_SECONDS = 2

/**
 * Where log shippers post records, at `POST /records`: a batch of JSON
 * Lines, answered `200` with what became of it — lines it could not read
 * included, since sending them again would not help. A batch that could not
 * be kept at all is answered `503`, as is one sent while
 * `maxConcurrentBatches` are already being taken in, with `Retry-After`, so
 * the shipper keeps it and tries again: delivery is at least once, and
 * records delivered twice are kept once.
 */
export class Intake {
  private inFlight = 0

  constructor(
    private readonly ingestion: Audit.Ingestion,
    private readonly token: string | undefined,
    private readonly maxConcurrentBatches: number,
  ) {}

  async handle(request: Request): Promise<Response> {
    if (!this.presented(request)) {
      return Response.json({ error: 'a valid ingest token is required' }, {
        status: 401,
      })
    }
    if (this.inFlight >= this.maxConcurrentBatches) return this.backOff()
    this.inFlight++
    try {
      const batch = await request.text()
      if (new TextEncoder().encode(batch).length > MAX_BATCH_BYTES) {
        return Response.json({ error: 'batch too large' }, { status: 413 })
      }
      return Response.json(await this.ingestion.ingest(batch))
    } catch (error) {
      // The store could not keep the batch: the shipper keeps it and retries.
      if (error instanceof Error && !(error instanceof TypeError)) {
        return this.backOff()
      }
      throw error
    } finally {
      this.inFlight--
    }
  }

  private presented(request: Request): boolean {
    if (this.token === undefined) return true
    return request.headers.get('authorization') === `Bearer ${this.token}`
  }

  private backOff(): Response {
    return Response.json({ error: 'busy, try again shortly' }, {
      status: 503,
      headers: { 'retry-after': String(RETRY_AFTER_SECONDS) },
    })
  }
}

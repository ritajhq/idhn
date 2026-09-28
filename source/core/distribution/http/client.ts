import { decodeBase64 } from '@std/encoding/base64'
import { PolicySet } from '../policy-set.ts'
import { POLICIES_PATH, type PolicySetBody } from './wire.ts'

/** A policy builder that couldn't be reached, or answered with no policy set. */
export class FetchError extends Error {}

/** A newer policy set, and the ETag to ask with next time. */
export interface Fetched {
  set: PolicySet
  etag: string
}

/**
 * Pulls the current policy set from a policy builder (see `Server`),
 * remembering the ETag of the last one it got so an unchanged set costs an
 * empty `304`: `fetch()` resolves to the newer set, or to `null` when there is
 * nothing newer. Anything else — unreachable, no answer within `timeoutMs`, an
 * error status, nothing published yet — throws `FetchError`, and the next
 * `fetch()` asks again as if nothing happened.
 */
export class Client {
  private etag: string | undefined

  constructor(
    private readonly builder: URL,
    private readonly timeoutMs: number = 5000,
  ) {}

  async fetch(): Promise<Fetched | null> {
    const response = await this.request()
    if (response.status === 304) {
      return null
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new FetchError(
        `Policy builder at ${this.builder.origin} answered ${response.status}`,
      )
    }

    const etag = response.headers.get('etag') ?? ''
    const body: PolicySetBody = await response.json()
    this.etag = etag
    return {
      etag,
      set: new PolicySet(
        body.version,
        decodeBase64(body.bundle),
        body.registry,
        body.enrichment ?? undefined,
        body.data ?? undefined,
      ),
    }
  }

  private async request(): Promise<Response> {
    try {
      return await fetch(new URL(POLICIES_PATH, this.builder), {
        headers: this.etag === undefined ? {} : { 'if-none-match': this.etag },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new FetchError(
        `Policy builder at ${this.builder.origin} could not be reached`,
        { cause: error },
      )
    }
  }
}

import { encodeBase64 } from '@std/encoding/base64'
import type { Publication } from '../publication.ts'
import type { PolicySet } from '../policy-set.ts'
import { POLICIES_PATH, type PolicySetBody } from './wire.ts'

/**
 * Offers a `Publication`'s current policy set over HTTP, at
 * `GET /policies`, to the judges that pull it: `200` with the set and an
 * `ETag` naming its content, `304` when the asker already has that content
 * (`If-None-Match`), and `503` while nothing has been published yet. Any other
 * request is answered `null`, for the caller to route elsewhere.
 */
export class Server {
  private served: { set: PolicySet; body: string; etag: string } | undefined

  constructor(private readonly publication: Publication) {}

  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url)
    if (url.pathname !== POLICIES_PATH || request.method !== 'GET') {
      return null
    }

    const set = this.publication.current
    if (set === undefined) {
      return new Response('No policies published yet', {
        status: 503,
        headers: { 'retry-after': '5' },
      })
    }

    const { body, etag } = await this.encoded(set)
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { etag } })
    }
    return new Response(body, {
      headers: { 'content-type': 'application/json', etag },
    })
  }

  /** `set` as its body and ETag, encoded once per set rather than per request. */
  private async encoded(set: PolicySet): Promise<{ body: string; etag: string }> {
    if (this.served?.set !== set) {
      const body = JSON.stringify(
        {
          version: set.version,
          bundle: encodeBase64(set.bundle),
          registry: set.registry,
          enrichment: set.enrichment ?? null,
          data: set.data ?? null,
        } satisfies PolicySetBody,
      )
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(body),
      )
      const hex = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
      this.served = { set, body, etag: `"${hex}"` }
    }
    return this.served
  }
}

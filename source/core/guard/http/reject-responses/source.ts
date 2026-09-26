import { Bare } from './bare.ts'
import type { RejectResponse } from './reject-response.ts'
import { Served } from './served.ts'

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
}
const DEFAULT_CONTENT_TYPE = 'application/octet-stream'

/**
 * Where a service's custom rejection page lives — a URL to a local file, S3,
 * a CDN, anything `fetch` can reach — or nowhere. `load()` turns that into a
 * `RejectResponse` either way, so nothing downstream ever handles "no page
 * configured".
 */
export class Source {
  constructor(private readonly url: string | URL | undefined) {}

  async load(): Promise<RejectResponse> {
    if (this.url === undefined) {
      return new Bare()
    }

    const response = await fetch(this.url)
    if (!response.ok) {
      throw new Error(
        `Failed to load reject response from ${this.url}: ${response.status} ${response.statusText}`,
      )
    }
    const body = new Uint8Array(await response.arrayBuffer())
    const contentType = response.headers.get('content-type') ??
      this.inferContentType(this.url)
    return new Served(body, contentType)
  }

  private inferContentType(url: string | URL): string {
    const pathname = typeof url === 'string'
      ? new URL(url).pathname
      : url.pathname
    const extension = pathname.slice(pathname.lastIndexOf('.'))
    return EXTENSION_CONTENT_TYPES[extension] ?? DEFAULT_CONTENT_TYPE
  }
}

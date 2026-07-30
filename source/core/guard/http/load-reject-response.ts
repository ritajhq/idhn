import type { RejectResponse } from './http-service-provider.ts'

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
}
const DEFAULT_CONTENT_TYPE = 'application/octet-stream'

/** Fetches the body/content-type to serve for every rejection from `url` — a local file, S3, a CDN, anything `fetch` can reach. */
export async function loadRejectResponse(
  url: string | URL,
): Promise<RejectResponse> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Failed to load reject response from ${url}: ${response.status} ${response.statusText}`,
    )
  }
  const body = new Uint8Array(await response.arrayBuffer())
  const contentType = response.headers.get('content-type') ??
    inferContentType(url)
  return { body, contentType }
}

function inferContentType(url: string | URL): string {
  const pathname = typeof url === 'string'
    ? new URL(url).pathname
    : url.pathname
  const extension = pathname.slice(pathname.lastIndexOf('.'))
  return EXTENSION_CONTENT_TYPES[extension] ?? DEFAULT_CONTENT_TYPE
}

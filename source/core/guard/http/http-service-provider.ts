import type { ServiceProvider } from '../service-provider.ts'

/** The body served for every rejection, e.g. loaded once at startup from a configured URL (local file, S3, a CDN — anything `fetch` can reach). */
export interface RejectResponse {
  body: Uint8Array<ArrayBuffer>
  contentType: string
}

const DEFAULT_REJECT_STATUS = 403

/**
 * Carries out a `Guard`'s verdict over HTTP: `forward()` reverse-proxies the
 * request to `upstream`, `reject()` answers with `403` and `rejectResponse`'s
 * body (a bare empty `403` if none is configured). Neither method returns
 * anything (per `ServiceProvider`'s contract) — instead, this class is
 * constructed with a `resolve` function (from `Promise.withResolvers()`)
 * that it calls with the eventual `Response`. This lets the HTTP handler
 * that owns the promise return it directly, with no need to read a result
 * back off this instance after `Guard.execute()` resolves — the promise
 * itself is the sole channel back, matching what `ServiceProvider`'s
 * `Promise<void>` methods already promise (nothing).
 */
export class HttpServiceProvider implements ServiceProvider {
  constructor(
    private readonly request: Request,
    private readonly upstream: URL,
    private readonly resolve: (response: Response) => void,
    private readonly rejectResponse?: RejectResponse,
  ) {}

  async forward(): Promise<void> {
    const target = new URL(this.request.url)
    target.protocol = this.upstream.protocol
    target.host = this.upstream.host

    const response = await fetch(target, {
      method: this.request.method,
      headers: this.request.headers,
      body: this.request.body,
      redirect: 'manual',
    })
    this.resolve(response)
  }

  // deno-lint-ignore require-await
  async reject(): Promise<void> {
    if (this.rejectResponse === undefined) {
      this.resolve(new Response(null, { status: DEFAULT_REJECT_STATUS }))
      return
    }
    this.resolve(
      new Response(this.rejectResponse.body, {
        status: DEFAULT_REJECT_STATUS,
        headers: { 'content-type': this.rejectResponse.contentType },
      }),
    )
  }
}

import type { ServiceProvider } from '../service-provider.ts'

/**
 * Carries out a `Guard`'s verdict over HTTP: `forward()` reverse-proxies the
 * request to `upstream`, `reject()` answers with a `403`. Neither method
 * returns anything (per `ServiceProvider`'s contract) — instead, this class
 * is constructed with a `resolve` function (from `Promise.withResolvers()`)
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
    this.resolve(new Response(null, { status: 403 }))
  }
}

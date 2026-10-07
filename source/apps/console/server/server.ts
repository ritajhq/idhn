import type { Server as HttpTransport } from '@ritaj/mux/server/http'

/** The built web app's files, each with its type. */
const ASSETS: Readonly<Record<string, string>> = {
  'main.js': 'text/javascript; charset=utf-8',
  'index.css': 'text/css; charset=utf-8',
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Fluid's primitives (Radix, framer-motion) inject <style> elements at
  // runtime; scripts stay 'self' only.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ')

/** How long a call may take: publishing waits for the builder to check, test and compile. */
const CALL_TIMEOUT_MS = 90_000

/** The built web app, read once at startup. */
export class WebApp {
  private constructor(
    private readonly index: string,
    private readonly assets: ReadonlyMap<string, string>,
  ) {}

  static async load(dist: string): Promise<WebApp> {
    const assets = new Map<string, string>()
    for (const name of Object.keys(ASSETS)) {
      assets.set(name, await Deno.readTextFile(`${dist}/${name}`))
    }
    return new WebApp(await Deno.readTextFile(`${dist}/index.html`), assets)
  }

  asset(name: string): Response {
    const content = this.assets.get(name)
    if (content === undefined) return new Response('Not found', { status: 404 })
    return new Response(content, {
      headers: { 'content-type': ASSETS[name], 'cache-control': 'no-cache' },
    })
  }

  page(): Response {
    return new Response(this.index, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': CSP,
        'x-frame-options': 'DENY',
        'cache-control': 'no-store',
      },
    })
  }
}

/**
 * The console's HTTP surface:
 *
 * - `POST /<message>` takes a call as a horizon message, named by its path
 *   (`POST /policies.write`), so the guard in front of the console matches
 *   each call as an action and its policies decide who may make it;
 * - `GET /assets/<file>` serves the web app's files;
 * - any other `GET` serves the web app's page.
 *
 * It must be reached only through its guard, which says who is calling (see
 * `Mechanisms.CallerHeaders`).
 */
export class Server {
  constructor(
    private readonly transport: HttpTransport,
    private readonly web: WebApp,
  ) {}

  async handle(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (request.method === 'POST') {
      return await this.transport.Handle(request, {
        timeoutMs: CALL_TIMEOUT_MS,
      })
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405 })
    }
    if (pathname.startsWith('/assets/')) {
      return this.web.asset(pathname.slice('/assets/'.length))
    }
    return this.web.page()
  }
}

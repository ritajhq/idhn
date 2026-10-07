import type { Server as HttpTransport } from '@ritaj/mux/server/http'
import type { Intake } from './intake.ts'

/**
 * The audit server's HTTP surface: `POST /records` for log shippers (see
 * `Intake`), `GET /health`, and every other `POST` a horizon audit query
 * from the console, named by its path (`POST /audit.overview`).
 *
 * Queries carry no authentication of their own: keep the audit server on an
 * internal network, reached by the console — which answers to a guard —
 * and by log shippers.
 */
export class Server {
  constructor(
    private readonly intake: Intake,
    private readonly transport: HttpTransport,
  ) {}

  async handle(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/records' && request.method === 'POST') {
      return await this.intake.handle(request)
    }
    if (pathname === '/health' && request.method === 'GET') {
      return Response.json({ ok: true })
    }
    if (request.method === 'POST') {
      return await this.transport.Handle(request)
    }
    return new Response(null, { status: 404 })
  }
}

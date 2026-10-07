import type * as Distribution from '@idhn/distribution'
import type { NoIntake, UploadIntake } from './intake.ts'

/**
 * The policy builder's HTTP surface: `GET /policies` for the judges (see
 * `Distribution.Http.Server`), `PUT /sources` for uploads and `POST /checks`
 * for dry runs of them (both refused by a builder that doesn't take uploads),
 * and `GET /health`, which also says which
 * version is published.
 */
export class Server {
  constructor(
    private readonly policies: Distribution.Http.Server,
    private readonly intake: UploadIntake | NoIntake,
    private readonly publication: Distribution.Publication,
  ) {}

  async handle(request: Request): Promise<Response> {
    const served = await this.policies.handle(request)
    if (served !== null) return served

    const { pathname } = new URL(request.url)
    if (pathname === '/sources' && request.method === 'PUT') {
      return this.intake.handle(request)
    }
    if (pathname === '/checks' && request.method === 'POST') {
      return this.intake.check(request)
    }
    if (pathname === '/health' && request.method === 'GET') {
      return Response.json({ ok: true, published: this.publication.current?.version ?? null })
    }
    return new Response(null, { status: 404 })
  }
}

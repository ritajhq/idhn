import { Delegate, type Emitter } from '@duesabati/evento'
import {
  type Authenticators,
  Guard,
  type HttpManifest,
  HttpManifestActionResolver,
  HttpRequestRecord,
  HttpServiceProvider,
  type RejectResponse,
} from '@idhn/guard'
import type * as Judge from '@idhn/judge'

/**
 * The embedded guard's request handling: for each incoming request, builds
 * an action resolver, an authenticator and a service provider around it and runs `Guard`
 * against the injected `Judge`. Every collaborator is handed in already
 * built — deciding which ones to use (here, a Judge composed in this same
 * process) is `main.ts`'s job.
 *
 * How each request was handled is announced on `OnRequestHandled`, with the
 * HTTP method and path the `Guard` itself never sees.
 */
export class Server {
  private readonly requestHandled = new Delegate<[HttpRequestRecord]>()

  constructor(
    private readonly manifest: HttpManifest,
    private readonly judge: Judge.Behavior,
    private readonly authentication: Authenticators.Scheme,
    private readonly upstreamUrl: URL,
    private readonly rejectResponse: RejectResponse,
  ) {}

  get OnRequestHandled(): Emitter<[HttpRequestRecord]> {
    return this.requestHandled
  }

  async handle(request: Request): Promise<Response> {
    const { promise, resolve } = Promise.withResolvers<Response>()

    const actionResolver = new HttpManifestActionResolver(
      this.manifest,
      request,
    )
    const serviceProvider = new HttpServiceProvider(
      request,
      this.upstreamUrl,
      resolve,
      this.rejectResponse,
    )
    const guard = new Guard(
      this.judge,
      actionResolver,
      this.authentication.authenticatorFor(request),
      serviceProvider,
    )
    guard.OnHandled.Do((record) =>
      this.requestHandled.Invoke(new HttpRequestRecord(request, record))
    )

    await guard.execute()
    return await promise
  }
}

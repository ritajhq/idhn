import { Delegate, type Emitter } from '@duesabati/evento'
import {
  type ActionResolver,
  asksForManifest,
  type Authenticators,
  Guard,
  type HttpManifest,
  HttpManifestActionResolver,
  HttpRequestRecord,
  HttpServiceProvider,
  ManifestActionResolver,
  ManifestServiceProvider,
  type RejectResponse,
  type ServiceProvider,
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
 *
 * A `GET` of `MANIFEST_PATH` asks for the guard's own manifest, which it
 * answers itself once policies allow `<manifest id>.idhn.manifest.read`.
 */
export class Server {
  private readonly requestHandled = new Delegate<[HttpRequestRecord]>()

  constructor(
    private readonly manifest: HttpManifest,
    private readonly judge: Judge.Behavior,
    private readonly authentication: Authenticators.Scheme,
    private readonly upstreamUrl: URL,
    private readonly rejectResponse: RejectResponse,
    private readonly judgeTimeoutMs: number,
  ) {}

  get OnRequestHandled(): Emitter<[HttpRequestRecord]> {
    return this.requestHandled
  }

  async handle(request: Request): Promise<Response> {
    const { promise, resolve } = Promise.withResolvers<Response>()

    const [actionResolver, serviceProvider] = asksForManifest(request)
      ? this.manifestReading(resolve)
      : this.proxying(request, resolve)
    const guard = new Guard(
      this.judge,
      actionResolver,
      this.authentication.authenticatorFor(request),
      serviceProvider,
      this.judgeTimeoutMs,
    )
    guard.OnHandled.Do((record) =>
      this.requestHandled.Invoke(new HttpRequestRecord(request, record))
    )

    await guard.execute()
    return await promise
  }
  /** The guard answers a request for its manifest itself, once judged. */
  private manifestReading(
    resolve: (response: Response) => void,
  ): [ActionResolver, ServiceProvider] {
    return [
      new ManifestActionResolver(this.manifest),
      new ManifestServiceProvider(this.manifest, resolve, this.rejectResponse),
    ]
  }

  /** Any other request is for the protected service, as the manifest maps it. */
  private proxying(
    request: Request,
    resolve: (response: Response) => void,
  ): [ActionResolver, ServiceProvider] {
    return [
      new HttpManifestActionResolver(this.manifest, request),
      new HttpServiceProvider(
        request,
        this.upstreamUrl,
        resolve,
        this.rejectResponse,
      ),
    ]
  }
}

import {
  Guard,
  type HttpManifest,
  HttpManifestActionResolver,
  HttpServiceProvider,
  type RejectResponse,
} from '@idhn/guard'
import type * as Judge from '@idhn/judge'

/**
 * The embedded guard's request handling: for each incoming request, builds
 * an action resolver and a service provider around it and runs `Guard`
 * against the injected `Judge`. Every collaborator is handed in already
 * built — deciding which ones to use XX
 */
export class Server {
  constructor(
    private readonly manifest: HttpManifest,
    private readonly judge: Judge.Behavior,
    private readonly upstreamUrl: URL,
    private readonly rejectResponse: RejectResponse,
  ) {}

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
    const guard = new Guard(this.judge, actionResolver, serviceProvider)

    await guard.execute()
    return await promise
  }
}

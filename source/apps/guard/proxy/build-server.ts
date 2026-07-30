import {
  Guard,
  HttpManifestActionResolver,
  HttpServiceProvider,
  loadManifestFile,
  loadRejectResponse,
  type RejectResponse,
} from '@mithaq/guard'
import { JudgeHttpClient } from '@mithaq/judge'
import type { Config } from './config.ts'

/**
 * Builds everything the server needs once at startup: loads the manifest,
 * a client to the (separate, non-public-facing) judge-server process, and
 * the configured reject response.
 */
export async function buildServer(
  config: Config,
): Promise<(request: Request) => Promise<Response>> {
  const manifest = await loadManifestFile(config.manifestPath)
  const judge = new JudgeHttpClient(config.judgeServerUrl)
  const rejectResponse: RejectResponse | undefined =
    config.rejectResponseUrl === undefined
      ? undefined
      : await loadRejectResponse(config.rejectResponseUrl)

  return async (request: Request): Promise<Response> => {
    const { promise, resolve } = Promise.withResolvers<Response>()

    const actionResolver = new HttpManifestActionResolver(manifest, request)
    const serviceProvider = new HttpServiceProvider(
      request,
      config.upstreamUrl,
      resolve,
      rejectResponse,
    )
    const guard = new Guard(judge, actionResolver, serviceProvider)

    await guard.execute()
    return await promise
  }
}

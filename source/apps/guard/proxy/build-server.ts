import {
  Guard,
  HttpManifestActionResolver,
  HttpServiceProvider,
  loadManifestFile,
  type Manifest,
} from '@mithaq/guard'
import {
  Action,
  Decision,
  DenyOverridesStrategy,
  InMemoryPolicyRegistry,
  Judge,
  Policy,
} from '@mithaq/judge'
import { OpaPolicyEngine } from '@mithaq/judge-opa'
import type { Config } from './config.ts'

/**
 * Builds everything the server needs once at startup: loads the manifest
 * and OPA bundle, and populates a `PolicyRegistry` under the convention
 * that each manifest action is governed by exactly one policy of the same
 * name. That 1:1 convention is a stand-in for a real, pluggable/cached
 * `PolicyRepository` (a separate, later phase) — good enough to prove the
 * request pipeline end-to-end today.
 */
export async function buildServer(
  config: Config,
): Promise<(request: Request) => Promise<Response>> {
  const manifest = await loadManifestFile(config.manifestPath)
  const wasmBytes = await Deno.readFile(config.bundlePath)
  const engine = await OpaPolicyEngine.load(wasmBytes)

  const registry = new InMemoryPolicyRegistry()
  await registerPolicies(registry, manifest)

  const judge = new Judge(
    registry,
    engine,
    new DenyOverridesStrategy(new Decision(false)),
  )

  return async (request: Request): Promise<Response> => {
    const { promise, resolve } = Promise.withResolvers<Response>()

    const actionResolver = new HttpManifestActionResolver(manifest, request)
    const serviceProvider = new HttpServiceProvider(
      request,
      config.upstreamUrl,
      resolve,
    )
    const guard = new Guard(judge, actionResolver, serviceProvider)

    await guard.execute()
    return await promise
  }
}

async function registerPolicies(
  registry: InMemoryPolicyRegistry,
  manifest: Manifest,
): Promise<void> {
  for (const manifestAction of manifest.actions) {
    const action = new Action(`${manifest.id}.${manifestAction.name}`)
    await registry.associate(
      action,
      new Policy(`${manifest.id}.${manifestAction.name}`),
    )
  }
}

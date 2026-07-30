import { loadManifestFile, type Manifest } from '@mithaq/guard'
import {
  Action,
  buildJudgeHandler,
  Decision,
  DenyOverridesStrategy,
  InMemoryPolicyRegistry,
  LocalJudge,
  Policy,
} from '@mithaq/judge'
import { OpaPolicyEngine } from '@mithaq/judge-opa'
import type { Config } from './config.ts'

/**
 * Builds everything the judge-server needs once at startup: loads the
 * manifest and OPA bundle, and populates a `PolicyRegistry` under the same
 * 1:1 convention `guard-proxy` used to stand in for a real, pluggable/cached
 * `PolicyRepository` (a separate, later phase).
 */
export async function buildServer(
  config: Config,
): Promise<(request: Request) => Promise<Response>> {
  const manifest = await loadManifestFile(config.manifestPath)
  const wasmBytes = await Deno.readFile(config.bundlePath)
  const engine = await OpaPolicyEngine.load(wasmBytes)

  const registry = new InMemoryPolicyRegistry()
  await registerPolicies(registry, manifest)

  const judge = new LocalJudge(
    registry,
    engine,
    new DenyOverridesStrategy(new Decision(false)),
  )

  return buildJudgeHandler(judge)
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

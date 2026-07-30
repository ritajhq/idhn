import {
  buildJudgeHandler,
  Decision,
  DenyOverridesStrategy,
  KvPolicyRegistry,
  LocalJudge,
} from '@mithaq/judge'
import { OpaPolicyEngine } from '@mithaq/judge-opa'
import type { Config } from './config.ts'

/**
 * Builds everything the judge-server needs once at startup: the OPA bundle
 * and a `PolicyRegistry` persisted in Deno KV. Action/policy associations
 * are written into that KV store by whatever process owns that integration
 * concern — judge-server only ever reads/serves them.
 */
export async function buildServer(
  config: Config,
): Promise<(request: Request) => Promise<Response>> {
  const wasmBytes = await Deno.readFile(config.bundlePath)
  const engine = await OpaPolicyEngine.load(wasmBytes)

  const kv = await Deno.openKv(config.kvPath)
  const registry = new KvPolicyRegistry(kv)

  const judge = new LocalJudge(
    registry,
    engine,
    new DenyOverridesStrategy(new Decision(false)),
  )

  return buildJudgeHandler(judge)
}

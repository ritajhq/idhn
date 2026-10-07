import * as Distribution from '@idhn/distribution'
import * as Audit from '@idhn/audit'
import * as Judge from '@idhn/judge'
import * as Environment from '@idhn/environment'
import * as Log from '@idhn/log'
import { ConfigLoader, type PoliciesConfig } from './config.ts'
import { JudgeAssembly } from './judge-assembly.ts'
import { PolicyFiles } from './policy-files.ts'
import { PolicyLoader } from './policy-loader.ts'
import { PolicyPuller } from './policy-puller.ts'

const config = new ConfigLoader(new Environment.Reader(Deno.env)).load()
const log = new Log.JsonLines(
  console.log,
  new Audit.Stamp({ app: 'judge', instance: config.instance }).fields,
)

/**
 * The judge the server asks. It judges with the last policy set loaded, and
 * is unavailable (503) until one first is — so the server can start before
 * its policies are published.
 */
const judge = new Judge.Reloadable()
judge.OnDecision.Do((record) => log.write('judge.decision', record))

const loader = new PolicyLoader(new JudgeAssembly(config.maxDecisionMs), judge)
loader.OnLoaded.Do((set) => log.write('judge.policies_loaded', { version: set.version }))
loader.OnFailed.Do((set, error) =>
  log.write('judge.policies_load_failed', {
    version: set.version,
    error: error instanceof Error ? error.message : String(error),
  })
)

/** Where policy sets come from: files read once, or a policy builder pulled from for as long as the judge runs. */
const origins: { [K in PoliciesConfig['kind']]: (policies: Extract<PoliciesConfig, { kind: K }>) => Promise<void> } = {
  files: async (policies) => {
    const files = new PolicyFiles(policies.bundlePath, policies.registryPath, policies.dataPath, policies.enrichmentPath)
    await loader.load(await files.read())
  },
  builder: async (policies) => {
    const puller = new PolicyPuller(new Distribution.Http.Client(policies.url), policies.pollMs)
    puller.OnPolicySet.Do((set) => loader.load(set))
    puller.OnFailed.Do((error) => log.write('judge.policies_pull_failed', { error: error instanceof Error ? error.message : String(error) }))
    puller.OnRecovered.Do(() => log.write('judge.policies_pull_recovered', {}))
    await puller.start()
  },
}
// Each origin takes its own kind's settings; the lookup can't see that
// `config.policies.kind` and `config.policies` agree, so it's told.
await (origins[config.policies.kind] as (policies: PoliciesConfig) => Promise<void>)(config.policies)

const server = new Judge.Http.Server(judge)

Deno.serve(
  {
    port: config.port,
    onError: (error) => {
      log.writeError('judge.error', error)
      return new Response(null, { status: 500 })
    },
  },
  (request) => server.handle(request),
)

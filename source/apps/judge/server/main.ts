import * as Judge from '@idhn/judge'
import * as OPA from '@idhn/opa'
import * as Policy from '@idhn/policy'
import * as Environment from '@idhn/environment'
import * as Log from '@idhn/log'
import { ConfigLoader } from './config.ts'

const config = new ConfigLoader(new Environment.Reader(Deno.env)).load()

/**
 * Rego bundle file.
 */
const bundle = await Deno.readFile(config.bundlePath)

/**
 * Data source file for opa engine.
 */
const data = await new OPA.DataSource(config.policyDataPath).load()

const engine = await OPA.PolicyEngine.load(bundle, data)

const registry = new Policy.Registries.Kv(await Deno.openKv(config.kvPath))
const enricher = await new Judge.Enrichers.Source(config.enrichmentPath).load()
const deny_strategy = new Judge.DenyOverridesStrategy(new Judge.Decision(false))

const judge = new Judge.Local(
  registry,
  engine,
  deny_strategy,
  enricher,
  config.maxDecisionMs,
)

const log = new Log.JsonLines()
judge.OnDecision.Do((record) => log.write('judge.decision', record))

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

import {
  Authenticators,
  Enforcement,
  loadManifestFile,
  RejectResponses,
} from '@idhn/guard'
import * as Judge from '@idhn/judge'
import * as OPA from '@idhn/opa'
import * as Policy from '@idhn/policy'
import * as Environment from '@idhn/environment'
import * as Log from '@idhn/log'
import { ConfigLoader } from './config.ts'
import { Server } from './server.ts'

const configLoader = new ConfigLoader(new Environment.Reader(Deno.env))
const config = configLoader.load()
const enforcement = new Enforcement(config.enforcement)
const log = new Log.JsonLines()

const manifest = await loadManifestFile(config.manifestPath, 'http')
const rejectResponse = await new RejectResponses.Source(
  config.rejectResponseUrl,
).load()

const judge = await enforcement.judge(async () => {
  const judging = configLoader.judging()
  const engine = await OPA.PolicyEngine.load(
    await Deno.readFile(judging.bundlePath),
    await new OPA.DataSource(judging.policyDataPath).load(),
  )
  const registry = await Policy.Registries.File.load(
    judging.policyRegistryPath,
  )
  const enricher = await new Judge.Enrichers.Source(judging.enrichmentPath)
    .load()

  const local = new Judge.Local(
    registry,
    engine,
    new Judge.DenyOverridesStrategy(new Judge.Decision(false)),
    enricher,
  )
  local.OnDecision.Do((record) => log.write('judge.decision', record))
  return local
})

const authentication = enforcement.authentication(
  () =>
    new Authenticators.Schemes({
      none: () => new Authenticators.Anonymous(),
      'session-cookie': (settings) =>
        new Authenticators.SessionCookie(settings),
    }).for(manifest.authentication),
  () => new Authenticators.Anonymous(),
)

const server = new Server(
  manifest,
  judge,
  authentication,
  config.upstreamUrl,
  rejectResponse,
  config.judgeTimeoutMs,
)

log.write('guard.started', { enforcement: config.enforcement })
server.OnRequestHandled.Do((record) => log.write('guard.request', record))

Deno.serve(
  {
    port: config.port,
    onError: (error) => {
      log.writeError('guard.error', error)
      return new Response(null, { status: 500 })
    },
  },
  (request) => server.handle(request),
)

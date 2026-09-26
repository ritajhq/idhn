import { Authenticators, loadManifestFile, RejectResponses } from '@idhn/guard'
import * as Judge from '@idhn/judge'
import * as OPA from '@idhn/opa'
import * as Policy from '@idhn/policy'
import { loadConfig } from './config.ts'
import { Server } from './server.ts'

const config = loadConfig()

const manifest = await loadManifestFile(config.manifestPath, 'http')
const rejectResponse = await new RejectResponses.Source(
  config.rejectResponseUrl,
).load()

const engine = await OPA.PolicyEngine.load(
  await Deno.readFile(config.bundlePath),
  await new OPA.DataSource(config.policyDataPath).load(),
)
const registry = new Policy.Registries.Kv(await Deno.openKv(config.kvPath))
const enricher = await new Judge.Enrichers.Source(config.enrichmentPath).load()

const judge = new Judge.Local(
  registry,
  engine,
  new Judge.DenyOverridesStrategy(new Judge.Decision(false)),
  enricher,
)
const authentication = new Authenticators.Schemes({
  none: () => new Authenticators.Anonymous(),
}).for(manifest.authentication)

const server = new Server(
  manifest,
  judge,
  authentication,
  config.upstreamUrl,
  rejectResponse,
)

Deno.serve({ port: config.port }, (request) => server.handle(request))

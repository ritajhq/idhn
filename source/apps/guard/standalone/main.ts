import { Authenticators, loadManifestFile, RejectResponses } from '@idhn/guard'
import * as Judge from '@idhn/judge'
import * as Environment from '@idhn/environment'
import { ConfigLoader } from './config.ts'
import { Server } from './server.ts'

const config = new ConfigLoader(new Environment.Reader(Deno.env)).load()

const manifest = await loadManifestFile(config.manifestPath, 'http')
const judge = new Judge.Http.Client(config.judgeServerUrl)
const rejectResponse = await new RejectResponses.Source(
  config.rejectResponseUrl,
).load()

const authentication = new Authenticators.Schemes({
  none: () => new Authenticators.Anonymous(),
  'session-cookie': (settings) => new Authenticators.SessionCookie(settings),
}).for(manifest.authentication)

const server = new Server(
  manifest,
  judge,
  authentication,
  config.upstreamUrl,
  rejectResponse,
)

Deno.serve({ port: config.port }, (request) => server.handle(request))

import {
  Authenticators,
  Enforcement,
  loadManifestFile,
  RejectResponses,
} from '@idhn/guard'
import * as Judge from '@idhn/judge'
import * as Environment from '@idhn/environment'
import * as Log from '@idhn/log'
import { ConfigLoader } from './config.ts'
import { Server } from './server.ts'

const configLoader = new ConfigLoader(new Environment.Reader(Deno.env))
const config = configLoader.load()
const enforcement = new Enforcement(config.enforcement)

const manifest = await loadManifestFile(config.manifestPath, 'http')
const judge = await enforcement.judge(() =>
  new Judge.Http.Client(configLoader.judging().judgeServerUrl)
)
const rejectResponse = await new RejectResponses.Source(
  config.rejectResponseUrl,
).load()

const authentication = enforcement.authentication(
  () =>
    new Authenticators.Schemes({
      none: () => new Authenticators.Anonymous(),
      'session-cookie': (settings) =>
        new Authenticators.SessionCookie(settings),
      'session-bearer': (settings) =>
        new Authenticators.SessionBearer(settings),
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

const log = new Log.JsonLines()
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

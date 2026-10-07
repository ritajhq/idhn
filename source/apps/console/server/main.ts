import { DatabaseSync } from 'node:sqlite'
import { dirname } from '@std/path'
import * as Authoring from '@idhn/authoring'
import * as Environment from '@idhn/environment'
import * as Log from '@idhn/log'
import * as Mechanisms from '@idhn/mechanisms'
import * as Resources from '@idhn/resources'
import * as Horizon from '@ritaj/horizon'
import * as MUX from '@ritaj/mux'
import { Client as HttpCourier } from '@ritaj/mux/client/http'
import { Server as HttpTransport } from '@ritaj/mux/server/http'
import { ConfigLoader } from './config.ts'
import { AuditRelay, PolicyDesk, ResourceDesk } from './desks.ts'
import { Server, WebApp } from './server.ts'

const config = new ConfigLoader(
  new Environment.Reader(Deno.env),
  new URL('../../../artifacts/console/web', import.meta.url).pathname,
).load()
const log = new Log.JsonLines()

await Deno.mkdir(dirname(config.databasePath), { recursive: true })
const db = new DatabaseSync(config.databasePath)
const workspace = Authoring.Workspace.open(db)

const resolvers = new Horizon.Resolvers()
const handlers = new Horizon.Handlers()
new ResourceDesk(Resources.Catalog.open(db), new Resources.Importer()).serve(
  resolvers,
  handlers,
)
new PolicyDesk(
  workspace,
  new Authoring.Publishing(workspace, new Authoring.Builder(config.builderUrl)),
).serve(resolvers, handlers)
new AuditRelay(
  new Horizon.Client(new HttpCourier(config.auditUrl.href.replace(/\/$/, '')), {
    timeout: 30_000,
  }),
).serve(resolvers)

const horizon = new Horizon.Server(resolvers, handlers)
horizon.OnCrashed.Do((_message, error, incident) =>
  log.write('console.crashed', {
    incident,
    error: error instanceof Error ? error.message : String(error),
  })
)
const transport = new HttpTransport(
  new MUX.Authentication([new Mechanisms.CallerHeaders()]),
)
horizon.Use(transport)

const server = new Server(transport, await WebApp.load(config.dist))
log.write('console.started', {})

Deno.serve(
  {
    port: config.port,
    onError: (error) => {
      log.writeError('console.error', error)
      return new Response(null, { status: 500 })
    },
  },
  (request) => server.handle(request),
)

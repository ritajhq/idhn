import { DatabaseSync } from 'node:sqlite'
import { dirname } from '@std/path'
import * as Audit from '@idhn/audit'
import * as Disclosure from '@idhn/disclosure'
import * as Environment from '@idhn/environment'
import * as Log from '@idhn/log'
import * as Horizon from '@ritaj/horizon'
import { Server as HttpTransport } from '@ritaj/mux/server/http'
import { ConfigLoader } from './config.ts'
import { Intake } from './intake.ts'
import { Queries } from './queries.ts'
import { Server } from './server.ts'
import { Tail } from './tail.ts'

const config = new ConfigLoader(new Environment.Reader(Deno.env)).load()
const log = new Log.JsonLines()

await Deno.mkdir(dirname(config.databasePath), { recursive: true })
const store = Audit.Stores.Sqlite.open(new DatabaseSync(config.databasePath))
const ingestion = new Audit.Ingestion(
  store,
  new Audit.Redaction(
    config.keptAuth,
    Disclosure.Disclosure.of(
      config.coveredFacts.map((pointer) => [
        Disclosure.Field.parse(pointer, 'AUDIT_COVER_FACTS'),
        Disclosure.Presentation.covered,
      ]),
    ),
  ),
)

const resolvers = new Horizon.Resolvers()
new Queries(store).serve(resolvers)
const horizon = new Horizon.Server(resolvers, new Horizon.Handlers())
horizon.OnCrashed.Do((_message, error, incident) =>
  log.write('audit.crashed', {
    incident,
    error: error instanceof Error ? error.message : String(error),
  })
)
const transport = new HttpTransport()
horizon.Use(transport)

/** Raw records and rollups past their retention are let go, now and then. */
const retention = new Audit.Retention(config.rawDays, config.rollupDays)
const purge = () => {
  store.purge(retention, new Date())
  log.write('audit.purged', { rawBefore: retention.rawBefore(new Date()) })
}
purge()
setInterval(purge, config.purgeEveryMs)

if (config.tailPath !== undefined) {
  const tail = new Tail(config.tailPath, config.tailPollMs)
  tail.OnLines.Do(async (lines: string) => {
    const report = await ingestion.ingest(lines)
    if (report.refused.length > 0) log.write('audit.refused', report)
  })
  tail.start()
}

const server = new Server(
  new Intake(ingestion, config.ingestToken, config.maxConcurrentBatches),
  transport,
)
log.write('audit.started', { tail: config.tailPath ?? null })

Deno.serve(
  {
    port: config.port,
    onError: (error) => {
      log.writeError('audit.error', error)
      return new Response(null, { status: 500 })
    },
  },
  (request) => server.handle(request),
)

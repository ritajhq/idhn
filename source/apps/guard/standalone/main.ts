import { loadManifestFile, RejectResponses } from '@idhn/guard'
import * as Judge from '@idhn/judge'
import { loadConfig } from './config.ts'
import { Server } from './server.ts'

const config = loadConfig()

const manifest = await loadManifestFile(config.manifestPath, 'http')
const judge = new Judge.Http.Client(config.judgeServerUrl)
const rejectResponse = await new RejectResponses.Source(
  config.rejectResponseUrl,
).load()

const server = new Server(manifest, judge, config.upstreamUrl, rejectResponse)

Deno.serve({ port: config.port }, (request) => server.handle(request))

import { buildServer } from './build-server.ts'
import { loadConfig } from './config.ts'

const config = loadConfig()
const handler = await buildServer(config)

Deno.serve({ port: config.port }, handler)

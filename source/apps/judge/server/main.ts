import * as Judge from '@idhn/judge'
import * as OPA from '@idhn/opa'
import * as Policy from '@idhn/policy'
import * as Environment from '@idhn/environment'
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

const judge = new Judge.Local(registry, engine, deny_strategy, enricher)

Deno.serve({ port: config.port }, Judge.Http.buildHandler(judge))

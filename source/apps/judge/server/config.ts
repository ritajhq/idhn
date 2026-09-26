export interface Config {
  bundlePath: string
  port: number
  kvPath: string | undefined
  policyDataPath: string | undefined
  enrichmentPath: string | undefined
}

/** The slice of `Deno.Env` `loadConfig` actually needs, so tests can supply a lightweight fake. */
export interface EnvReader {
  get(name: string): string | undefined
}

export class ConfigError extends Error {}

const DEFAULT_PORT = 8081

/** Reads and validates the server's configuration from environment variables. Throws `ConfigError` on any missing or invalid value. */
export function loadConfig(env: EnvReader = Deno.env): Config {
  return {
    bundlePath: requireEnv(env, 'POLICY_BUNDLE_PATH'),
    port: readPort(env, 'JUDGE_PORT'),
    kvPath: readOptionalEnv(env, 'KV_PATH'),
    policyDataPath: readOptionalEnv(env, 'POLICY_DATA_PATH'),
    enrichmentPath: readOptionalEnv(env, 'ENRICHMENT_PATH'),
  }
}

function readOptionalEnv(env: EnvReader, name: string): string | undefined {
  const value = env.get(name)
  return value === undefined || value.length === 0 ? undefined : value
}

function requireEnv(env: EnvReader, name: string): string {
  const value = env.get(name)
  if (value === undefined || value.length === 0) {
    throw new ConfigError(`${name} must be set`)
  }
  return value
}

function readPort(env: EnvReader, name: string): number {
  const value = env.get(name)
  if (value === undefined || value.length === 0) {
    return DEFAULT_PORT
  }
  const port = Number(value)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new ConfigError(`${name} must be a valid port number, got "${value}"`)
  }
  return port
}

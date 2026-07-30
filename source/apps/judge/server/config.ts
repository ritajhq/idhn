export interface Config {
  manifestPath: string
  bundlePath: string
  port: number
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
    manifestPath: requireEnv(env, 'SERVICE_MANIFEST_PATH'),
    bundlePath: requireEnv(env, 'POLICY_BUNDLE_PATH'),
    port: readPort(env, 'JUDGE_PORT'),
  }
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

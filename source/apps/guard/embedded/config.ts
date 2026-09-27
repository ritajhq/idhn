import type * as Environment from '@idhn/environment'

export interface Config {
  manifestPath: string
  bundlePath: string
  kvPath: string | undefined
  policyDataPath: string | undefined
  enrichmentPath: string | undefined
  judgeTimeoutMs: number
  upstreamUrl: URL
  port: number
  rejectResponseUrl: URL | undefined
}

const DEFAULT_PORT = 8080
const DEFAULT_JUDGE_TIMEOUT_MS = 5000

/** Builds the server's configuration from the environment. Throws `Environment.InvalidError` on any missing or invalid value. */
export class ConfigLoader {
  constructor(private readonly environment: Environment.Reader) {}

  load(): Config {
    return {
      manifestPath: this.environment.requireString('SERVICE_MANIFEST_PATH'),
      bundlePath: this.environment.requireString('POLICY_BUNDLE_PATH'),
      kvPath: this.environment.optionalString('KV_PATH'),
      policyDataPath: this.environment.optionalString('POLICY_DATA_PATH'),
      enrichmentPath: this.environment.optionalString('ENRICHMENT_PATH'),
      judgeTimeoutMs: this.environment.positiveNumber(
        'JUDGE_TIMEOUT_MS',
        DEFAULT_JUDGE_TIMEOUT_MS,
      ),
      upstreamUrl: this.environment.requireUrl('UPSTREAM_URL'),
      port: this.environment.port('PROXY_PORT', DEFAULT_PORT),
      rejectResponseUrl: this.environment.optionalUrl('REJECT_RESPONSE_URL'),
    }
  }
}

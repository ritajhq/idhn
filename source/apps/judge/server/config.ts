import type * as Environment from '@idhn/environment'

export interface Config {
  bundlePath: string
  port: number
  kvPath: string | undefined
  policyDataPath: string | undefined
  enrichmentPath: string | undefined
  maxDecisionMs: number
}

const DEFAULT_PORT = 8081
/** The longest a judgement may take for a caller that says nothing about how long it will wait. Callers that do are answered within their own wait. */
const DEFAULT_MAX_DECISION_MS = 5000

/** Builds the server's configuration from the environment. Throws `Environment.InvalidError` on any missing or invalid value. */
export class ConfigLoader {
  constructor(private readonly environment: Environment.Reader) {}

  load(): Config {
    return {
      bundlePath: this.environment.requireString('POLICY_BUNDLE_PATH'),
      port: this.environment.port('JUDGE_PORT', DEFAULT_PORT),
      kvPath: this.environment.optionalString('KV_PATH'),
      policyDataPath: this.environment.optionalString('POLICY_DATA_PATH'),
      enrichmentPath: this.environment.optionalString('ENRICHMENT_PATH'),
      maxDecisionMs: this.environment.positiveNumber(
        'MAX_DECISION_MS',
        DEFAULT_MAX_DECISION_MS,
      ),
    }
  }
}

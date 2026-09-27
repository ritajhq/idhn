import type * as Environment from '@idhn/environment'

export interface Config {
  bundlePath: string
  port: number
  kvPath: string | undefined
  policyDataPath: string | undefined
  enrichmentPath: string | undefined
  decisionDeadlineMs: number
}

const DEFAULT_PORT = 8081
/** Must stay below the timeout of whoever waits on the judge, so it always gets an answer. */
const DEFAULT_DECISION_DEADLINE_MS = 1500

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
      decisionDeadlineMs: this.environment.positiveNumber(
        'DECISION_DEADLINE_MS',
        DEFAULT_DECISION_DEADLINE_MS,
      ),
    }
  }
}

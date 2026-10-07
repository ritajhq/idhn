import { ENFORCEMENT_LEVELS, type EnforcementLevel } from '@idhn/guard'
import type * as Environment from '@idhn/environment'

export interface Config {
  enforcement: EnforcementLevel
  manifestPath: string
  judgeTimeoutMs: number
  upstreamUrl: URL
  port: number
  rejectResponseUrl: URL | undefined
  /** Which replica this is, as its audit lines say: `INSTANCE`, else the container's `HOSTNAME`. */
  instance: string
}

/** What only a guard that asks a judge needs. */
export interface JudgingConfig {
  judgeServerUrl: URL
}

const DEFAULT_PORT = 8080
const DEFAULT_JUDGE_TIMEOUT_MS = 5000

/** Builds the server's configuration from the environment. Throws `Environment.InvalidError` on any missing or invalid value. */
export class ConfigLoader {
  constructor(private readonly environment: Environment.Reader) {}

  load(): Config {
    return {
      enforcement: this.environment.oneOf(
        'ENFORCEMENT',
        ENFORCEMENT_LEVELS,
        'full',
      ),
      manifestPath: this.environment.requireString('SERVICE_MANIFEST_PATH'),
      judgeTimeoutMs: this.environment.positiveNumber(
        'JUDGE_TIMEOUT_MS',
        DEFAULT_JUDGE_TIMEOUT_MS,
      ),
      upstreamUrl: this.environment.requireUrl('UPSTREAM_URL'),
      port: this.environment.port('PROXY_PORT', DEFAULT_PORT),
      rejectResponseUrl: this.environment.optionalUrl('REJECT_RESPONSE_URL'),
      instance: this.environment.optionalString('INSTANCE') ??
        this.environment.optionalString('HOSTNAME') ?? 'unknown',
    }
  }

  /** Read only at the `full` enforcement level, the one that asks the judge-server. */
  judging(): JudgingConfig {
    return {
      judgeServerUrl: this.environment.requireUrl('JUDGE_SERVER_URL'),
    }
  }
}

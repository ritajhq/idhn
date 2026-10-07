import type * as Environment from '@idhn/environment'

/**
 * Where the judge's policies come from: files read once at startup, or a
 * policy builder it pulls from, and polls for newer ones.
 */
export type PoliciesConfig =
  | {
    kind: 'files'
    bundlePath: string
    registryPath: string
    dataPath: string | undefined
    enrichmentPath: string | undefined
  }
  | { kind: 'builder'; url: URL; pollMs: number }

export interface Config {
  port: number
  maxDecisionMs: number
  policies: PoliciesConfig
  /** Which replica this is, as its audit lines say: `INSTANCE`, else the container's `HOSTNAME`. */
  instance: string
}

const DEFAULT_PORT = 8081
/** The longest a judgement may take for a caller that says nothing about how long it will wait. Callers that do are answered within their own wait. */
const DEFAULT_MAX_DECISION_MS = 5000
/** How often a judge asks its policy builder whether there is anything newer. */
const DEFAULT_POLL_MS = 5000

/** Builds the server's configuration from the environment. Throws `Environment.InvalidError` on any missing or invalid value. */
export class ConfigLoader {
  constructor(private readonly environment: Environment.Reader) {}

  load(): Config {
    const builder = this.environment.optionalUrl('POLICY_SOURCE_URL')
    return {
      port: this.environment.port('JUDGE_PORT', DEFAULT_PORT),
      instance: this.environment.optionalString('INSTANCE') ??
        this.environment.optionalString('HOSTNAME') ?? 'unknown',
      maxDecisionMs: this.environment.positiveNumber(
        'MAX_DECISION_MS',
        DEFAULT_MAX_DECISION_MS,
      ),
      policies: builder === undefined ? this.files() : {
        kind: 'builder',
        url: builder,
        pollMs: this.environment.positiveNumber('POLICY_POLL_MS', DEFAULT_POLL_MS),
      },
    }
  }

  private files(): PoliciesConfig {
    return {
      kind: 'files',
      bundlePath: this.environment.requireString('POLICY_BUNDLE_PATH'),
      registryPath: this.environment.requireString('POLICY_REGISTRY_PATH'),
      dataPath: this.environment.optionalString('POLICY_DATA_PATH'),
      enrichmentPath: this.environment.optionalString('ENRICHMENT_PATH'),
    }
  }
}

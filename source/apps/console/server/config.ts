import type * as Environment from '@idhn/environment'

export interface Config {
  port: number
  /** The SQLite file the console keeps its resources and policy sources in. */
  databasePath: string
  /** The policy builder, which checks and publishes the sources. */
  builderUrl: URL
  /** The audit server. */
  auditUrl: URL
  /** The built web app: `index.html`, `main.js`, `index.css`. */
  dist: string
}

const DEFAULT_PORT = 8084

/** Builds the console's configuration from the environment. Throws `Environment.InvalidError` on any missing or invalid value. */
export class ConfigLoader {
  constructor(
    private readonly environment: Environment.Reader,
    private readonly defaultDist: string,
  ) {}

  load(): Config {
    return {
      port: this.environment.port('CONSOLE_PORT', DEFAULT_PORT),
      databasePath: this.environment.optionalString('CONSOLE_DB_PATH') ??
        '/var/lib/idhn-console/console.db',
      builderUrl: this.environment.requireUrl('POLICY_BUILDER_URL'),
      auditUrl: this.environment.requireUrl('AUDIT_URL'),
      dist: this.environment.optionalString('CONSOLE_DIST') ??
        this.defaultDist,
    }
  }
}

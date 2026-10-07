import type * as Environment from '@idhn/environment'

export interface Config {
  port: number
  /** The SQLite file the audit is kept in. */
  databasePath: string
  rawDays: number
  rollupDays: number
  /** Fields of `auth` kept in the clear beside `status` and `subject` (`claims.role`). */
  keptAuth: string[]
  /** JSON Pointers of other context facts to cover (`/email`). */
  coveredFacts: string[]
  /** The token a log shipper must present to post records; none lets any caller on the network post. */
  ingestToken: string | undefined
  /** How many batches are taken in at once; a shipper sending more is told to back off. */
  maxConcurrentBatches: number
  /** A JSON Lines file to follow instead of, or beside, being sent records (development). */
  tailPath: string | undefined
  tailPollMs: number
  purgeEveryMs: number
}

const DEFAULT_PORT = 8083

/** Builds the audit server's configuration from the environment. Throws `Environment.InvalidError` on any missing or invalid value. */
export class ConfigLoader {
  constructor(private readonly environment: Environment.Reader) {}

  load(): Config {
    return {
      port: this.environment.port('AUDIT_PORT', DEFAULT_PORT),
      databasePath: this.environment.optionalString('AUDIT_DB_PATH') ??
        '/var/lib/idhn-audit/audit.db',
      rawDays: this.environment.positiveNumber('AUDIT_RAW_DAYS', 30),
      rollupDays: this.environment.positiveNumber('AUDIT_ROLLUP_DAYS', 365),
      keptAuth: this.list('AUDIT_KEEP_AUTH'),
      coveredFacts: this.list('AUDIT_COVER_FACTS'),
      ingestToken: this.environment.optionalString('AUDIT_INGEST_TOKEN'),
      maxConcurrentBatches: this.environment.positiveNumber(
        'AUDIT_MAX_CONCURRENT_BATCHES',
        4,
      ),
      tailPath: this.environment.optionalString('AUDIT_TAIL_PATH'),
      tailPollMs: this.environment.positiveNumber('AUDIT_TAIL_POLL_MS', 1000),
      purgeEveryMs: this.environment.positiveNumber(
        'AUDIT_PURGE_EVERY_MS',
        60 * 60 * 1000,
      ),
    }
  }

  /** A comma-separated list, empty when unset. */
  private list(name: string): string[] {
    return (this.environment.optionalString(name) ?? '').split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '')
  }
}

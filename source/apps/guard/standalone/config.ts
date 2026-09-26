import type * as Environment from '@idhn/environment'

export interface Config {
  manifestPath: string
  judgeServerUrl: URL
  upstreamUrl: URL
  port: number
  rejectResponseUrl: URL | undefined
}

const DEFAULT_PORT = 8080

/** Builds the server's configuration from the environment. Throws `Environment.InvalidError` on any missing or invalid value. */
export class ConfigLoader {
  constructor(private readonly environment: Environment.Reader) {}

  load(): Config {
    return {
      manifestPath: this.environment.requireString('SERVICE_MANIFEST_PATH'),
      judgeServerUrl: this.environment.requireUrl('JUDGE_SERVER_URL'),
      upstreamUrl: this.environment.requireUrl('UPSTREAM_URL'),
      port: this.environment.port('PROXY_PORT', DEFAULT_PORT),
      rejectResponseUrl: this.environment.optionalUrl('REJECT_RESPONSE_URL'),
    }
  }
}

import type * as Environment from '@idhn/environment'
import type { Watching } from './sources/directory.ts'

/** Where the builder takes its policy sources from, with that source's own settings. */
export type SourceConfig =
  | { kind: 'directory'; dir: string; watching: Watching; pollMs: number }
  | { kind: 'git'; url: string; ref: string; workDir: string; pollMs: number }
  | { kind: 'upload'; stateDir: string }

export const SOURCE_KINDS = ['directory', 'git', 'upload'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

export interface Config {
  port: number
  opaPath: string
  gitPath: string
  source: SourceConfig
}

const DEFAULT_PORT = 8082

/** Builds the builder's configuration from the environment. Throws `Environment.InvalidError` on any missing or invalid value. */
export class ConfigLoader {
  constructor(private readonly environment: Environment.Reader) {}

  load(): Config {
    const kind = this.environment.oneOf('POLICY_SOURCE', SOURCE_KINDS, 'upload')
    const sources: Record<SourceKind, () => SourceConfig> = {
      directory: () => ({
        kind: 'directory',
        dir: this.environment.requireString('SOURCE_DIR'),
        watching: this.environment.oneOf('SOURCE_WATCH', ['native', 'poll'] as const, 'native'),
        pollMs: this.environment.positiveNumber('SOURCE_POLL_MS', 2000),
      }),
      git: () => ({
        kind: 'git',
        url: this.environment.requireString('GIT_URL'),
        ref: this.environment.optionalString('GIT_REF') ?? 'main',
        workDir: this.environment.optionalString('GIT_WORK_DIR') ?? '/tmp/policy-sources',
        pollMs: this.environment.positiveNumber('GIT_POLL_MS', 30000),
      }),
      upload: () => ({
        kind: 'upload',
        stateDir: this.environment.optionalString('STATE_DIR') ?? '/var/lib/policy-builder',
      }),
    }
    return {
      port: this.environment.port('BUILDER_PORT', DEFAULT_PORT),
      opaPath: this.environment.optionalString('OPA_PATH') ?? 'opa',
      gitPath: this.environment.optionalString('GIT_PATH') ?? 'git',
      source: sources[kind](),
    }
  }
}

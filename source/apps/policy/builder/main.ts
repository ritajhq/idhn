import * as Distribution from '@idhn/distribution'
import * as Environment from '@idhn/environment'
import * as Log from '@idhn/log'
import { Base } from './base.ts'
import { Builds } from './builds.ts'
import { Compiler } from './compiler.ts'
import { ConfigLoader, type SourceConfig, type SourceKind } from './config.ts'
import { NoIntake, UploadIntake } from './intake.ts'
import { Opa } from './opa.ts'
import { Server } from './server.ts'
import { Directory } from './sources/directory.ts'
import { Git } from './sources/git.ts'
import { Upload } from './sources/upload.ts'

const config = new ConfigLoader(new Environment.Reader(Deno.env)).load()
const log = new Log.JsonLines()

/**
 * Sources become policy sets here: every source tree is compiled, and each
 * one that compiles is published for judges to pull, while one that doesn't
 * is refused and leaves the last good set published.
 */
const publication = new Distribution.Publication()
const base = config.baseDir === undefined ? Base.none() : Base.at(config.baseDir)
const builds = new Builds(new Compiler(new Opa(config.opaPath)), publication, base)
builds.OnBuilt.Do((set) => log.write('builder.built', { version: set.version }))
builds.OnRefused.Do((version, problems) => log.write('builder.refused', { version, problems }))

/** The configured source, and the uploads it takes (none, unless it is `upload`). */
type Wiring = { start: () => Promise<void>; intake: UploadIntake | NoIntake }
const wirings: { [K in SourceKind]: (source: Extract<SourceConfig, { kind: K }>) => Wiring } = {
  directory: (source) => {
    const directory = new Directory(source.dir, source.watching, source.pollMs)
    directory.OnSources.Do((tree) => builds.build(tree))
    return { start: () => directory.start(), intake: new NoIntake(`the directory ${source.dir}`) }
  },
  git: (source) => {
    const git = new Git(source.url, source.ref, source.workDir, source.pollMs, config.gitPath)
    git.OnSources.Do((tree) => builds.build(tree))
    git.OnFailed.Do((error) => log.writeError('builder.source_failed', error))
    return { start: () => git.start(), intake: new NoIntake(`git (${source.url})`) }
  },
  upload: (source) => {
    const upload = new Upload(source.stateDir)
    upload.OnSources.Do((tree) => builds.build(tree))
    return { start: () => upload.start(), intake: new UploadIntake(upload, builds) }
  },
}
// Each wiring takes its own kind's settings; the lookup can't see that
// `config.source.kind` and `config.source` agree, so it's told.
const wire = wirings[config.source.kind] as (source: SourceConfig) => Wiring
const { start, intake } = wire(config.source)

const server = new Server(new Distribution.Http.Server(publication), intake, publication)
log.write('builder.started', { source: config.source.kind })
// The base alone first, so judges have policies before anything is published;
// whatever the source then announces is built after it, and published last.
if (base.alone !== undefined) builds.build(base.alone)
await start()

Deno.serve(
  {
    port: config.port,
    onError: (error) => {
      log.writeError('builder.error', error)
      return new Response(null, { status: 500 })
    },
  },
  (request) => server.handle(request),
)

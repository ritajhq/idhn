import type { Builds } from './builds.ts'
import type { SourceTree } from './source-tree.ts'
import { type Upload, UnpackError } from './sources/upload.ts'

/** The header an uploader names its sources' version with (its commit). */
export const VERSION_HEADER = 'x-policy-version'

/** The largest upload taken, far above any policy repository's size. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/**
 * Where uploaded sources come in, at `PUT /sources`: a tar of a policy
 * repository, built on the spot and answered with the outcome — `200` with
 * the version now published, or `422` with every reason it was refused, so
 * whoever uploaded sees them — and kept only when it built.
 *
 * At `POST /checks` the same tar is a dry run: built, answered `200` or
 * `422` the same way, and then let go, publishing nothing — how an author
 * finds out whether sources would build before publishing them.
 */
export class UploadIntake {
  constructor(private readonly upload: Upload, private readonly builds: Builds) {}

  async handle(request: Request): Promise<Response> {
    return await this.unpacked(request, async (tree, archive) => {
      const outcome = await this.builds.build(tree)
      if (!outcome.built) {
        await this.upload.discard(tree)
        return Response.json({ version: tree.version, problems: outcome.problems }, { status: 422 })
      }
      await this.upload.keep(tree, archive)
      return Response.json({ version: tree.version })
    })
  }

  async check(request: Request): Promise<Response> {
    return await this.unpacked(request, async (tree) => {
      try {
        const outcome = await this.builds.check(tree)
        return outcome.passed
          ? Response.json({ version: tree.version, problems: [] })
          : Response.json({ version: tree.version, problems: outcome.problems }, { status: 422 })
      } finally {
        await this.upload.discard(tree)
      }
    })
  }

  /** The uploaded sources, unpacked, handed to `then`: refused before that when too large or not a tar. */
  private async unpacked(
    request: Request,
    then: (tree: SourceTree, archive: Uint8Array) => Promise<Response>,
  ): Promise<Response> {
    const archive = new Uint8Array(await request.arrayBuffer())
    if (archive.length > MAX_UPLOAD_BYTES) {
      return Response.json({ error: 'upload too large' }, { status: 413 })
    }
    const version = request.headers.get(VERSION_HEADER) ?? 'unversioned'

    let tree
    try {
      tree = await this.upload.unpack(archive, version)
    } catch (error) {
      if (!(error instanceof UnpackError)) throw error
      return Response.json({ version, problems: [error.message] }, { status: 400 })
    }
    return await then(tree, archive)
  }
}

/** The intake of a builder whose sources come from elsewhere (git, a directory): it takes no uploads. */
export class NoIntake {
  constructor(private readonly source: string) {}

  // deno-lint-ignore require-await
  async handle(): Promise<Response> {
    return this.refusal()
  }

  // deno-lint-ignore require-await
  async check(): Promise<Response> {
    return this.refusal()
  }

  private refusal(): Response {
    return Response.json(
      { error: `this builder takes its sources from ${this.source}, not uploads` },
      { status: 405 },
    )
  }
}

import { Delegate, type Emitter } from '@duesabati/evento'
import { dirname, join, normalize } from '@std/path'
import { UntarStream } from '@std/tar/untar-stream'
import { SourceTree } from '../source-tree.ts'

/** An upload that isn't a tar of policy sources. */
export class UnpackError extends Error {}

/**
 * Policy sources uploaded as a tar archive (for one, `git archive HEAD` of a
 * policies repository), versioned by whatever the uploader says (its commit).
 *
 * An upload is unpacked into a directory of its own (`unpack`), and only once
 * it has built is it `keep`-t: saved in `stateDir`, so `start()` can announce
 * it again on `OnSources` after a restart, and judges never go without the
 * policies they had.
 */
export class Upload {
  private readonly sources = new Delegate<[SourceTree]>()
  private kept: SourceTree | undefined

  constructor(private readonly stateDir: string) {}

  get OnSources(): Emitter<[SourceTree]> {
    return this.sources
  }

  /** Announce the last kept upload, if there is one. */
  async start(): Promise<void> {
    await Deno.mkdir(this.stateDir, { recursive: true })
    try {
      const archive = await Deno.readFile(join(this.stateDir, 'sources.tar'))
      const version = (await Deno.readTextFile(join(this.stateDir, 'version'))).trim()
      this.kept = await this.unpack(archive, version)
      this.sources.Invoke(this.kept)
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error
    }
  }

  /** `archive`'s sources, in a directory of their own. Throws `UnpackError` for anything but a tar of plain files. */
  async unpack(archive: Uint8Array, version: string): Promise<SourceTree> {
    const dir = await Deno.makeTempDir({ dir: this.stateDir, prefix: 'unpacked-' })
    try {
      const entries = ReadableStream.from([archive]).pipeThrough(new UntarStream())
      for await (const entry of entries) {
        const path = normalize(entry.path)
        if (path.startsWith('..') || path.startsWith('/')) {
          throw new UnpackError(`archive entry ${entry.path} points outside the archive`)
        }
        if (entry.readable === undefined) continue
        await Deno.mkdir(join(dir, dirname(path)), { recursive: true })
        await entry.readable.pipeTo((await Deno.create(join(dir, path))).writable)
      }
      return new SourceTree(dir, version)
    } catch (error) {
      await this.discard(new SourceTree(dir, version))
      if (error instanceof UnpackError) throw error
      throw new UnpackError(`not a tar archive: ${error instanceof Error ? error.message : error}`)
    }
  }

  /** Keep `archive` as the upload to restore after a restart, and let the previous one's files go. */
  async keep(tree: SourceTree, archive: Uint8Array): Promise<void> {
    await Deno.writeFile(join(this.stateDir, '.sources.tar.new'), archive)
    await Deno.writeTextFile(join(this.stateDir, '.version.new'), tree.version)
    await Deno.rename(join(this.stateDir, '.sources.tar.new'), join(this.stateDir, 'sources.tar'))
    await Deno.rename(join(this.stateDir, '.version.new'), join(this.stateDir, 'version'))
    if (this.kept !== undefined && this.kept.dir !== tree.dir) await this.discard(this.kept)
    this.kept = tree
  }

  /** Let go of an unpacked tree nobody needs any more (one refused, or superseded). */
  async discard(tree: SourceTree): Promise<void> {
    await Deno.remove(tree.dir, { recursive: true }).catch(() => {})
  }
}

import { Delegate, type Emitter } from '@duesabati/evento'
import { relative, walk } from './walk.ts'
import { SourceTree } from '../source-tree.ts'

/** How a `Directory` notices its files changing. */
export type Watching = 'native' | 'poll'

/** How long files must stay unchanged before a change is announced. */
const SETTLE_MS = 500

/**
 * Policy sources in a local directory, announced on `OnSources` when
 * `start()` is called and again whenever their content changes, versioned by
 * a hash of that content. It notices changes through the operating system's
 * file notifications (`native`, `Deno.watchFs`), or, where a filesystem gives
 * none (some network and container mounts), by hashing the directory every
 * `pollMs` (`poll`).
 */
export class Directory {
  private readonly sources = new Delegate<[SourceTree]>()
  private announced: string | undefined

  constructor(
    private readonly dir: string,
    private readonly watching: Watching,
    private readonly pollMs: number,
  ) {}

  get OnSources(): Emitter<[SourceTree]> {
    return this.sources
  }

  async start(): Promise<void> {
    await this.announceIfChanged()
    const watchers: Record<Watching, () => void> = {
      native: () => this.watchNatively(),
      poll: () => setInterval(() => this.announceIfChanged(), this.pollMs),
    }
    watchers[this.watching]()
  }

  private async watchNatively(): Promise<void> {
    let settling: ReturnType<typeof setTimeout> | undefined
    for await (const _ of Deno.watchFs(this.dir, { recursive: true })) {
      clearTimeout(settling)
      settling = setTimeout(() => this.announceIfChanged(), SETTLE_MS)
    }
  }

  private async announceIfChanged(): Promise<void> {
    const version = await this.contentHash()
    if (version === this.announced) return
    this.announced = version
    this.sources.Invoke(new SourceTree(this.dir, version))
  }

  /** A hash of every file's path and content, so any edit, addition or removal changes it. */
  private async contentHash(): Promise<string> {
    const encoder = new TextEncoder()
    const parts: Uint8Array[] = []
    for (const file of await walk(this.dir)) {
      parts.push(encoder.encode(`${relative(this.dir, file)}\0`), await Deno.readFile(file))
    }
    const all = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
    parts.reduce((offset, part) => (all.set(part, offset), offset + part.length), 0)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', all))
    return `sha256:${[...digest.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
  }
}

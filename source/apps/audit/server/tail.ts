import { Delegate, type Emitter } from '@duesabati/evento'

/**
 * Follows a JSON Lines file as processes append to it, handing each batch
 * of whole new lines on `OnLines` — for development, or a single host
 * without a log shipper. Starts from the beginning: records seen before are
 * kept once anyway. A file that shrank was replaced, and is read from its
 * start again.
 */
export class Tail {
  private readonly lines = new Delegate<[string]>()
  private offset = 0
  private partial = ''
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly path: string, private readonly pollMs: number) {}

  get OnLines(): Emitter<[string]> {
    return this.lines
  }

  start(): void {
    this.timer = setInterval(() => this.read().catch(() => {}), this.pollMs)
  }

  stop(): void {
    clearInterval(this.timer)
  }

  /** Reads what was appended since the last read. */
  async read(): Promise<void> {
    let file: Deno.FsFile
    try {
      file = await Deno.open(this.path)
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return
      throw error
    }
    try {
      const { size } = await file.stat()
      if (size < this.offset) {
        this.offset = 0
        this.partial = ''
      }
      if (size === this.offset) return
      await file.seek(this.offset, Deno.SeekMode.Start)
      const bytes = new Uint8Array(size - this.offset)
      let read = 0
      while (read < bytes.length) {
        const n = await file.read(bytes.subarray(read))
        if (n === null) break
        read += n
      }
      this.offset += read
      const text = this.partial +
        new TextDecoder().decode(bytes.subarray(0, read))
      const end = text.lastIndexOf('\n')
      this.partial = text.slice(end + 1)
      if (end >= 0) this.lines.Invoke(text.slice(0, end))
    } finally {
      file.close()
    }
  }
}

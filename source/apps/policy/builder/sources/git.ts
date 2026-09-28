import { Delegate, type Emitter } from '@duesabati/evento'
import { SourceTree } from '../source-tree.ts'

/**
 * Policy sources in a git repository: cloned into `workDir` on `start()` and
 * fetched again every `pollMs`, each new commit of `ref` announced on
 * `OnSources`, versioned by its commit id. A clone or fetch that fails is
 * announced on `OnFailed` and simply tried again at the next poll, so a git
 * host that is briefly down only delays new policies.
 */
export class Git {
  private readonly sources = new Delegate<[SourceTree]>()
  private readonly failed = new Delegate<[unknown]>()
  private announced: string | undefined
  private cloned = false

  constructor(
    private readonly url: string,
    private readonly ref: string,
    private readonly workDir: string,
    private readonly pollMs: number,
    private readonly executable: string = 'git',
  ) {}

  get OnSources(): Emitter<[SourceTree]> {
    return this.sources
  }

  get OnFailed(): Emitter<[unknown]> {
    return this.failed
  }

  async start(): Promise<void> {
    await this.update()
    setInterval(() => this.update(), this.pollMs)
  }

  private async update(): Promise<void> {
    try {
      const commit = this.cloned ? await this.fetch() : await this.clone()
      if (commit === this.announced) return
      this.announced = commit
      this.sources.Invoke(new SourceTree(this.workDir, commit))
    } catch (error) {
      this.failed.Invoke(error)
    }
  }

  /** Clone `ref` alone, shallowly; the commit checked out. */
  private async clone(): Promise<string> {
    await Deno.remove(this.workDir, { recursive: true }).catch(() => {})
    await this.git(['clone', '--depth', '1', '--branch', this.ref, this.url, this.workDir])
    this.cloned = true
    return await this.git(['-C', this.workDir, 'rev-parse', 'HEAD'])
  }

  /** Fetch `ref` and check out its latest commit; that commit. */
  private async fetch(): Promise<string> {
    await this.git(['-C', this.workDir, 'fetch', '--depth', '1', 'origin', this.ref])
    const latest = await this.git(['-C', this.workDir, 'rev-parse', 'FETCH_HEAD'])
    if (latest !== this.announced) {
      await this.git(['-C', this.workDir, 'reset', '--hard', latest])
    }
    return latest
  }

  private async git(args: string[]): Promise<string> {
    const { success, stdout, stderr } = await new Deno.Command(this.executable, {
      args,
      stdout: 'piped',
      stderr: 'piped',
      env: { GIT_TERMINAL_PROMPT: '0' },
    }).output()
    if (!success) {
      throw new Error(`git ${args.find((arg) => !arg.startsWith('-') && arg !== this.workDir)} failed: ${new TextDecoder().decode(stderr).trim()}`)
    }
    return new TextDecoder().decode(stdout).trim()
  }
}

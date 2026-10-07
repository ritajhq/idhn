import type { Builder } from './builder.ts'
import { Revision } from './revision.ts'
import type { Workspace } from './workspace.ts'

/** The draft doesn't build: every reason, for its authors to fix. */
export class RefusedError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`The policies don't build:\n- ${problems.join('\n- ')}`)
  }
}

/**
 * Takes the draft to the policy builder: to check it builds, publishing
 * nothing, or to publish it for judges to pull, recording what was
 * published as the next revision. Publications never overlap — one asked
 * for while another runs waits for it — so each takes its own number.
 */
export class Publishing {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly workspace: Workspace,
    private readonly builder: Builder,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Every reason the draft wouldn't build; none when it would. Throws `BuilderUnavailableError`. */
  async check(): Promise<string[]> {
    const draft = this.workspace.draft()
    return await this.builder.check(draft.files(), `draft-${draft.revision}`)
  }

  /** Publishes the draft as the next revision. Throws `RefusedError` or `BuilderUnavailableError`. */
  publish(by: string): Promise<Revision> {
    const published = this.queue.then(() => this.publishNow(by))
    this.queue = published.catch(() => {})
    return published
  }

  private async publishNow(by: string): Promise<Revision> {
    const draft = this.workspace.draft()
    const revision = new Revision(
      this.workspace.nextRevisionNumber(),
      this.now(),
      by,
      draft.revision,
      draft.files(),
    )
    const problems = await this.builder.publish(
      revision.files,
      revision.version,
    )
    if (problems.length > 0) throw new RefusedError(problems)
    this.workspace.record(revision)
    return revision
  }
}

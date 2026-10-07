/** One publication of the draft: what was published, as which version, by whom and when. */
export class Revision {
  constructor(
    readonly number: number,
    readonly publishedAt: Date,
    /** The subject of whoever published it. */
    readonly publishedBy: string,
    /** The draft revision it was published from. */
    readonly draftRevision: number,
    /** The source tree published, path → content. */
    readonly files: Readonly<Record<string, string>>,
  ) {}

  /** The version judges report it as, in their logs and the builder's. */
  get version(): string {
    return `r${this.number}`
  }
}

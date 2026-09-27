/**
 * The moment by which a judgement is no longer wanted, because whoever asked
 * for it will have stopped waiting. It is created once, where the waiting
 * starts, and handed down every hop — each one answering before it passes,
 * never setting a longer wait of its own. `signal` aborts when it passes.
 */
export class Deadline {
  private constructor(
    /** The wait it was set for, to say what was exceeded. */
    readonly ms: number,
    private readonly expiresAt: number,
    readonly signal: AbortSignal,
  ) {}

  /** A deadline `ms` from now. */
  static in(ms: number): Deadline {
    const wait = Math.max(0, Math.floor(ms))
    return new Deadline(
      wait,
      performance.now() + wait,
      AbortSignal.timeout(wait),
    )
  }

  /** No deadline: whoever asked will wait for as long as it takes. */
  static unbounded(): Deadline {
    return new Deadline(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      new AbortController().signal,
    )
  }

  get passed(): boolean {
    return this.signal.aborted
  }

  remainingMs(): number {
    return Math.max(0, this.expiresAt - performance.now())
  }

  /** This deadline, or one `ms` from now if that comes first. */
  within(ms: number): Deadline {
    if (ms >= this.remainingMs()) {
      return this
    }
    return Deadline.in(ms)
  }
}

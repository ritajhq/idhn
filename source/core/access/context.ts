/**
 * The circumstantial facts of an attempted action — who's doing it, to what,
 * and under what conditions. This is the document handed to a `Policy.Engine`
 * for evaluation (Rego's `input`), but `Context` itself carries no
 * Rego-specific shape or behavior.
 */
export class Context {
  readonly facts: Readonly<Record<string, unknown>>

  constructor(facts: Record<string, unknown> = {}) {
    this.facts = Object.freeze({ ...facts })
  }

  /**
   * A new `Context` with `additional` facts alongside the existing ones.
   * Facts gathered later (e.g. by enrichment) may add to what the request
   * said but never rewrite it, so a fact already present is a conflict.
   */
  with(additional: Record<string, unknown>): Context {
    const conflicting = Object.keys(additional).find((name) =>
      Object.hasOwn(this.facts, name)
    )
    if (conflicting !== undefined) {
      throw new ConflictingFactError(
        `Context already has a fact named "${conflicting}"`,
      )
    }
    return new Context({ ...this.facts, ...additional })
  }
}

export class ConflictingFactError extends Error {}

/**
 * The circumstantial facts of an attempted action — who's doing it, to what,
 * and under what conditions. This is the document handed to a `PolicyEngine`
 * for evaluation (Rego's `input`), but `Context` itself carries no
 * Rego-specific shape or behavior.
 */
export class Context {
  readonly facts: Readonly<Record<string, unknown>>

  constructor(facts: Record<string, unknown> = {}) {
    this.facts = Object.freeze({ ...facts })
  }
}

import * as Disclosure from '@idhn/disclosure'
import type * as Policy from '@idhn/policy'

/**
 * The final, explainable outcome of judging an action: allowed or not, the
 * results that led there, and how much of the answer's restricted fields
 * the caller may see — what every policy said, the strictest winning. `id`
 * names one judgement, so what the caller did with it can be matched against
 * the judge's own record of how it was reached.
 */
export class Decision {
  readonly allowed: boolean
  readonly results: readonly Policy.Result[]
  readonly id: string | undefined
  readonly disclosure: Disclosure.Disclosure

  constructor(
    allowed: boolean,
    results: readonly Policy.Result[] = [],
    id?: string,
    disclosure: Disclosure.Disclosure = Disclosure.Disclosure.combine(
      results.map((result) => result.disclosure),
    ),
  ) {
    this.allowed = allowed
    this.results = results
    this.id = id
    this.disclosure = disclosure
  }

  /** The same outcome, as the judgement identified by `id`. */
  identifiedAs(id: string): Decision {
    return new Decision(this.allowed, this.results, id, this.disclosure)
  }
}

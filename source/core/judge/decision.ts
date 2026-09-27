import type * as Policy from '@idhn/policy'

/**
 * The final, explainable outcome of judging an action: allowed or not, and the
 * results that led there. `id` names one judgement, so what the caller did with
 * it can be matched against the judge's own record of how it was reached.
 */
export class Decision {
  readonly allowed: boolean
  readonly results: readonly Policy.Result[]
  readonly id: string | undefined

  constructor(
    allowed: boolean,
    results: readonly Policy.Result[] = [],
    id?: string,
  ) {
    this.allowed = allowed
    this.results = results
    this.id = id
  }

  /** The same outcome, as the judgement identified by `id`. */
  identifiedAs(id: string): Decision {
    return new Decision(this.allowed, this.results, id)
  }
}

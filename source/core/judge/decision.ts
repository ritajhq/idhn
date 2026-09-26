import type * as Policy from '@idhn/policy'

/** The final, explainable outcome of judging an action: allowed or not, and the results that led there. */
export class Decision {
  readonly allowed: boolean
  readonly results: readonly Policy.Result[]

  constructor(allowed: boolean, results: readonly Policy.Result[] = []) {
    this.allowed = allowed
    this.results = results
  }
}

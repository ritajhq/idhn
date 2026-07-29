import type { PolicyResult } from './policy-result.ts'

/** The final, explainable outcome of judging an action: allowed or not, and the results that led there. */
export class Decision {
  readonly allowed: boolean
  readonly results: readonly PolicyResult[]

  constructor(allowed: boolean, results: readonly PolicyResult[] = []) {
    this.allowed = allowed
    this.results = results
  }
}

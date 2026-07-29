import type { Decision } from './decision.ts'
import type { PolicyResult } from './policy-result.ts'

/** Reconciles zero or more `PolicyResult`s into one final `Decision`. */
export interface DecisionStrategy {
  combine(results: readonly PolicyResult[]): Decision
}

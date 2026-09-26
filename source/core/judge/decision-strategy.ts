import type { Decision } from './decision.ts'
import type * as Policy from '@idhn/policy'

/** Reconciles zero or more `Policy.Result`s into one final `Decision`. */
export interface DecisionStrategy {
  combine(results: readonly Policy.Result[]): Decision
}

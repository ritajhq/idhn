import type { Action } from './action.ts'
import type { Policy } from './policy.ts'

/** Resolves which policies govern an attempted action. Implemented by infrastructure. */
export interface PolicyRepository {
  findPoliciesFor(action: Action): Promise<Policy[]>
}

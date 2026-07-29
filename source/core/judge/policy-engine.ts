import type { Context } from './context.ts'
import type { Policy } from './policy.ts'
import type { PolicyResult } from './policy-result.ts'

/** Evaluates a single policy against a context. Implemented by a concrete Rego runtime. */
export interface PolicyEngine {
  evaluate(policy: Policy, context: Context): Promise<PolicyResult>
}

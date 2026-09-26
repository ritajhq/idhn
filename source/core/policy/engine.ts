import type * as Access from '@idhn/access'
import type { Identifier } from './identifier.ts'
import type { Result } from './result.ts'

/** Evaluates a single policy against a context. Implemented by a concrete Rego runtime. */
export interface Engine {
  evaluate(policy: Identifier, context: Access.Context): Promise<Result>
}

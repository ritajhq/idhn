import type * as Access from '@idhn/access'
import type { Identifier } from './identifier.ts'

/** Resolves which policies govern an attempted action. Implemented by infrastructure. */
export interface Repository {
  findPoliciesFor(action: Access.Action): Promise<Identifier[]>
}

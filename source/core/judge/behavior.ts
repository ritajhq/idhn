import type * as Access from '@idhn/access'
import type { Decision } from './decision.ts'
import type { Deadline } from './deadline.ts'

/**
 * Answers whether an action is allowed in a context. `deadline` is when the
 * one asking stops waiting: past it, the judgement fails as unavailable
 * rather than arriving too late to be of use.
 */
export interface Behavior {
  decide(
    action: Access.Action,
    context: Access.Context,
    deadline: Deadline,
  ): Promise<Decision>
}

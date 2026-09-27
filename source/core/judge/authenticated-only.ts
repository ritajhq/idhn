import * as Access from '@idhn/access'
import type { Behavior } from './behavior.ts'
import { Decision } from './decision.ts'

/**
 * A `Behavior` that allows an action for any authenticated caller, as the
 * context's `auth` fact reports it, and denies it for anyone else. No policy
 * is evaluated, so its decisions carry no results and no id. For development
 * only, to run a service behind a guard's authentication before its policies
 * exist.
 */
export class AuthenticatedOnly implements Behavior {
  // deno-lint-ignore require-await
  async decide(
    _action: Access.Action,
    context: Access.Context,
  ): Promise<Decision> {
    const identity = context.facts[Access.Identity.FACT] as
      | { status?: unknown }
      | undefined
    return new Decision(identity?.status === 'authenticated')
  }
}

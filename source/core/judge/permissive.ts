import type { Behavior } from './behavior.ts'
import { Decision } from './decision.ts'

/**
 * A `Behavior` that allows every action without judging it: no policy is
 * evaluated, so its decisions carry no results and no id. For development
 * only, to run a service behind a guard before its policies exist.
 */
export class Permissive implements Behavior {
  // deno-lint-ignore require-await
  async decide(): Promise<Decision> {
    return new Decision(true)
  }
}

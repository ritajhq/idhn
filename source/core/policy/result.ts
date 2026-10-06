import * as Disclosure from '@idhn/disclosure'
import type { Identifier } from './identifier.ts'
import type { Verdict } from './verdict.ts'

/**
 * The outcome of evaluating one policy against a `Context`: its verdict, and
 * how it says the restricted fields of the answer may be shown to this
 * caller — nothing, unless the policy has a `show` rule.
 */
export class Result {
  readonly policy: Identifier
  readonly verdict: Verdict
  readonly disclosure: Disclosure.Disclosure

  constructor(
    policy: Identifier,
    verdict: Verdict,
    disclosure: Disclosure.Disclosure = Disclosure.Disclosure.none,
  ) {
    this.policy = policy
    this.verdict = verdict
    this.disclosure = disclosure
  }
}

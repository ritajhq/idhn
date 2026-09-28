import { Delegate, type Emitter } from '@duesabati/evento'
import type * as Access from '@idhn/access'
import type { Behavior } from './behavior.ts'
import type { Deadline } from './deadline.ts'
import type { Decision } from './decision.ts'
import type { DecisionRecord } from './decision-record.ts'
import type { Local } from './local.ts'
import { UnavailableError } from './unavailable-error.ts'

/**
 * A `Behavior` whose judge can be swapped while it serves: every judgement
 * goes to the judge it was last given, so new policies take effect without
 * restarting whoever asks it. A judgement already under way finishes with
 * the judge it started with.
 *
 * Until it has been given a judge, every judgement fails as unavailable —
 * there is nothing to judge with yet, but there may be soon.
 *
 * Every judge it is given announces its decisions on this `OnDecision`, so
 * subscribers see one stream across swaps, including the late decisions of a
 * judge already replaced.
 */
export class Reloadable implements Behavior {
  private readonly decision = new Delegate<[DecisionRecord]>()
  private current: Local | undefined

  get OnDecision(): Emitter<[DecisionRecord]> {
    return this.decision
  }

  /** Judge with `judge` from now on. */
  replace(judge: Local): void {
    judge.OnDecision.Do((record) => this.decision.Invoke(record))
    this.current = judge
  }

  decide(
    action: Access.Action,
    context: Access.Context,
    deadline: Deadline,
  ): Promise<Decision> {
    if (this.current === undefined) {
      return Promise.reject(new UnavailableError('No policies loaded yet'))
    }
    return this.current.decide(action, context, deadline)
  }
}

import * as Horizon from '@ritaj/horizon'
import type { DraftView } from './policies.ts'
import type { Rejected, Stale } from './faults.ts'

// Not part of any namespace the contract exports: it is no call of its own,
// only what every change to the draft is.
/** A change to the draft, made only if it is still at revision `basedOn`. */
export abstract class Change
  extends Horizon.Action<DraftView, Rejected | Stale> {
  private readonly basedOn = this.c.Number(0, 'policies.based_on')

  constructor(basedOn = 0) {
    super()
    this.basedOn.Write(basedOn)
  }

  get BasedOn(): number {
    return this.basedOn.Read()
  }
}

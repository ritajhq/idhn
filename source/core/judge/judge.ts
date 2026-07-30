import type { Action } from './action.ts'
import type { Context } from './context.ts'
import type { Decision } from './decision.ts'

/** Answers "is this action allowed?". Implemented locally (`LocalJudge`) or by a client to a remote judge process. */
export interface Judge {
  decide(action: Action, context: Context): Promise<Decision>
}

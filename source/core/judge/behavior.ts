import type * as Access from '@idhn/access'
import type { Decision } from './decision.ts'

export interface Behavior {
  decide(action: Access.Action, context: Access.Context): Promise<Decision>
}

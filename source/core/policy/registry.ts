import type * as Access from '@idhn/access'
import type { Identifier } from './identifier.ts'
import type { Repository } from './repository.ts'

/**
 * Storage for which policies govern which actions. Extends `Repository`
 * (the read side `Judge.Local` depends on) with the mutations needed to
 * maintain that association — registering or removing a single
 * action/policy pairing. Kept independent of any particular backing store;
 * a concrete implementation could be in-memory, SQL-backed, or a client to a
 * separate registry service, all without `Judge.Local` ever depending on
 * more than `Repository`.
 */
export interface Registry extends Repository {
  /** Registers `policy` as governing `action`. Idempotent — a no-op if already associated. */
  associate(action: Access.Action, policy: Identifier): Promise<void>
  /** Removes `policy` from governing `action`. A no-op if not associated. */
  dissociate(action: Access.Action, policy: Identifier): Promise<void>
}

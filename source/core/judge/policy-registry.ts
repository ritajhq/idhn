import type { Action } from './action.ts'
import type { Policy } from './policy.ts'
import type { PolicyRepository } from './policy-repository.ts'

/**
 * Storage for which policies govern which actions. Extends `PolicyRepository`
 * (the read side `Judge` depends on) with the mutations needed to maintain
 * that association — registering or removing a single action/policy pairing.
 * Kept independent of any particular backing store; a concrete
 * implementation could be in-memory, SQL-backed, or a client to a separate
 * registry service, all without `Judge` ever depending on more than
 * `PolicyRepository`.
 */
export interface PolicyRegistry extends PolicyRepository {
  /** Registers `policy` as governing `action`. Idempotent — a no-op if already associated. */
  associate(action: Action, policy: Policy): Promise<void>
  /** Removes `policy` from governing `action`. A no-op if not associated. */
  dissociate(action: Action, policy: Policy): Promise<void>
}

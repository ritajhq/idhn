import type { Action } from './action.ts'
import type { Policy } from './policy.ts'
import type { PolicyRegistry } from './policy-registry.ts'

/** A `PolicyRegistry` backed by an in-memory map. Useful for tests and early development. */
export class InMemoryPolicyRegistry implements PolicyRegistry {
  private readonly policiesByAction = new Map<string, Policy[]>()

  // deno-lint-ignore require-await
  async associate(action: Action, policy: Policy): Promise<void> {
    const policies = this.policiesByAction.get(action.name) ?? []
    if (policies.some((existing) => existing.equals(policy))) {
      return
    }
    this.policiesByAction.set(action.name, [...policies, policy])
  }

  // deno-lint-ignore require-await
  async dissociate(action: Action, policy: Policy): Promise<void> {
    const policies = this.policiesByAction.get(action.name)
    if (policies === undefined) {
      return
    }
    this.policiesByAction.set(
      action.name,
      policies.filter((existing) => !existing.equals(policy)),
    )
  }

  // deno-lint-ignore require-await
  async findPoliciesFor(action: Action): Promise<Policy[]> {
    return this.policiesByAction.get(action.name) ?? []
  }
}

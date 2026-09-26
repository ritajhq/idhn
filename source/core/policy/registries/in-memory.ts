import type * as Access from '@idhn/access'
import type { Identifier } from '../identifier.ts'
import type { Registry } from '../registry.ts'

/** A `Registry` backed by an in-memory map. Useful for tests and early development. */
export class InMemory implements Registry {
  private readonly policiesByAction = new Map<string, Identifier[]>()

  // deno-lint-ignore require-await
  async associate(action: Access.Action, policy: Identifier): Promise<void> {
    const policies = this.policiesByAction.get(action.name) ?? []
    if (policies.some((existing) => existing.equals(policy))) {
      return
    }
    this.policiesByAction.set(action.name, [...policies, policy])
  }

  // deno-lint-ignore require-await
  async dissociate(action: Access.Action, policy: Identifier): Promise<void> {
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
  async findPoliciesFor(action: Access.Action): Promise<Identifier[]> {
    return this.policiesByAction.get(action.name) ?? []
  }
}

import type * as Access from '@idhn/access'
import type { Identifier } from '../identifier.ts'
import type { Registry } from '../registry.ts'

/**
 * A `Registry` backed by an in-memory map, empty or starting from given
 * associations (e.g. `Associations.parse`d from a registry document that
 * arrived some other way than as a file). Also useful for tests.
 */
export class InMemory implements Registry {
  constructor(
    private readonly policiesByAction: Map<string, Identifier[]> = new Map(),
  ) {}

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

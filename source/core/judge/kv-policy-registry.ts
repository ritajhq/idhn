import type { Action } from './action.ts'
import { Policy } from './policy.ts'
import type { PolicyRegistry } from './policy-registry.ts'

const KEY_PREFIX = 'policies'

/** A `PolicyRegistry` persisted in Deno KV. One row per (action, policy) association. */
export class KvPolicyRegistry implements PolicyRegistry {
  constructor(private readonly kv: Deno.Kv) {}

  async associate(action: Action, policy: Policy): Promise<void> {
    await this.kv.set([KEY_PREFIX, action.name, policy.id], true)
  }

  async dissociate(action: Action, policy: Policy): Promise<void> {
    await this.kv.delete([KEY_PREFIX, action.name, policy.id])
  }

  async findPoliciesFor(action: Action): Promise<Policy[]> {
    const policies: Policy[] = []
    for await (
      const entry of this.kv.list({ prefix: [KEY_PREFIX, action.name] })
    ) {
      policies.push(new Policy(entry.key[2] as string))
    }
    return policies
  }
}

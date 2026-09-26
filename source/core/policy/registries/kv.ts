import type * as Access from '@idhn/access'
import { Identifier } from '../identifier.ts'
import type { Registry } from '../registry.ts'

const KEY_PREFIX = 'policies'

/** A `Registry` persisted in Deno KV. One row per (action, policy) association. */
export class Kv implements Registry {
  constructor(private readonly kv: Deno.Kv) {}

  async associate(action: Access.Action, policy: Identifier): Promise<void> {
    await this.kv.set([KEY_PREFIX, action.name, policy.toString()], true)
  }

  async dissociate(action: Access.Action, policy: Identifier): Promise<void> {
    await this.kv.delete([KEY_PREFIX, action.name, policy.toString()])
  }

  async findPoliciesFor(action: Access.Action): Promise<Identifier[]> {
    const policies: Identifier[] = []
    for await (
      const entry of this.kv.list({ prefix: [KEY_PREFIX, action.name] })
    ) {
      policies.push(new Identifier(policyPathOf(entry.key)))
    }
    return policies
  }
}

function policyPathOf(key: Deno.KvKey): string {
  const path = key[2]
  if (typeof path !== 'string') {
    throw new MalformedRowError(
      `Expected a string policy path at ${JSON.stringify(key)}[2]`,
    )
  }
  return path
}

export class MalformedRowError extends Error {}

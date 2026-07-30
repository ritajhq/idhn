import { assertEquals } from '@std/assert'
import { Action } from './action.ts'
import { KvPolicyRegistry } from './kv-policy-registry.ts'
import { Policy } from './policy.ts'

const action = new Action('invoice.approve')
const policyA = new Policy('policy.a')
const policyB = new Policy('policy.b')

async function withRegistry(
  run: (registry: KvPolicyRegistry) => Promise<void>,
): Promise<void> {
  const kv = await Deno.openKv(':memory:')
  try {
    await run(new KvPolicyRegistry(kv))
  } finally {
    kv.close()
  }
}

Deno.test('KvPolicyRegistry.findPoliciesFor: returns an empty list for an action with no associations', async () => {
  await withRegistry(async (registry) => {
    const policies = await registry.findPoliciesFor(action)

    assertEquals(policies, [])
  })
})

Deno.test('KvPolicyRegistry.associate: makes a policy findable for the given action', async () => {
  await withRegistry(async (registry) => {
    await registry.associate(action, policyA)
    await registry.associate(action, policyB)

    const policies = await registry.findPoliciesFor(action)
    assertEquals(policies, [policyA, policyB])
  })
})

Deno.test('KvPolicyRegistry.associate: is idempotent for the same action/policy pair', async () => {
  await withRegistry(async (registry) => {
    await registry.associate(action, policyA)
    await registry.associate(action, policyA)

    const policies = await registry.findPoliciesFor(action)
    assertEquals(policies, [policyA])
  })
})

Deno.test('KvPolicyRegistry.dissociate: removes an association', async () => {
  await withRegistry(async (registry) => {
    await registry.associate(action, policyA)
    await registry.associate(action, policyB)

    await registry.dissociate(action, policyA)

    const policies = await registry.findPoliciesFor(action)
    assertEquals(policies, [policyB])
  })
})

Deno.test('KvPolicyRegistry.dissociate: is a no-op when the association does not exist', async () => {
  await withRegistry(async (registry) => {
    await registry.associate(action, policyB)

    await registry.dissociate(action, policyA)

    const policies = await registry.findPoliciesFor(action)
    assertEquals(policies, [policyB])
  })
})

Deno.test('KvPolicyRegistry.dissociate: is a no-op for an action with no associations at all', async () => {
  await withRegistry(async (registry) => {
    await registry.dissociate(action, policyA)

    const policies = await registry.findPoliciesFor(action)
    assertEquals(policies, [])
  })
})

Deno.test('KvPolicyRegistry: associations for different actions are independent', async () => {
  await withRegistry(async (registry) => {
    const otherAction = new Action('invoice.reject')

    await registry.associate(action, policyA)
    await registry.associate(otherAction, policyB)

    assertEquals(await registry.findPoliciesFor(action), [policyA])
    assertEquals(await registry.findPoliciesFor(otherAction), [policyB])
  })
})

Deno.test('KvPolicyRegistry: survives across instances sharing the same underlying store', async () => {
  const kv = await Deno.openKv(':memory:')
  try {
    await new KvPolicyRegistry(kv).associate(action, policyA)

    const policies = await new KvPolicyRegistry(kv).findPoliciesFor(action)
    assertEquals(policies, [policyA])
  } finally {
    kv.close()
  }
})

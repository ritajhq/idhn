import { assertEquals } from '@std/assert'
import { Action } from './action.ts'
import { InMemoryPolicyRegistry } from './in-memory-policy-registry.ts'
import { Policy } from './policy.ts'

const action = new Action('invoice.approve')
const policyA = new Policy('policy.a')
const policyB = new Policy('policy.b')

Deno.test('InMemoryPolicyRegistry.findPoliciesFor: returns an empty list for an action with no associations', async () => {
  const registry = new InMemoryPolicyRegistry()

  const policies = await registry.findPoliciesFor(action)

  assertEquals(policies, [])
})

Deno.test('InMemoryPolicyRegistry.associate: makes a policy findable for the given action', async () => {
  const registry = new InMemoryPolicyRegistry()

  await registry.associate(action, policyA)
  await registry.associate(action, policyB)

  const policies = await registry.findPoliciesFor(action)
  assertEquals(policies, [policyA, policyB])
})

Deno.test('InMemoryPolicyRegistry.associate: is idempotent for the same action/policy pair', async () => {
  const registry = new InMemoryPolicyRegistry()

  await registry.associate(action, policyA)
  await registry.associate(action, policyA)

  const policies = await registry.findPoliciesFor(action)
  assertEquals(policies, [policyA])
})

Deno.test('InMemoryPolicyRegistry.dissociate: removes an association', async () => {
  const registry = new InMemoryPolicyRegistry()
  await registry.associate(action, policyA)
  await registry.associate(action, policyB)

  await registry.dissociate(action, policyA)

  const policies = await registry.findPoliciesFor(action)
  assertEquals(policies, [policyB])
})

Deno.test('InMemoryPolicyRegistry.dissociate: is a no-op when the association does not exist', async () => {
  const registry = new InMemoryPolicyRegistry()
  await registry.associate(action, policyB)

  await registry.dissociate(action, policyA)

  const policies = await registry.findPoliciesFor(action)
  assertEquals(policies, [policyB])
})

Deno.test('InMemoryPolicyRegistry.dissociate: is a no-op for an action with no associations at all', async () => {
  const registry = new InMemoryPolicyRegistry()

  await registry.dissociate(action, policyA)

  const policies = await registry.findPoliciesFor(action)
  assertEquals(policies, [])
})

Deno.test('InMemoryPolicyRegistry: associations for different actions are independent', async () => {
  const registry = new InMemoryPolicyRegistry()
  const otherAction = new Action('invoice.reject')

  await registry.associate(action, policyA)
  await registry.associate(otherAction, policyB)

  assertEquals(await registry.findPoliciesFor(action), [policyA])
  assertEquals(await registry.findPoliciesFor(otherAction), [policyB])
})

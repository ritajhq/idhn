import { assertEquals } from '@std/assert'
import * as Access from '@idhn/access'
import { Identifier } from '../identifier.ts'
import { InMemory } from './in-memory.ts'

const action = new Access.Action('invoice.approve')
const policyA = new Identifier('policy.a')
const policyB = new Identifier('policy.b')

Deno.test('InMemory.findPoliciesFor: returns an empty list for an action with no associations', async () => {
  const registry = new InMemory()

  const policies = await registry.findPoliciesFor(action)

  assertEquals(policies, [])
})

Deno.test('InMemory.associate: makes a policy findable for the given action', async () => {
  const registry = new InMemory()

  await registry.associate(action, policyA)
  await registry.associate(action, policyB)

  const policies = await registry.findPoliciesFor(action)
  assertEquals(policies, [policyA, policyB])
})

Deno.test('InMemory.associate: is idempotent for the same action/policy pair', async () => {
  const registry = new InMemory()

  await registry.associate(action, policyA)
  await registry.associate(action, policyA)

  const policies = await registry.findPoliciesFor(action)
  assertEquals(policies, [policyA])
})

Deno.test('InMemory.dissociate: removes an association', async () => {
  const registry = new InMemory()
  await registry.associate(action, policyA)
  await registry.associate(action, policyB)

  await registry.dissociate(action, policyA)

  const policies = await registry.findPoliciesFor(action)
  assertEquals(policies, [policyB])
})

Deno.test('InMemory.dissociate: is a no-op when the association does not exist', async () => {
  const registry = new InMemory()
  await registry.associate(action, policyB)

  await registry.dissociate(action, policyA)

  const policies = await registry.findPoliciesFor(action)
  assertEquals(policies, [policyB])
})

Deno.test('InMemory.dissociate: is a no-op for an action with no associations at all', async () => {
  const registry = new InMemory()

  await registry.dissociate(action, policyA)

  const policies = await registry.findPoliciesFor(action)
  assertEquals(policies, [])
})

Deno.test('InMemory: associations for different actions are independent', async () => {
  const registry = new InMemory()
  const otherAction = new Access.Action('invoice.reject')

  await registry.associate(action, policyA)
  await registry.associate(otherAction, policyB)

  assertEquals(await registry.findPoliciesFor(action), [policyA])
  assertEquals(await registry.findPoliciesFor(otherAction), [policyB])
})

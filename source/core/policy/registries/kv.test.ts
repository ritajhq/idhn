import { assertEquals, assertRejects } from '@std/assert'
import * as Access from '@idhn/access'
import { Identifier } from '../identifier.ts'
import { Kv, MalformedRowError } from './kv.ts'

const action = new Access.Action('invoice.approve')
const policyA = new Identifier('policy.a')
const policyB = new Identifier('policy.b')

async function withRegistry(
  run: (registry: Kv) => Promise<void>,
): Promise<void> {
  const kv = await Deno.openKv(':memory:')
  try {
    await run(new Kv(kv))
  } finally {
    kv.close()
  }
}

Deno.test('Kv.findPoliciesFor: returns an empty list for an action with no associations', async () => {
  await withRegistry(async (registry) => {
    const policies = await registry.findPoliciesFor(action)

    assertEquals(policies, [])
  })
})

Deno.test('Kv.associate: makes a policy findable for the given action', async () => {
  await withRegistry(async (registry) => {
    await registry.associate(action, policyA)
    await registry.associate(action, policyB)

    const policies = await registry.findPoliciesFor(action)
    assertEquals(policies, [policyA, policyB])
  })
})

Deno.test('Kv.associate: is idempotent for the same action/policy pair', async () => {
  await withRegistry(async (registry) => {
    await registry.associate(action, policyA)
    await registry.associate(action, policyA)

    const policies = await registry.findPoliciesFor(action)
    assertEquals(policies, [policyA])
  })
})

Deno.test('Kv.dissociate: removes an association', async () => {
  await withRegistry(async (registry) => {
    await registry.associate(action, policyA)
    await registry.associate(action, policyB)

    await registry.dissociate(action, policyA)

    const policies = await registry.findPoliciesFor(action)
    assertEquals(policies, [policyB])
  })
})

Deno.test('Kv.dissociate: is a no-op when the association does not exist', async () => {
  await withRegistry(async (registry) => {
    await registry.associate(action, policyB)

    await registry.dissociate(action, policyA)

    const policies = await registry.findPoliciesFor(action)
    assertEquals(policies, [policyB])
  })
})

Deno.test('Kv.dissociate: is a no-op for an action with no associations at all', async () => {
  await withRegistry(async (registry) => {
    await registry.dissociate(action, policyA)

    const policies = await registry.findPoliciesFor(action)
    assertEquals(policies, [])
  })
})

Deno.test('Kv: associations for different actions are independent', async () => {
  await withRegistry(async (registry) => {
    const otherAction = new Access.Action('invoice.reject')

    await registry.associate(action, policyA)
    await registry.associate(otherAction, policyB)

    assertEquals(await registry.findPoliciesFor(action), [policyA])
    assertEquals(await registry.findPoliciesFor(otherAction), [policyB])
  })
})

Deno.test('Kv: survives across instances sharing the same underlying store', async () => {
  const kv = await Deno.openKv(':memory:')
  try {
    await new Kv(kv).associate(action, policyA)

    const policies = await new Kv(kv).findPoliciesFor(action)
    assertEquals(policies, [policyA])
  } finally {
    kv.close()
  }
})

Deno.test('Kv.findPoliciesFor: throws MalformedRowError when a row has a non-string policy path', async () => {
  const kv = await Deno.openKv(':memory:')
  try {
    await kv.set(['policies', action.name, 42], true)

    await assertRejects(
      () => new Kv(kv).findPoliciesFor(action),
      MalformedRowError,
    )
  } finally {
    kv.close()
  }
})

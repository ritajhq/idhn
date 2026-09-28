import { assertEquals, assertRejects } from '@std/assert'
import * as Access from '@idhn/access'
import { Identifier } from '../identifier.ts'
import { File } from './file.ts'
import { MalformedFileError } from './associations.ts'

const action = new Access.Action('invoice.approve')
const policyA = new Identifier('policy.a')
const policyB = new Identifier('policy.b')

async function withFile(
  content: string,
  run: (path: string) => Promise<void>,
): Promise<void> {
  const path = await Deno.makeTempFile({ suffix: '.yaml' })
  try {
    await Deno.writeTextFile(path, content)
    await run(path)
  } finally {
    await Deno.remove(path)
  }
}

Deno.test('File.findPoliciesFor: returns the policies the file associates with the action', async () => {
  await withFile(
    'associations:\n  invoice.approve: [policy.a, policy.b]\n',
    async (path) => {
      const registry = await File.load(path)

      assertEquals(await registry.findPoliciesFor(action), [policyA, policyB])
    },
  )
})

Deno.test('File.findPoliciesFor: returns an empty list for an action the file does not mention', async () => {
  await withFile('associations: {}\n', async (path) => {
    const registry = await File.load(path)

    assertEquals(await registry.findPoliciesFor(action), [])
  })
})

Deno.test('File.load: treats a file with no associations key as empty', async () => {
  await withFile('{}\n', async (path) => {
    const registry = await File.load(path)

    assertEquals(await registry.findPoliciesFor(action), [])
  })
})

Deno.test('File.associate: persists the association so a fresh load finds it', async () => {
  await withFile('associations: {}\n', async (path) => {
    const registry = await File.load(path)
    await registry.associate(action, policyA)
    await registry.associate(action, policyA)

    const reloaded = await File.load(path)
    assertEquals(await reloaded.findPoliciesFor(action), [policyA])
  })
})

Deno.test('File.dissociate: persists the removal so a fresh load no longer finds it', async () => {
  await withFile(
    'associations:\n  invoice.approve: [policy.a, policy.b]\n',
    async (path) => {
      const registry = await File.load(path)
      await registry.dissociate(action, policyA)

      const reloaded = await File.load(path)
      assertEquals(await reloaded.findPoliciesFor(action), [policyB])
    },
  )
})

Deno.test('File.load: rejects an action whose policies are not a list', async () => {
  await withFile(
    'associations:\n  invoice.approve: policy.a\n',
    async (path) => {
      await assertRejects(
        () => File.load(path),
        MalformedFileError,
        'associations.invoice.approve must be an array',
      )
    },
  )
})

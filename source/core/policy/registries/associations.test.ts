import { assertEquals, assertThrows } from '@std/assert'
import * as Access from '@idhn/access'
import { Associations, MalformedFileError } from './associations.ts'
import { InMemory } from './in-memory.ts'

Deno.test('Associations.parse: reads the policies governing each action from YAML text', () => {
  const associations = new Associations().parse(
    'associations:\n  shop.browse: [catalog.browse, shop.open]\n',
  )

  assertEquals(
    associations.get('shop.browse')?.map((policy) => policy.toString()),
    ['catalog.browse', 'shop.open'],
  )
})

Deno.test('Associations.parse: rejects a document that is not an associations map', () => {
  assertThrows(
    () => new Associations().parse('associations: [not, a, map]'),
    MalformedFileError,
  )
})

Deno.test('InMemory: answers from the associations it starts with', async () => {
  const registry = new InMemory(
    new Associations().parse('associations:\n  shop.browse: [catalog.browse]\n'),
  )

  const policies = await registry.findPoliciesFor(new Access.Action('shop.browse'))

  assertEquals(policies.map((policy) => policy.toString()), ['catalog.browse'])
})

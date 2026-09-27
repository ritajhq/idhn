import { assertEquals } from '@std/assert'
import * as Access from '@idhn/access'
import type { Behavior } from './behavior.ts'
import { Deadline } from './deadline.ts'
import { Permissive } from './permissive.ts'

Deno.test('Permissive.decide: allows any action, with no results and no id since nothing was judged', async () => {
  const judge: Behavior = new Permissive()
  const decision = await judge.decide(
    new Access.Action('invoice.approve'),
    new Access.Context({}),
    Deadline.unbounded(),
  )

  assertEquals(decision.allowed, true)
  assertEquals(decision.results, [])
  assertEquals(decision.id, undefined)
})

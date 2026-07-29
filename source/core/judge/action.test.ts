import { assertEquals, assertThrows } from '@std/assert'
import { Action, InvalidActionError } from './action.ts'

Deno.test('Action: equals compares by name', () => {
  assertEquals(
    new Action('invoice.approve').equals(new Action('invoice.approve')),
    true,
  )
  assertEquals(
    new Action('invoice.approve').equals(new Action('invoice.reject')),
    false,
  )
})

Deno.test('Action: rejects an empty or blank name', () => {
  assertThrows(() => new Action(''), InvalidActionError)
  assertThrows(() => new Action('   '), InvalidActionError)
})

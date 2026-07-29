import { assertEquals, assertThrows } from '@std/assert'
import { InvalidPolicyError, Policy } from './policy.ts'

Deno.test('Policy: equals compares by id', () => {
  assertEquals(new Policy('policy.a').equals(new Policy('policy.a')), true)
  assertEquals(new Policy('policy.a').equals(new Policy('policy.b')), false)
})

Deno.test('Policy: rejects an empty or blank id', () => {
  assertThrows(() => new Policy(''), InvalidPolicyError)
  assertThrows(() => new Policy('   '), InvalidPolicyError)
})

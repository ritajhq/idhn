import { assertEquals, assertThrows } from '@std/assert'
import { Identifier, InvalidIdentifierError } from './identifier.ts'

Deno.test('Identifier: equals compares by path', () => {
  assertEquals(
    new Identifier('policy.a').equals(new Identifier('policy.a')),
    true,
  )
  assertEquals(
    new Identifier('policy.a').equals(new Identifier('policy.b')),
    false,
  )
})

Deno.test('Identifier: exposes its dotted path as segments', () => {
  assertEquals(new Identifier('invoice.approve').segments, [
    'invoice',
    'approve',
  ])
})

Deno.test('Identifier: round-trips through its text form', () => {
  assertEquals(
    String(new Identifier('invoice.approve.base')),
    'invoice.approve.base',
  )
})

Deno.test('Identifier: rejects an empty, blank or malformed path', () => {
  for (const path of ['', '   ', '.a', 'a.', 'a..b', 'a. .b']) {
    assertThrows(() => new Identifier(path), InvalidIdentifierError)
  }
})

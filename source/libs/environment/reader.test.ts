import { assertEquals, assertThrows } from '@std/assert'
import { InvalidError } from './invalid-error.ts'
import { Reader } from './reader.ts'

function readerOf(values: Record<string, string>): Reader {
  return new Reader({ get: (name) => values[name] })
}

Deno.test('Reader.requireString: returns the value, and rejects an unset or empty one', () => {
  assertEquals(readerOf({ A: 'x' }).requireString('A'), 'x')
  assertThrows(
    () => readerOf({}).requireString('A'),
    InvalidError,
    'A must be set',
  )
  assertThrows(
    () => readerOf({ A: '' }).requireString('A'),
    InvalidError,
    'A must be set',
  )
})

Deno.test('Reader.optionalString: treats an empty value as unset', () => {
  assertEquals(readerOf({ A: 'x' }).optionalString('A'), 'x')
  assertEquals(readerOf({ A: '' }).optionalString('A'), undefined)
  assertEquals(readerOf({}).optionalString('A'), undefined)
})

Deno.test('Reader.requireUrl: parses the value, and rejects an unset or malformed one', () => {
  assertEquals(
    readerOf({ A: 'http://x.test/' }).requireUrl('A').href,
    'http://x.test/',
  )
  assertThrows(
    () => readerOf({}).requireUrl('A'),
    InvalidError,
    'A must be set',
  )
  assertThrows(
    () => readerOf({ A: 'nope' }).requireUrl('A'),
    InvalidError,
    'valid URL',
  )
})

Deno.test('Reader.optionalUrl: is undefined when unset, and rejects a malformed value', () => {
  assertEquals(readerOf({}).optionalUrl('A'), undefined)
  assertEquals(
    readerOf({ A: 'http://x.test/' }).optionalUrl('A')?.href,
    'http://x.test/',
  )
  assertThrows(
    () => readerOf({ A: 'nope' }).optionalUrl('A'),
    InvalidError,
    'valid URL',
  )
})

Deno.test('Reader.port: falls back when unset, and rejects anything but a valid port', () => {
  assertEquals(readerOf({}).port('P', 8080), 8080)
  assertEquals(readerOf({ P: '9200' }).port('P', 8080), 9200)
  for (const bad of ['abc', '0', '-1', '65536', '80.5']) {
    assertThrows(
      () => readerOf({ P: bad }).port('P', 8080),
      InvalidError,
      'valid port number',
    )
  }
})

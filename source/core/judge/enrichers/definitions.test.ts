import { assertInstanceOf, assertThrows } from '@std/assert'
import { Chain } from './chain.ts'
import { Definitions, InvalidDefinitionError } from './source.ts'

Deno.test('Definitions.parse: builds the lookups a YAML text declares', () => {
  const enricher = new Definitions().parse(
    'lookups:\n  - as: directory\n    http:\n      url: http://directory.internal/{subject}\n',
  )

  assertInstanceOf(enricher, Chain)
})

Deno.test('Definitions.parse: rejects a lookup without a url', () => {
  assertThrows(
    () => new Definitions().parse('lookups:\n  - as: directory\n    http: {}\n'),
    InvalidDefinitionError,
  )
})

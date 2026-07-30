import { assertEquals, assertThrows } from '@std/assert'
import { ManifestParseError, parseManifest } from './parse-manifest.ts'

const validRaw = {
  id: 'billing_service',
  actions: [
    {
      name: 'invoice.approve',
      match: {
        method: 'POST',
        path: '/invoices/:id/approve',
        header: [{ name: 'x-api-version', value: '2' }],
      },
      extract: [
        { from: { property: 'path', using: 'id' }, as: 'invoiceId' },
        { from: { property: 'header', using: 'x-user-id' }, as: 'subject' },
        {
          from: { property: 'header', using: 'x-request-note' },
          as: 'note',
          optional: true,
        },
        {
          from: { property: 'body', using: 'customer.id', type: 'json' },
          as: 'customerId',
        },
        {
          from: { property: 'constant', using: 'production' },
          as: 'environment',
        },
      ],
    },
    {
      name: 'invoice.read',
      match: {
        method: ['GET', 'HEAD'],
        path: ['/invoices/:id', '/invoices/:id/summary'],
      },
    },
  ],
}

Deno.test('parseManifest: parses a fully-populated manifest', () => {
  const manifest = parseManifest(validRaw)

  assertEquals(manifest.id, 'billing_service')
  assertEquals(manifest.actions.length, 2)
  assertEquals(manifest.actions[0].name, 'invoice.approve')
  assertEquals(manifest.actions[0].extract?.length, 5)
  assertEquals(manifest.actions[1].extract, undefined)
})

Deno.test('parseManifest: rejects a non-object root', () => {
  assertThrows(() => parseManifest('not an object'), ManifestParseError)
  assertThrows(() => parseManifest(null), ManifestParseError)
  assertThrows(() => parseManifest([]), ManifestParseError)
})

Deno.test('parseManifest: rejects a missing id', () => {
  assertThrows(
    () => parseManifest({ actions: [] }),
    ManifestParseError,
    'manifest.id',
  )
})

Deno.test('parseManifest: rejects a missing actions array', () => {
  assertThrows(
    () => parseManifest({ id: 'x' }),
    ManifestParseError,
    'manifest.actions',
  )
})

Deno.test('parseManifest: rejects an action with no name', () => {
  assertThrows(
    () =>
      parseManifest({
        id: 'x',
        actions: [{ match: { method: 'GET', path: '/a' } }],
      }),
    ManifestParseError,
    'name',
  )
})

Deno.test('parseManifest: rejects match.method that is neither a string nor a string array', () => {
  assertThrows(
    () =>
      parseManifest({
        id: 'x',
        actions: [{ name: 'a', match: { method: 123, path: '/a' } }],
      }),
    ManifestParseError,
    'match.method',
  )
})

Deno.test('parseManifest: rejects match.header entries that are neither strings nor {name, value} objects', () => {
  assertThrows(
    () =>
      parseManifest({
        id: 'x',
        actions: [
          { name: 'a', match: { method: 'GET', path: '/a', header: [42] } },
        ],
      }),
    ManifestParseError,
  )
})

Deno.test('parseManifest: rejects an unknown from.property', () => {
  assertThrows(
    () =>
      parseManifest({
        id: 'x',
        actions: [
          {
            name: 'a',
            match: { method: 'GET', path: '/a' },
            extract: [{ from: { property: 'nope', using: 'x' }, as: 'y' }],
          },
        ],
      }),
    ManifestParseError,
    'from.property',
  )
})

Deno.test('parseManifest: rejects from.type on a non-body property', () => {
  assertThrows(
    () =>
      parseManifest({
        id: 'x',
        actions: [
          {
            name: 'a',
            match: { method: 'GET', path: '/a' },
            extract: [
              {
                from: { property: 'header', using: 'x-user-id', type: 'json' },
                as: 'y',
              },
            ],
          },
        ],
      }),
    ManifestParseError,
    'only meaningful when property is "body"',
  )
})

Deno.test('parseManifest: rejects an extract entry with no "as"', () => {
  assertThrows(
    () =>
      parseManifest({
        id: 'x',
        actions: [
          {
            name: 'a',
            match: { method: 'GET', path: '/a' },
            extract: [{ from: { property: 'path', using: 'id' } }],
          },
        ],
      }),
    ManifestParseError,
    '.as',
  )
})

Deno.test('parseManifest: rejects a hyphenated id (invalid Rego package segment)', () => {
  assertThrows(
    () => parseManifest({ id: 'billing-service', actions: [] }),
    ManifestParseError,
    'manifest.id',
  )
})

Deno.test('parseManifest: rejects an id starting with a digit', () => {
  assertThrows(
    () => parseManifest({ id: '1service', actions: [] }),
    ManifestParseError,
    'manifest.id',
  )
})

Deno.test('parseManifest: accepts an underscore-separated id', () => {
  const manifest = parseManifest({ id: 'billing_service', actions: [] })
  assertEquals(manifest.id, 'billing_service')
})

Deno.test('parseManifest: rejects an action name with a hyphenated segment', () => {
  assertThrows(
    () =>
      parseManifest({
        id: 'x',
        actions: [
          { name: 'invoice.fraud-check', match: { method: 'GET', path: '/a' } },
        ],
      }),
    ManifestParseError,
    'fraud-check',
  )
})

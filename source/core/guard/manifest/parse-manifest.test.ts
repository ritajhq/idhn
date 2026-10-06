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

Deno.test('parseManifest: rejects an extract entry that writes the reserved auth fact', () => {
  assertThrows(
    () =>
      parseManifest({
        id: 'x',
        actions: [
          {
            name: 'a',
            match: { method: 'GET', path: '/a' },
            extract: [{
              from: { property: 'header', using: 'x-auth' },
              as: 'auth',
            }],
          },
        ],
      }),
    ManifestParseError,
    'reserved',
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

Deno.test('parseManifest: defaults to the http protocol when none is declared', () => {
  assertEquals(parseManifest(validRaw).protocol, 'http')
})

Deno.test('parseManifest: accepts an explicit http protocol', () => {
  assertEquals(
    parseManifest({ ...validRaw, protocol: 'http' }).protocol,
    'http',
  )
})

Deno.test('parseManifest: rejects an unknown protocol', () => {
  assertThrows(
    () => parseManifest({ ...validRaw, protocol: 'carrier-pigeon' }),
    ManifestParseError,
    'manifest.protocol must be one of: http',
  )
})

Deno.test('parseManifest: authenticates no one when no authentication is declared', () => {
  assertEquals(parseManifest(validRaw).authentication, { scheme: 'none' })
})

Deno.test('parseManifest: accepts an explicit none scheme', () => {
  assertEquals(
    parseManifest({ ...validRaw, authentication: { scheme: 'none' } })
      .authentication,
    { scheme: 'none' },
  )
})

Deno.test('parseManifest: rejects an authentication block that is not an object', () => {
  assertThrows(
    () => parseManifest({ ...validRaw, authentication: 'session-cookie' }),
    ManifestParseError,
    'manifest.authentication must be an object',
  )
})

Deno.test('parseManifest: rejects an unknown authentication scheme', () => {
  assertThrows(
    () => parseManifest({ ...validRaw, authentication: { scheme: 'magic' } }),
    ManifestParseError,
    'manifest.authentication.scheme must be one of',
  )
})

Deno.test('parseManifest: parses session-cookie settings, defaulting what is left out', () => {
  const manifest = parseManifest({
    ...validRaw,
    authentication: {
      scheme: 'session-cookie',
      session_url: 'http://auth.internal/api/auth/get-session',
    },
  })

  assertEquals(manifest.authentication, {
    scheme: 'session-cookie',
    sessionUrl: 'http://auth.internal/api/auth/get-session',
    cookie: 'better-auth.session_token',
    issuer: 'http://auth.internal',
    claims: ['username', 'email', 'name', 'emailVerified'],
    ttlSeconds: 5,
    timeoutMs: 2000,
  })
})

Deno.test('parseManifest: parses fully-specified session-cookie settings', () => {
  const manifest = parseManifest({
    ...validRaw,
    authentication: {
      scheme: 'session-cookie',
      session_url: 'https://auth.example.com/api/auth/get-session',
      cookie: '__Secure-better-auth.session_token',
      issuer: 'portal',
      claims: ['username'],
      ttl_seconds: 0,
      timeout_ms: 500,
    },
  })

  assertEquals(manifest.authentication, {
    scheme: 'session-cookie',
    sessionUrl: 'https://auth.example.com/api/auth/get-session',
    cookie: '__Secure-better-auth.session_token',
    issuer: 'portal',
    claims: ['username'],
    ttlSeconds: 0,
    timeoutMs: 500,
  })
})

Deno.test('parseManifest: rejects session-cookie settings without a valid session_url', () => {
  assertThrows(
    () =>
      parseManifest({
        ...validRaw,
        authentication: { scheme: 'session-cookie' },
      }),
    ManifestParseError,
    'manifest.authentication.session_url',
  )
  assertThrows(
    () =>
      parseManifest({
        ...validRaw,
        authentication: { scheme: 'session-cookie', session_url: 'not a url' },
      }),
    ManifestParseError,
    'must be a valid URL',
  )
})

Deno.test('parseManifest: rejects a negative session-cookie ttl_seconds', () => {
  assertThrows(
    () =>
      parseManifest({
        ...validRaw,
        authentication: {
          scheme: 'session-cookie',
          session_url: 'http://auth.internal/api/auth/get-session',
          ttl_seconds: -1,
        },
      }),
    ManifestParseError,
    'ttl_seconds',
  )
})

Deno.test('parseManifest: rejects a session-cookie timeout_ms that is not a positive number', () => {
  assertThrows(
    () =>
      parseManifest({
        ...validRaw,
        authentication: {
          scheme: 'session-cookie',
          session_url: 'http://auth.internal/api/auth/get-session',
          timeout_ms: 0,
        },
      }),
    ManifestParseError,
    'timeout_ms must be a positive number',
  )
})

Deno.test('parseManifest: reads the fields of an answer to restrict, each covered unless it says how else', () => {
  const manifest = parseManifest({
    id: 'directory',
    actions: [{
      name: 'members.list',
      match: { method: 'GET', path: '/members' },
      restrict: [
        { field: '/members/*/email', show: { kind: 'partial', form: 'email' } },
        { field: '/members/*/phone' },
      ],
    }],
  })
  assertEquals(manifest.actions[0].restrict?.toJSON(), {
    '/members/*/email': { kind: 'partial', form: 'email' },
    '/members/*/phone': 'covered',
  })
})

Deno.test('parseManifest: refuses a restriction it cannot read, naming where', () => {
  const restricting = (restrict: unknown) => () =>
    parseManifest({
      id: 'directory',
      actions: [{
        name: 'members.list',
        match: { method: 'GET', path: '/members' },
        restrict,
      }],
    })
  assertThrows(
    restricting([{ field: 'members' }]),
    ManifestParseError,
    'manifest.actions[0].restrict[0].field',
  )
  assertThrows(
    restricting([{ field: '/members', show: 'blurred' }]),
    ManifestParseError,
    'manifest.actions[0].restrict[0].show',
  )
  assertThrows(
    restricting({ field: '/members' }),
    ManifestParseError,
    'manifest.actions[0].restrict',
  )
})

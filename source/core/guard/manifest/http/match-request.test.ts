import { assertEquals } from '@std/assert'
import { matchRequest } from './match-request.ts'
import type { Match } from './schema.ts'

function request(
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://example.test${path}`, { method, headers })
}

Deno.test('matchRequest: matches a single method and path, capturing path params', () => {
  const match: Match = { method: 'POST', path: '/invoices/:id/approve' }

  const result = matchRequest(match, request('POST', '/invoices/42/approve'))

  assertEquals(result, { pathParams: { id: '42' } })
})

Deno.test('matchRequest: method comparison is case-insensitive', () => {
  const match: Match = { method: 'post', path: '/a' }

  const result = matchRequest(match, request('POST', '/a'))

  assertEquals(result, { pathParams: {} })
})

Deno.test('matchRequest: rejects a request whose method is not in the list', () => {
  const match: Match = { method: ['GET', 'HEAD'], path: '/a' }

  assertEquals(matchRequest(match, request('POST', '/a')), null)
})

Deno.test('matchRequest: accepts any method in an array', () => {
  const match: Match = { method: ['GET', 'HEAD'], path: '/a' }

  assertEquals(matchRequest(match, request('HEAD', '/a')), { pathParams: {} })
})

Deno.test('matchRequest: rejects a path that does not match any pattern', () => {
  const match: Match = { method: 'GET', path: '/a' }

  assertEquals(matchRequest(match, request('GET', '/b')), null)
})

Deno.test('matchRequest: matches against any pattern in a path array', () => {
  const match: Match = {
    method: 'GET',
    path: ['/invoices/:id', '/invoices/:id/summary'],
  }

  assertEquals(matchRequest(match, request('GET', '/invoices/7/summary')), {
    pathParams: { id: '7' },
  })
})

Deno.test('matchRequest: header criterion as a plain string requires presence only', () => {
  const match: Match = { method: 'GET', path: '/a', header: 'x-api-version' }

  assertEquals(
    matchRequest(match, request('GET', '/a', { 'x-api-version': 'anything' })),
    {
      pathParams: {},
    },
  )
  assertEquals(matchRequest(match, request('GET', '/a')), null)
})

Deno.test('matchRequest: header criterion as {name, value} requires an exact value', () => {
  const match: Match = {
    method: 'GET',
    path: '/a',
    header: [{ name: 'x-api-version', value: '2' }],
  }

  assertEquals(
    matchRequest(match, request('GET', '/a', { 'x-api-version': '2' })),
    {
      pathParams: {},
    },
  )
  assertEquals(
    matchRequest(match, request('GET', '/a', { 'x-api-version': '1' })),
    null,
  )
})

Deno.test('matchRequest: multiple header criteria must all be satisfied', () => {
  const match: Match = { method: 'GET', path: '/a', header: ['x-a', 'x-b'] }

  assertEquals(
    matchRequest(match, request('GET', '/a', { 'x-a': '1', 'x-b': '2' })),
    {
      pathParams: {},
    },
  )
  assertEquals(matchRequest(match, request('GET', '/a', { 'x-a': '1' })), null)
})

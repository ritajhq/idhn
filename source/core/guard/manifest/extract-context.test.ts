import { assertEquals } from '@std/assert'
import { extractContext } from './extract-context.ts'
import type { MatchResult } from './match-request.ts'
import type { ExtractEntry } from './schema.ts'

function request(
  init: { path?: string; headers?: Record<string, string>; body?: string } = {},
): Request {
  return new Request(`https://example.test${init.path ?? '/'}`, {
    method: 'POST',
    headers: init.headers,
    body: init.body,
  })
}

const noParams: MatchResult = { pathParams: {} }

Deno.test('extractContext: extracts a path param', async () => {
  const entries: ExtractEntry[] = [{
    from: { property: 'path', using: 'id' },
    as: 'invoiceId',
  }]
  const matchResult: MatchResult = { pathParams: { id: '42' } }

  const facts = await extractContext(entries, request(), matchResult)

  assertEquals(facts, { invoiceId: '42' })
})

Deno.test('extractContext: extracts a query param', async () => {
  const entries: ExtractEntry[] = [{
    from: { property: 'query', using: 'lang' },
    as: 'language',
  }]

  const facts = await extractContext(
    entries,
    request({ path: '/?lang=en' }),
    noParams,
  )

  assertEquals(facts, { language: 'en' })
})

Deno.test('extractContext: extracts a header', async () => {
  const entries: ExtractEntry[] = [{
    from: { property: 'header', using: 'x-user-id' },
    as: 'subject',
  }]

  const facts = await extractContext(
    entries,
    request({ headers: { 'x-user-id': 'alice' } }),
    noParams,
  )

  assertEquals(facts, { subject: 'alice' })
})

Deno.test('extractContext: extracts a constant regardless of the request', async () => {
  const entries: ExtractEntry[] = [
    { from: { property: 'constant', using: 'production' }, as: 'environment' },
  ]

  const facts = await extractContext(entries, request(), noParams)

  assertEquals(facts, { environment: 'production' })
})

Deno.test('extractContext: extracts a top-level JSON body field', async () => {
  const entries: ExtractEntry[] = [
    {
      from: { property: 'body', using: 'name', type: 'json' },
      as: 'customerName',
    },
  ]

  const facts = await extractContext(
    entries,
    request({ body: JSON.stringify({ name: 'Acme' }) }),
    noParams,
  )

  assertEquals(facts, { customerName: 'Acme' })
})

Deno.test('extractContext: extracts a nested JSON body field via a dotted path', async () => {
  const entries: ExtractEntry[] = [
    {
      from: { property: 'body', using: 'customer.id', type: 'json' },
      as: 'customerId',
    },
  ]

  const facts = await extractContext(
    entries,
    request({ body: JSON.stringify({ customer: { id: 'c-1' } }) }),
    noParams,
  )

  assertEquals(facts, { customerId: 'c-1' })
})

Deno.test('extractContext: extracts a form-urlencoded body field', async () => {
  const entries: ExtractEntry[] = [
    { from: { property: 'body', using: 'note', type: 'form' }, as: 'note' },
  ]

  const facts = await extractContext(
    entries,
    request({ body: 'note=hello+world' }),
    noParams,
  )

  assertEquals(facts, { note: 'hello world' })
})

Deno.test('extractContext: extracts the raw body as text', async () => {
  const entries: ExtractEntry[] = [
    { from: { property: 'body', using: 'ignored', type: 'text' }, as: 'raw' },
  ]

  const facts = await extractContext(
    entries,
    request({ body: 'plain text' }),
    noParams,
  )

  assertEquals(facts, { raw: 'plain text' })
})

Deno.test('extractContext: reads the body once and reuses it across multiple entries', async () => {
  const entries: ExtractEntry[] = [
    { from: { property: 'body', using: 'a', type: 'json' }, as: 'a' },
    { from: { property: 'body', using: 'b', type: 'json' }, as: 'b' },
  ]

  const facts = await extractContext(
    entries,
    request({ body: JSON.stringify({ a: 1, b: 2 }) }),
    noParams,
  )

  assertEquals(facts, { a: 1, b: 2 })
})

Deno.test('extractContext: returns null when a required header is missing', async () => {
  const entries: ExtractEntry[] = [{
    from: { property: 'header', using: 'x-user-id' },
    as: 'subject',
  }]

  const facts = await extractContext(entries, request(), noParams)

  assertEquals(facts, null)
})

Deno.test('extractContext: omits an optional missing field instead of failing', async () => {
  const entries: ExtractEntry[] = [
    {
      from: { property: 'header', using: 'x-request-note' },
      as: 'note',
      optional: true,
    },
  ]

  const facts = await extractContext(entries, request(), noParams)

  assertEquals(facts, {})
})

Deno.test('extractContext: returns null when a required body field is absent', async () => {
  const entries: ExtractEntry[] = [
    { from: { property: 'body', using: 'missing', type: 'json' }, as: 'x' },
  ]

  const facts = await extractContext(
    entries,
    request({ body: JSON.stringify({ present: 1 }) }),
    noParams,
  )

  assertEquals(facts, null)
})

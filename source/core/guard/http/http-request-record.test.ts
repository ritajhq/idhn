import { assertEquals } from '@std/assert'
import { Rejection } from '../rejection.ts'
import { RequestRecord } from '../request-record.ts'
import { HttpRequestRecord } from './http-request-record.ts'

Deno.test('HttpRequestRecord: carries the request method and path next to what the guard recorded', () => {
  const record = new RequestRecord(
    '2026-09-27T10:00:00.000Z',
    1.5,
    'rejected',
    undefined,
    undefined,
    undefined,
    Rejection.Forbidden,
    undefined,
  )

  const entry = JSON.parse(JSON.stringify(
    new HttpRequestRecord(
      new Request('https://guard.test/unknown?x=1', { method: 'DELETE' }),
      record,
    ),
  ))

  assertEquals(entry, {
    timestamp: '2026-09-27T10:00:00.000Z',
    durationMs: 1.5,
    outcome: 'rejected',
    rejection: 'forbidden',
    method: 'DELETE',
    path: '/unknown',
  })
})

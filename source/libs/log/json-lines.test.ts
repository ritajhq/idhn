import { assertEquals } from '@std/assert'
import { JsonLines } from './json-lines.ts'

class Entry {
  readonly id = 'd-1'
  constructor(readonly allowed: boolean) {}
}

Deno.test('JsonLines.write: writes one JSON object per line, tagged with its event', () => {
  const lines: string[] = []
  const log = new JsonLines((line) => lines.push(line))

  log.write('judge.decision', new Entry(true))
  log.write('guard.request', { outcome: 'forwarded' })

  assertEquals(lines.map((line) => JSON.parse(line)), [
    { event: 'judge.decision', id: 'd-1', allowed: true },
    { event: 'guard.request', outcome: 'forwarded' },
  ])
})

Deno.test('JsonLines.writeError: writes an error as a single entry, stack trace included', () => {
  const lines: string[] = []
  const log = new JsonLines((line) => lines.push(line))

  class RequestError extends Error {}
  log.writeError('guard.error', new RequestError('boom'))
  log.writeError('guard.error', 'not an error')

  assertEquals(lines.length, 2)
  const [thrown, other] = lines.map((line) => JSON.parse(line))
  assertEquals(thrown.event, 'guard.error')
  assertEquals(thrown.error, 'boom')
  assertEquals(thrown.name, 'RequestError')
  assertEquals(typeof thrown.stack, 'string')
  assertEquals(other, { event: 'guard.error', error: 'not an error' })
})

Deno.test('JsonLines.write: adds the stamp\'s fields to every entry, afresh each time', () => {
  const lines: string[] = []
  let next = 0
  const log = new JsonLines((line) => lines.push(line), () => ({ recordId: `r-${++next}` }))

  log.write('guard.request', { outcome: 'forwarded' })
  log.write('guard.request', { outcome: 'rejected' })

  assertEquals(lines.map((line) => JSON.parse(line).recordId), ['r-1', 'r-2'])
})

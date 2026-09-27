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

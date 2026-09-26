import { assertEquals, assertRejects } from '@std/assert'
import { DataSource } from './data-source.ts'

Deno.test('DataSource.load: reads the JSON document at the configured path', async () => {
  const path = await Deno.makeTempFile({ suffix: '.json' })
  try {
    await Deno.writeTextFile(path, '{"approvers":["alice"]}')

    assertEquals(await new DataSource(path).load(), { approvers: ['alice'] })
  } finally {
    await Deno.remove(path)
  }
})

Deno.test('DataSource.load: yields an empty document when no path is configured', async () => {
  assertEquals(await new DataSource(undefined).load(), {})
})

Deno.test('DataSource.load: rejects a file that is not valid JSON', async () => {
  const path = await Deno.makeTempFile({ suffix: '.json' })
  try {
    await Deno.writeTextFile(path, 'not json')

    await assertRejects(() => new DataSource(path).load(), SyntaxError)
  } finally {
    await Deno.remove(path)
  }
})

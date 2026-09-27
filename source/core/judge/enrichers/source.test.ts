import { assertEquals, assertRejects } from '@std/assert'
import * as Access from '@idhn/access'
import { InvalidDefinitionError, Source } from './source.ts'

/** A deadline that never passes, for calls that aren't about deadlines. */
const noDeadline = new AbortController().signal

const fixturePath = new URL('./tests/fixtures/lookups.yaml', import.meta.url)

Deno.test('Source.load: builds an enricher from a real YAML file that leaves a non-applicable action untouched', async () => {
  const enricher = await new Source(fixturePath).load()
  const context = new Access.Context({ subject: 'alice' })

  // Every lookup is unreachable here, and `risk_score` is optional while
  // `agent_directory` is scoped to another action — so nothing is fetched
  // that would fail, and the context comes through unchanged.
  const enriched = await enricher.enrich(
    new Access.Action('billing.something_else'),
    context,
    noDeadline,
  )

  assertEquals(enriched.facts, { subject: 'alice' })
})

Deno.test('Source.load: rejects a definition without a lookups array', async () => {
  const path = await Deno.makeTempFile({ suffix: '.yaml' })
  try {
    await Deno.writeTextFile(path, 'sources: []\n')

    await assertRejects(
      () => new Source(path).load(),
      InvalidDefinitionError,
      'lookups must be an array',
    )
  } finally {
    await Deno.remove(path)
  }
})

Deno.test('Source.load: rejects a lookup without an http url', async () => {
  const path = await Deno.makeTempFile({ suffix: '.yaml' })
  try {
    await Deno.writeTextFile(path, 'lookups:\n  - as: x\n    http: {}\n')

    await assertRejects(
      () => new Source(path).load(),
      InvalidDefinitionError,
      'lookups[0].http.url',
    )
  } finally {
    await Deno.remove(path)
  }
})

Deno.test('Source.load: rejects a lookup that would write the reserved auth fact', async () => {
  const path = await Deno.makeTempFile({ suffix: '.yaml' })
  try {
    await Deno.writeTextFile(
      path,
      'lookups:\n  - as: auth\n    http: { url: http://x.internal }\n',
    )

    await assertRejects(
      () => new Source(path).load(),
      InvalidDefinitionError,
      'reserved',
    )
  } finally {
    await Deno.remove(path)
  }
})

Deno.test('Source.load: yields an enricher that leaves the context untouched when no path is configured', async () => {
  const enricher = await new Source(undefined).load()
  const context = new Access.Context({ subject: 'alice' })

  assertEquals(
    await enricher.enrich(
      new Access.Action('billing.invoice_approve'),
      context,
      noDeadline,
    ),
    context,
  )
})

Deno.test('Source.load: rejects a lookup whose timeout_ms is not a positive number', async () => {
  const path = await Deno.makeTempFile({ suffix: '.yaml' })
  try {
    await Deno.writeTextFile(
      path,
      'lookups:\n  - as: x\n    http:\n      url: http://x.test/\n    timeout_ms: 0\n',
    )

    await assertRejects(
      () => new Source(path).load(),
      InvalidDefinitionError,
      'lookups[0].timeout_ms must be a positive number',
    )
  } finally {
    await Deno.remove(path)
  }
})

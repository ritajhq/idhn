import { assertEquals, assertRejects } from '@std/assert'
import * as Access from '@idhn/access'
import type { Enricher } from '../enricher.ts'
import { Chain } from './chain.ts'

/** A deadline that never passes, for calls that aren't about deadlines. */
const noDeadline = new AbortController().signal

class Adding implements Enricher {
  constructor(private readonly additional: Record<string, unknown>) {}

  enrich(
    _action: Access.Action,
    context: Access.Context,
  ): Promise<Access.Context> {
    return Promise.resolve(context.with(this.additional))
  }
}

class CountingFacts implements Enricher {
  enrich(
    _action: Access.Action,
    context: Access.Context,
  ): Promise<Access.Context> {
    return Promise.resolve(
      context.with({ factCount: Object.keys(context.facts).length }),
    )
  }
}

Deno.test('Chain.enrich: runs enrichers in order, each seeing the facts added before it', async () => {
  const chain = new Chain([new Adding({ first: 1 }), new CountingFacts()])

  const enriched = await chain.enrich(
    new Access.Action('billing.invoice_approve'),
    new Access.Context({ subject: 'alice' }),
    noDeadline,
  )

  assertEquals(enriched.facts, { subject: 'alice', first: 1, factCount: 2 })
})

Deno.test('Chain.enrich: starts no further enricher once the deadline has passed', async () => {
  const controller = new AbortController()
  let laterRan = false
  const chain = new Chain([
    {
      enrich: (_action, context) => {
        controller.abort()
        return Promise.resolve(context)
      },
    },
    {
      enrich: (_action, context) => {
        laterRan = true
        return Promise.resolve(context)
      },
    },
  ])

  await assertRejects(() =>
    chain.enrich(
      new Access.Action('billing.invoice_approve'),
      new Access.Context(),
      controller.signal,
    )
  )

  assertEquals(laterRan, false)
})

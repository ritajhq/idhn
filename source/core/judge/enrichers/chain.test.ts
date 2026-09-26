import { assertEquals } from '@std/assert'
import * as Access from '@idhn/access'
import type { Enricher } from '../enricher.ts'
import { Chain } from './chain.ts'

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
  )

  assertEquals(enriched.facts, { subject: 'alice', first: 1, factCount: 2 })
})

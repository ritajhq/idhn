import type * as Access from '@idhn/access'
import type { Enricher } from '../enricher.ts'

/** Runs several `Enricher`s in order, each seeing the facts the previous ones added. None starts once the deadline has passed. */
export class Chain implements Enricher {
  constructor(private readonly enrichers: readonly Enricher[]) {}

  async enrich(
    action: Access.Action,
    context: Access.Context,
    deadline: AbortSignal,
  ): Promise<Access.Context> {
    let enriched = context
    for (const enricher of this.enrichers) {
      deadline.throwIfAborted()
      enriched = await enricher.enrich(action, enriched, deadline)
    }
    return enriched
  }
}

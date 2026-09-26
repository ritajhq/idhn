import type * as Access from '@idhn/access'
import type { Enricher } from '../enricher.ts'

/** Runs several `Enricher`s in order, each seeing the facts the previous ones added. */
export class Chain implements Enricher {
  constructor(private readonly enrichers: readonly Enricher[]) {}

  async enrich(
    action: Access.Action,
    context: Access.Context,
  ): Promise<Access.Context> {
    let enriched = context
    for (const enricher of this.enrichers) {
      enriched = await enricher.enrich(action, enriched)
    }
    return enriched
  }
}

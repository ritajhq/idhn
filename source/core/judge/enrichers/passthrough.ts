import type * as Access from '@idhn/access'
import type { Enricher } from '../enricher.ts'

/** An `Enricher` that gathers nothing — for judges whose policies need only what the request carries. */
export class Passthrough implements Enricher {
  // deno-lint-ignore require-await
  async enrich(
    _action: Access.Action,
    context: Access.Context,
    _deadline: AbortSignal,
  ): Promise<Access.Context> {
    return context
  }
}

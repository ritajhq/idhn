import * as Audit from '@idhn/audit'
import * as Contract from '@idhn/contract'
import type * as Horizon from '@ritaj/horizon'

/** Answers the console's audit queries from the store. */
export class Queries {
  constructor(private readonly store: Audit.Stores.Sqlite) {}

  /** Has every audit query resolved by this. */
  serve(resolvers: Horizon.Resolvers): void {
    resolvers
      .Use(Contract.Audit.Overview, { Resolve: (q) => this.overview(q) })
      .Use(Contract.Audit.Trails, { Resolve: (q) => this.trails(q) })
      .Use(Contract.Audit.Trail, { Resolve: (q) => this.trail(q) })
  }

  // deno-lint-ignore require-await
  private async overview(
    query: Contract.Audit.Overview,
  ): Promise<Contract.Audit.OverviewView> {
    return JSON.parse(
      JSON.stringify(this.store.overview(this.windowOf(query), query.Resource)),
    )
  }

  // deno-lint-ignore require-await
  private async trails(
    query: Contract.Audit.Trails,
  ): Promise<Contract.Audit.TrailsPage> {
    let page
    try {
      page = this.store.trails(
        new Audit.Query(
          this.windowOf(query),
          query.Filters,
          query.Limit,
          query.Cursor,
        ),
      )
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
      throw new Contract.Rejected('invalid_query', error.message)
    }
    return JSON.parse(JSON.stringify(page))
  }

  // deno-lint-ignore require-await
  private async trail(
    query: Contract.Audit.Trail,
  ): Promise<Contract.Audit.TrailView | null> {
    const trail = this.store.trail(query.RecordId)
    return trail === undefined ? null : JSON.parse(JSON.stringify(trail))
  }

  private windowOf(
    query: Contract.Audit.Overview | Contract.Audit.Trails,
  ): Audit.Window {
    try {
      return new Audit.Window(query.Since, query.Until)
    } catch (error) {
      throw new Contract.Rejected(
        'invalid_query',
        error instanceof Error ? error.message : String(error),
      )
    }
  }
}

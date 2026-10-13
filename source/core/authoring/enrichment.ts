import { parse as parseYaml, stringify as stringifyYaml } from '@std/yaml'
import { Lookup } from './lookup.ts'

/** The enrichment file's path in a source tree. */
export const ENRICHMENT_PATH = 'enrichment.yaml'

/** A lookup, the policies it provides to, and the actions it is made for. */
export interface Provision {
  readonly lookup: Lookup
  readonly providesTo: readonly string[]
  readonly actions: readonly string[]
}

/** One lookup as `enrichment.yaml` declares it. */
interface Declared {
  as: string
  actions?: string[]
  http: { url: string }
  ttl_seconds?: number
  timeout_ms?: number
  optional?: boolean
  provides_to?: string[]
}

/**
 * The draft's lookups as the judge reads them, `enrichment.yaml`, and back.
 * A judge makes a lookup for the actions it lists, so each is written with
 * the actions its policies govern, worked out when the file is written —
 * always listed, since a lookup listing none would be made for every action.
 * Who it provides to is written too, as `provides_to`, which judges ignore,
 * so a revision restored is authored as it was.
 */
export class Enrichment {
  /** The file for `provisions`; none when there are no lookups. */
  write(provisions: readonly Provision[]): string | undefined {
    if (provisions.length === 0) return undefined
    return stringifyYaml({
      lookups: provisions.map(({ lookup, providesTo, actions }) => ({
        as: lookup.name,
        actions: [...actions],
        http: { url: lookup.url },
        ttl_seconds: lookup.ttlSeconds,
        ...(lookup.timeoutMs === undefined
          ? {}
          : { timeout_ms: lookup.timeoutMs }),
        optional: lookup.optional,
        provides_to: [...providesTo],
      })),
    })
  }

  /**
   * The lookups `text` declares, and who each provides to. A lookup written
   * without `provides_to` (by hand, not by the console) provides to no one
   * until it is told who. Throws `InvalidLookupError`.
   */
  read(text: string): { lookup: Lookup; providesTo: string[] }[] {
    const declared = (parseYaml(text) as { lookups?: Declared[] } | null)
      ?.lookups ?? []
    return declared.map((lookup) => ({
      lookup: Lookup.write({
        name: lookup.as,
        url: lookup.http?.url ?? '',
        ttlSeconds: lookup.ttl_seconds,
        timeoutMs: lookup.timeout_ms,
        optional: lookup.optional,
      }),
      providesTo: lookup.provides_to ?? [],
    }))
  }
}

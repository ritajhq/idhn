import type * as Access from '@idhn/access'
import type { Enricher } from '../enricher.ts'
import { TEMPORARY_STATUSES, UnavailableError } from '../unavailable-error.ts'

/** One declared lookup: where to ask, which fact to store the answer as, and how to behave when the answer can't be had. */
export interface HttpLookupDefinition {
  /** The fact name the response body is stored under. Must not already be a fact of the request. */
  as: string
  /** Action names this lookup applies to; every action when omitted. */
  actions?: readonly string[]
  /** URL to `GET`. `{name}` placeholders are filled from the request's facts; `{auth.subject}` reaches into a nested one. */
  url: string
  /** How long a response may be reused, per resolved URL. `0` disables caching. */
  ttlSeconds: number
  /**
   * When `true` a failed lookup (or a missing placeholder fact) just omits the
   * fact. Otherwise a service that is temporarily out of reach throws
   * `UnavailableError`, and any other failure `LookupError`.
   */
  optional: boolean
}

/** A lookup failed in a way asking again won't fix: a missing fact, a refused or malformed answer. */
export class LookupError extends Error {}

const PLACEHOLDER = /\{([^{}]+)\}/g
const OMITTED = Symbol('omitted')

interface CachedResponse {
  data: unknown
  expiresAt: number
}

/**
 * An `Enricher` that fetches one JSON document over HTTP — e.g. an
 * allow-list membership check exposed by a directory service — and adds it
 * to the context as a single named fact. Responses are cached per resolved
 * URL for `ttlSeconds`; failures are never cached.
 */
export class HttpLookup implements Enricher {
  private readonly cache = new Map<string, CachedResponse>()

  constructor(
    private readonly definition: HttpLookupDefinition,
    private readonly now: () => number = Date.now,
  ) {}

  async enrich(
    action: Access.Action,
    context: Access.Context,
  ): Promise<Access.Context> {
    if (!this.appliesTo(action)) {
      return context
    }

    const data = await this.lookup(context)
    if (data === OMITTED) {
      return context
    }
    return context.with({ [this.definition.as]: data })
  }

  private appliesTo(action: Access.Action): boolean {
    const { actions } = this.definition
    return actions === undefined || actions.includes(action.name)
  }

  private async lookup(context: Access.Context): Promise<unknown> {
    try {
      return await this.fetchCached(this.resolveUrl(context))
    } catch (error) {
      if (this.definition.optional) {
        return OMITTED
      }
      if (error instanceof LookupError || error instanceof UnavailableError) {
        throw error
      }
      throw new LookupError(
        `Lookup "${this.definition.as}" failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      )
    }
  }

  private resolveUrl(context: Access.Context): URL {
    const resolved = this.definition.url.replace(
      PLACEHOLDER,
      (_placeholder, name: string) => {
        const fact = this.factAt(context, name)
        if (!isUrlSafeScalar(fact)) {
          throw new LookupError(
            `Lookup "${this.definition.as}" needs a string, number or boolean fact "${name}" to build its URL`,
          )
        }
        return encodeURIComponent(String(fact))
      },
    )
    return new URL(resolved)
  }

  /** The fact a placeholder names: a top-level fact, or with a dotted path one nested inside it (`{auth.subject}`). */
  private factAt(context: Access.Context, path: string): unknown {
    return path.split('.').reduce<unknown>((current, key) => {
      if (current === null || typeof current !== 'object') {
        return undefined
      }
      return (current as Record<string, unknown>)[key]
    }, context.facts)
  }

  private async fetchCached(url: URL): Promise<unknown> {
    const cached = this.cache.get(url.href)
    if (cached !== undefined && cached.expiresAt > this.now()) {
      return cached.data
    }

    const response = await this.fetchFrom(url)
    if (!response.ok) {
      await response.body?.cancel()
      throw this.failureFor(response, url)
    }

    const data: unknown = await response.json()
    if (this.definition.ttlSeconds > 0) {
      this.cache.set(url.href, {
        data,
        expiresAt: this.now() + this.definition.ttlSeconds * 1000,
      })
    }
    return data
  }

  private async fetchFrom(url: URL): Promise<Response> {
    try {
      return await fetch(url, { headers: { accept: 'application/json' } })
    } catch (error) {
      throw new UnavailableError(
        `Lookup "${this.definition.as}" could not reach ${url.origin}`,
        { cause: error },
      )
    }
  }

  private failureFor(response: Response, url: URL): Error {
    const message =
      `Lookup "${this.definition.as}" got ${response.status} ${response.statusText} from ${url.origin}`
    if (TEMPORARY_STATUSES.has(response.status)) {
      return new UnavailableError(message)
    }
    return new LookupError(message)
  }
}

function isUrlSafeScalar(value: unknown): value is string | number | boolean {
  return ['string', 'number', 'boolean'].includes(typeof value)
}

import * as Access from '@idhn/access'

/** A lookup that isn't one a judge could make. */
export class InvalidLookupError extends Error {}

/** What a policy reads the answer as: `input.<name>`. */
const FACT_NAME = /^[A-Za-z_]\w*$/

/** A `Lookup` as stored. */
export interface LookupDocument {
  readonly name: string
  readonly url: string
  readonly ttlSeconds: number
  readonly timeoutMs?: number
  readonly optional: boolean
}

/**
 * A live fact a judge looks up before evaluating, for what a request alone
 * can't say: the answer of an HTTP GET to `url` (whose `{…}` placeholders
 * the judge fills from the request), handed to the policies it provides to
 * as `input.<name>`. Kept for `ttlSeconds`; waited for `timeoutMs` (the
 * judge's default when unset); when `optional`, a failed lookup is judged
 * without the fact instead of refused.
 */
export class Lookup {
  private constructor(
    readonly name: string,
    readonly url: string,
    readonly ttlSeconds: number,
    readonly timeoutMs: number | undefined,
    readonly optional: boolean,
  ) {}

  /** Throws `InvalidLookupError`. */
  static write(
    { name, url, ttlSeconds = 0, timeoutMs, optional = false }: {
      name: string
      url: string
      ttlSeconds?: number
      timeoutMs?: number
      optional?: boolean
    },
  ): Lookup {
    if (!FACT_NAME.test(name)) {
      throw new InvalidLookupError(
        `A lookup is named for the fact policies read, such as "managed_places" (input.managed_places): "${name}" is not one`,
      )
    }
    if (name === Access.Identity.FACT) {
      throw new InvalidLookupError(
        `"${name}" is the identity authentication reports: name the lookup otherwise`,
      )
    }
    if (url.trim() === '') {
      throw new InvalidLookupError('A lookup needs the URL it asks')
    }
    if (!Number.isFinite(ttlSeconds) || ttlSeconds < 0) {
      throw new InvalidLookupError(
        'How long an answer is kept is a number of seconds, 0 or more',
      )
    }
    if (
      timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    ) {
      throw new InvalidLookupError(
        'How long to wait for an answer is a number of milliseconds above 0',
      )
    }
    return new Lookup(name, url.trim(), ttlSeconds, timeoutMs, optional)
  }

  static fromDocument(document: LookupDocument): Lookup {
    return Lookup.write(document)
  }

  toDocument(): LookupDocument {
    return {
      name: this.name,
      url: this.url,
      ttlSeconds: this.ttlSeconds,
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      optional: this.optional,
    }
  }
}

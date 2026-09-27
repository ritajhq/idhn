/**
 * Statuses a service answers with when it can't serve a request right now
 * but may later: rate limited, or a gateway that couldn't reach it.
 */
export const TEMPORARY_STATUSES: ReadonlySet<number> = new Set([
  429,
  502,
  503,
  504,
])

/**
 * A judgement could not be made right now, because something it depends on
 * — the judge-server, an enrichment lookup's service — is temporarily out of
 * reach. Unlike any other failure it is not a fault to fix: asking again
 * later may succeed. `decisionId` names the failed judgement, once known, so
 * whoever gave up on it can point at the judge's own record of why.
 */
export class UnavailableError extends Error {
  readonly decisionId: string | undefined

  constructor(
    message: string,
    options: { cause?: unknown; decisionId?: string } = {},
  ) {
    super(message, { cause: options.cause })
    this.decisionId = options.decisionId
  }

  /** The same failure, as the judgement identified by `decisionId`. */
  identifiedAs(decisionId: string): UnavailableError {
    return new UnavailableError(this.message, {
      cause: this.cause,
      decisionId,
    })
  }
}

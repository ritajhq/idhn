import type * as Access from '@idhn/access'

/** What an `ActionResolver` resolves a request to: the action being attempted, and its context. */
export interface ResolvedAction {
  action: Access.Action
  context: Access.Context
}

/**
 * Identifies the action being attempted by one incoming request, and the
 * context to judge it against. Implementations are constructed per-request
 * with whatever raw data they need (an HTTP request, session storage, etc.)
 * closed over — `Guard` never sees that raw data itself.
 */
export interface ActionResolver {
  resolve(): Promise<ResolvedAction | null>
}

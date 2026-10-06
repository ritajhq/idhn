import type * as Access from '@idhn/access'
import type * as Disclosure from '@idhn/disclosure'

/** What an `ActionResolver` resolves a request to: the action being attempted, and its context. */
export interface ResolvedAction {
  action: Access.Action
  context: Access.Context
  /**
   * The answer's restricted fields, each shown as the service declared by
   * default — what the caller sees unless a policy says otherwise. None when
   * nothing is restricted.
   */
  restrictions?: Disclosure.Disclosure
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

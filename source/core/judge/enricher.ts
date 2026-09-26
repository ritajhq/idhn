import type * as Access from '@idhn/access'

/**
 * Gathers facts a request alone couldn't provide (e.g. "is this agent in the
 * directory?") and returns the `Context` carrying them, before any policy is
 * evaluated. This is where I/O happens on behalf of policies, so that
 * `Policy.Engine.evaluate` stays a pure function of its inputs.
 */
export interface Enricher {
  enrich(
    action: Access.Action,
    context: Access.Context,
  ): Promise<Access.Context>
}

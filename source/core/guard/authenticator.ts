import type * as Access from '@idhn/access'

/**
 * Finds out who is behind one incoming request. Implementations are
 * constructed per-request, like `ActionResolver`, with whatever raw data they
 * need closed over. Every technology does the same steps behind this port:
 * extract the credential the request presents (protocol-specific), verify it
 * (credential-specific), and resolve the identity it proves. The outcome is
 * only reported, never enforced: a missing credential is an anonymous
 * identity and a bad one an invalid identity, and the policies decide what
 * either may do.
 */
export interface Authenticator {
  authenticate(): Promise<Access.Identity>
}

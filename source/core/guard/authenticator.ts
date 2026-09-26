import type * as Access from '@idhn/access'
import type { Rejection } from './rejection.ts'

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

  /** How to answer a request the judge denied for `identity`: only a scheme a caller could authenticate with may tell it to. */
  rejectionFor(identity: Access.Identity): Rejection
}

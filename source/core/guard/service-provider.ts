import type * as Access from '@idhn/access'
import type * as Disclosure from '@idhn/disclosure'
import type { Rejection } from './rejection.ts'

/**
 * Carries out a `Guard`'s verdict on one request: forwards it to the
 * protected service, or rejects it for the given reason. Implementations are
 * constructed per-request with whatever raw data they need (the request, a
 * response handle, etc.) closed over. Deliberately knows nothing of
 * `Decision` — allow/deny semantics stay inside `Guard`'s own orchestration.
 */
export interface ServiceProvider {
  /**
   * Hands the request to the protected service, telling it who `identity` is,
   * and relays its answer with each field `disclosure` names shown only as it
   * says. Throws `ServiceUnreachableError` when the protected service cannot
   * be reached at all, and `AnswerWithheldError` when its answer can't be
   * restricted; otherwise whatever the service answers, errors included, is
   * its answer.
   */
  forward(
    identity: Access.Identity,
    disclosure: Disclosure.Disclosure,
  ): Promise<void>
  reject(rejection: Rejection): Promise<void>
}

/** The protected service could not be reached to forward a request to it: nothing answered, so there is no answer to relay. */
export class ServiceUnreachableError extends Error {}

/** The protected service answered, but its answer has restricted fields that could not be found in it (not JSON): rather than relayed whole, it is withheld. */
export class AnswerWithheldError extends Error {}

import type * as Access from '@idhn/access'

/**
 * Why a `Guard` answered a request itself instead of forwarding it. For a
 * denial the judge only says allowed or not; the reason comes from what
 * authentication reported, so the guard can tell "you may not" from "we
 * don't know who you are" without the policies saying whether authentication
 * was required.
 */
export enum Rejection {
  /** No action matched, or the judge denied an authenticated caller. */
  Forbidden = 'forbidden',
  /** The judge denied a caller with no valid credential: authenticating may help. */
  Unauthenticated = 'unauthenticated',
  /** The caller's credential, or the judgement itself, could not be had for now: retrying later may help. */
  Unavailable = 'unavailable',
  /** The request was allowed, but the protected service could not be reached to forward it to. */
  Unreachable = 'unreachable',
}

/** The rejection for a denied request, by what authentication reported about its caller, for a scheme a caller can authenticate with. */
export const REJECTION_FOR_IDENTITY: Readonly<
  Record<Access.IdentityStatus, Rejection>
> = {
  authenticated: Rejection.Forbidden,
  anonymous: Rejection.Unauthenticated,
  invalid: Rejection.Unauthenticated,
  unavailable: Rejection.Unavailable,
}

import type { Authenticator } from '../../authenticator.ts'

/**
 * One authentication technology as a service deploys it over HTTP: shared
 * across requests (it may hold a cache), it hands out the per-request
 * `Authenticator` for each incoming `Request`. The manifest names exactly one
 * scheme per service.
 */
export interface Scheme {
  authenticatorFor(request: Request): Authenticator
}

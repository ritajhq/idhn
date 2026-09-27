import { Rejection } from '../rejection.ts'
import {
  type ServiceProvider,
  ServiceUnreachableError,
} from '../service-provider.ts'
import type { RejectResponse } from './reject-responses/reject-response.ts'

/** How each reason for rejecting a request is said in HTTP. */
const REJECTION_STATUS: Readonly<Record<Rejection, number>> = {
  [Rejection.Forbidden]: 403,
  [Rejection.Unauthenticated]: 401,
  [Rejection.Unavailable]: 503,
  [Rejection.Unreachable]: 502,
}

/** How long a caller is told to wait before trying again after a `503`. */
const RETRY_AFTER_SECONDS = 5

/** Headers each reason for rejecting a request calls for: only unavailability says when to try again. */
const REJECTION_HEADERS: Readonly<Record<Rejection, HeadersInit>> = {
  [Rejection.Forbidden]: {},
  [Rejection.Unauthenticated]: {},
  [Rejection.Unavailable]: { 'retry-after': String(RETRY_AFTER_SECONDS) },
  [Rejection.Unreachable]: {},
}

/**
 * Carries out a `Guard`'s verdict over HTTP: `forward()` reverse-proxies the
 * request to `upstream`, `reject()` answers with the injected `RejectResponse`
 * (a bare empty body when a service configured no custom page) under the
 * status for the rejection: `403` forbidden, `401` unauthenticated, `503`
 * with `Retry-After` when the caller's identity or the judgement could not be
 * had for now, `502` when the protected service could not be reached. Neither method returns
 * anything (per `ServiceProvider`'s contract) — instead, this class is
 * constructed with a `resolve` function (from `Promise.withResolvers()`)
 * that it calls with the eventual `Response`. This lets the HTTP handler
 * that owns the promise return it directly, with no need to read a result
 * back off this instance after `Guard.execute()` resolves — the promise
 * itself is the sole channel back, matching what `ServiceProvider`'s
 * `Promise<void>` methods already promise (nothing).
 */
export class HttpServiceProvider implements ServiceProvider {
  constructor(
    private readonly request: Request,
    private readonly upstream: URL,
    private readonly resolve: (response: Response) => void,
    private readonly rejectResponse: RejectResponse,
  ) {}

  async forward(): Promise<void> {
    const target = new URL(this.request.url)
    target.protocol = this.upstream.protocol
    target.host = this.upstream.host

    const response = await fetch(target, {
      method: this.request.method,
      headers: this.request.headers,
      body: this.request.body,
      redirect: 'manual',
    }).catch((error: unknown) => {
      throw new ServiceUnreachableError(
        `Service at ${this.upstream.origin} could not be reached`,
        { cause: error },
      )
    })
    this.resolve(response)
  }

  // deno-lint-ignore require-await
  async reject(rejection: Rejection): Promise<void> {
    this.resolve(
      this.rejectResponse.toResponse(
        REJECTION_STATUS[rejection],
        REJECTION_HEADERS[rejection],
      ),
    )
  }
}

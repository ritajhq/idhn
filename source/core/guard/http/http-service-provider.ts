import type * as Access from '@idhn/access'
import type * as Disclosure from '@idhn/disclosure'
import type { Rejection } from '../rejection.ts'
import {
  AnswerWithheldError,
  type ServiceProvider,
  ServiceUnreachableError,
} from '../service-provider.ts'
import { CallerHeaders } from './caller-headers.ts'
import type { RejectResponse } from './reject-responses/reject-response.ts'
import { RejectionAnswers } from './rejection-answers.ts'

/** Headers describing the body as the service sent it, which no longer hold once its restricted fields are rewritten. */
const REWRITTEN_BODY_HEADERS = ['content-length', 'content-encoding', 'etag']

/**
 * Carries out a `Guard`'s verdict over HTTP: `forward()` reverse-proxies the
 * request to `upstream`, telling it who the caller is (see `CallerHeaders`),
 * `reject()` answers with the injected `RejectResponse` (a bare empty body
 * when a service configured no custom page), as `RejectionAnswers` says
 * each rejection in HTTP. An answer with restricted fields is read whole
 * and relayed as JSON with them rewritten; one that isn't JSON is withheld
 * rather than relayed with them in it. Neither method returns
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

  async forward(
    identity: Access.Identity,
    disclosure: Disclosure.Disclosure,
  ): Promise<void> {
    const target = new URL(this.request.url)
    target.protocol = this.upstream.protocol
    target.host = this.upstream.host

    const response = await fetch(target, {
      method: this.request.method,
      headers: new CallerHeaders().describe(this.request.headers, identity),
      body: this.request.body,
      redirect: 'manual',
    }).catch((error: unknown) => {
      throw new ServiceUnreachableError(
        `Service at ${this.upstream.origin} could not be reached`,
        { cause: error },
      )
    })
    this.resolve(
      disclosure.isEmpty ? response : await this.restrict(response, disclosure),
    )
  }

  /** `answer`, its restricted fields shown only as `disclosure` says. */
  private async restrict(
    answer: Response,
    disclosure: Disclosure.Disclosure,
  ): Promise<Response> {
    const text = await answer.text()
    const headers = new Headers(answer.headers)
    for (const name of REWRITTEN_BODY_HEADERS) headers.delete(name)
    const init = {
      status: answer.status,
      statusText: answer.statusText,
      headers,
    }
    // Nothing in it to restrict, and some statuses (204, 304) may carry no body.
    if (text === '') return new Response(null, init)

    let document: unknown
    try {
      document = JSON.parse(text)
    } catch (error) {
      throw new AnswerWithheldError(
        `The ${answer.status} answer of ${this.upstream.origin} has restricted fields but is not JSON`,
        { cause: error },
      )
    }
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }
    return new Response(JSON.stringify(disclosure.apply(document)), init)
  }

  // deno-lint-ignore require-await
  async reject(rejection: Rejection): Promise<void> {
    this.resolve(new RejectionAnswers(this.rejectResponse).answer(rejection))
  }
}

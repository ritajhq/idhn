import * as Access from '@idhn/access'
import type { Behavior } from '../behavior.ts'
import type { Decision } from '../decision.ts'
import { UnavailableError } from '../unavailable-error.ts'
import type {
  DecideRequestBody,
  DecideResponseBody,
  UnavailableResponseBody,
} from './wire.ts'

/** How long a caller is told to wait before asking again after a `503`. */
const RETRY_AFTER_SECONDS = 5

/**
 * Exposes a `Behavior` as an HTTP request handler over `POST /decide`. A
 * judgement that was temporarily unavailable is answered `503` with
 * `Retry-After`; any other failure is left to propagate, for the process to
 * answer as the fault it is.
 */
export class Server {
  constructor(private readonly judge: Behavior) {}

  async handle(request: Request): Promise<Response> {
    if (
      new URL(request.url).pathname !== '/decide' || request.method !== 'POST'
    ) {
      return new Response(null, { status: 404 })
    }

    let body: DecideRequestBody
    try {
      body = await request.json()
    } catch {
      return new Response('Malformed JSON body', { status: 400 })
    }
    if (
      typeof body.action !== 'string' || typeof body.context !== 'object' ||
      body.context === null
    ) {
      return new Response(
        'Body must be {"action": string, "context": object}',
        { status: 400 },
      )
    }

    try {
      return this.decided(
        await this.judge.decide(
          new Access.Action(body.action),
          new Access.Context(body.context),
        ),
      )
    } catch (error) {
      if (!(error instanceof UnavailableError)) {
        throw error
      }
      return this.unavailable(error)
    }
  }

  private decided(decision: Decision): Response {
    const body: DecideResponseBody = {
      allowed: decision.allowed,
      decisionId: decision.id,
    }
    return Response.json(body)
  }

  private unavailable(error: UnavailableError): Response {
    const body: UnavailableResponseBody = { decisionId: error.decisionId }
    return Response.json(body, {
      status: 503,
      headers: { 'retry-after': String(RETRY_AFTER_SECONDS) },
    })
  }
}

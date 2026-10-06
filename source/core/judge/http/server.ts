import * as Access from '@idhn/access'
import type { Behavior } from '../behavior.ts'
import { Deadline } from '../deadline.ts'
import type { Decision } from '../decision.ts'
import { UnavailableError } from '../unavailable-error.ts'
import {
  DEADLINE_HEADER,
  type DecideRequestBody,
  type DecideResponseBody,
  type UnavailableResponseBody,
} from './wire.ts'

/** How long a caller is told to wait before asking again after a `503`. */
const RETRY_AFTER_SECONDS = 5

/** Taken off the caller's remaining wait, so the answer still has time to travel back before it gives up. */
const RESPONSE_MARGIN_MS = 100

/**
 * Exposes a `Behavior` as an HTTP request handler over `POST /decide`. A
 * judgement that was temporarily unavailable is answered `503` with
 * `Retry-After`; any other failure is left to propagate, for the process to
 * answer as the fault it is.
 *
 * The caller's remaining wait (`x-deadline-ms`) becomes the judgement's
 * deadline, less the time the answer needs to travel back, so the caller
 * always gets it — `503` included — before it gives up. A caller that sends
 * none gets whatever the judge's own limit is.
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
          this.deadlineOf(request),
        ),
      )
    } catch (error) {
      if (!(error instanceof UnavailableError)) {
        throw error
      }
      return this.unavailable(error)
    }
  }

  private deadlineOf(request: Request): Deadline {
    const remainingMs = Number(request.headers.get(DEADLINE_HEADER))
    if (!(remainingMs > 0)) {
      return Deadline.unbounded()
    }
    return Deadline.in(remainingMs - RESPONSE_MARGIN_MS)
  }

  private decided(decision: Decision): Response {
    const body: DecideResponseBody = {
      allowed: decision.allowed,
      decisionId: decision.id,
      ...(decision.disclosure.isEmpty
        ? {}
        : { disclosure: decision.disclosure.toJSON() }),
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

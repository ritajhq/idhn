import type * as Access from '@idhn/access'
import type { Deadline } from '../deadline.ts'
import { Decision } from '../decision.ts'
import type { Behavior } from '../behavior.ts'
import { TEMPORARY_STATUSES, UnavailableError } from '../unavailable-error.ts'
import {
  DEADLINE_HEADER,
  type DecideRequestBody,
  type DecideResponseBody,
  type UnavailableResponseBody,
} from './wire.ts'

/** The judge-server failed in a way asking again won't fix. */
export class RequestError extends Error {}

/**
 * A `Behavior` that delegates to a remote judge-server over HTTP, keeping it
 * out of the process handling public traffic. The deadline travels with the
 * request, so the judge-server answers while this client is still waiting. A
 * judge-server that can't be reached, doesn't answer by the deadline, or
 * answers that it is temporarily unavailable, fails the judgement with
 * `UnavailableError`; any other failure with `RequestError`.
 */
export class Client implements Behavior {
  constructor(private readonly server: URL) {}

  async decide(
    action: Access.Action,
    context: Access.Context,
    deadline: Deadline,
  ): Promise<Decision> {
    const body: DecideRequestBody = {
      action: action.name,
      context: { ...context.facts },
    }

    try {
      return await this.exchange(body, deadline)
    } catch (error) {
      if (!deadline.passed) {
        throw error
      }
      throw new UnavailableError(
        `Judge server at ${this.server.origin} did not answer within ${deadline.ms}ms`,
        { cause: error },
      )
    }
  }

  private async exchange(
    body: DecideRequestBody,
    deadline: Deadline,
  ): Promise<Decision> {
    const response = await this.post(body, deadline)
    if (!response.ok) {
      throw await this.failureFor(response)
    }

    const responseBody: DecideResponseBody = await response.json()
    return new Decision(responseBody.allowed, [], responseBody.decisionId)
  }

  private async post(
    body: DecideRequestBody,
    deadline: Deadline,
  ): Promise<Response> {
    try {
      return await fetch(new URL('/decide', this.server), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [DEADLINE_HEADER]: String(Math.floor(deadline.remainingMs())),
        },
        body: JSON.stringify(body),
        signal: deadline.signal,
      })
    } catch (error) {
      throw new UnavailableError(
        `Judge server at ${this.server.origin} could not be reached`,
        { cause: error },
      )
    }
  }

  private async failureFor(response: Response): Promise<Error> {
    const message =
      `Judge server responded with ${response.status} ${response.statusText}`
    if (!TEMPORARY_STATUSES.has(response.status)) {
      await response.body?.cancel()
      return new RequestError(message)
    }
    return new UnavailableError(message, {
      decisionId: await this.decisionIdOf(response),
    })
  }

  /** The id of the judgement a `503` from the judge-server names, if its body carries one; a gateway's won't. */
  private async decisionIdOf(response: Response): Promise<string | undefined> {
    try {
      const body: UnavailableResponseBody = await response.json()
      return typeof body.decisionId === 'string' ? body.decisionId : undefined
    } catch {
      return undefined
    }
  }
}

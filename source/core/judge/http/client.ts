import type * as Access from '@idhn/access'
import { Decision } from '../decision.ts'
import type { Behavior } from '../behavior.ts'
import { TEMPORARY_STATUSES, UnavailableError } from '../unavailable-error.ts'
import type {
  DecideRequestBody,
  DecideResponseBody,
  UnavailableResponseBody,
} from './wire.ts'

/** The judge-server failed in a way asking again won't fix. */
export class RequestError extends Error {}

/**
 * A `Behavior` that delegates to a remote judge-server over HTTP, keeping it
 * out of the process handling public traffic. A judge-server that can't be
 * reached, or answers that it is temporarily unavailable, fails the
 * judgement with `UnavailableError`; any other failure with `RequestError`.
 */
export class Client implements Behavior {
  constructor(private readonly server: URL) {}

  async decide(
    action: Access.Action,
    context: Access.Context,
  ): Promise<Decision> {
    const body: DecideRequestBody = {
      action: action.name,
      context: { ...context.facts },
    }

    const response = await this.post(body)
    if (!response.ok) {
      throw await this.failureFor(response)
    }

    const responseBody: DecideResponseBody = await response.json()
    return new Decision(responseBody.allowed, [], responseBody.decisionId)
  }

  private async post(body: DecideRequestBody): Promise<Response> {
    try {
      return await fetch(new URL('/decide', this.server), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
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

import type * as Access from '@idhn/access'
import { Decision } from '../decision.ts'
import type { Behavior } from '../behavior.ts'
import type { DecideRequestBody, DecideResponseBody } from './wire.ts'

export class RequestError extends Error {}

/** A `Behavior` that delegates to a remote judge-server over HTTP, keeping it out of the process handling public traffic. */
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

    const response = await fetch(new URL('/decide', this.server), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      throw new RequestError(
        `Judge server responded with ${response.status} ${response.statusText}`,
      )
    }

    const responseBody: DecideResponseBody = await response.json()
    return new Decision(responseBody.allowed)
  }
}

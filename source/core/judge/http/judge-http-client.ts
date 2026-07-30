import type { Action } from '../action.ts'
import type { Context } from '../context.ts'
import { Decision } from '../decision.ts'
import type { Judge } from '../judge.ts'
import type { DecideRequestBody, DecideResponseBody } from './wire.ts'

export class JudgeRequestError extends Error {}

/** A `Judge` that delegates to a remote judge-server over HTTP, keeping it out of the process handling public traffic. */
export class JudgeHttpClient implements Judge {
  constructor(private readonly server: URL) {}

  async decide(action: Action, context: Context): Promise<Decision> {
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
      throw new JudgeRequestError(
        `Judge server responded with ${response.status} ${response.statusText}`,
      )
    }

    const responseBody: DecideResponseBody = await response.json()
    return new Decision(responseBody.allowed)
  }
}

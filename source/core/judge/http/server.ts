import * as Access from '@idhn/access'
import type { Behavior } from '../behavior.ts'
import type { DecideRequestBody, DecideResponseBody } from './wire.ts'

/** Exposes a `Behavior` as an HTTP request handler over `POST /decide`. */
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

    const decision = await this.judge.decide(
      new Access.Action(body.action),
      new Access.Context(body.context),
    )

    const responseBody: DecideResponseBody = {
      allowed: decision.allowed,
      decisionId: decision.id,
    }
    return Response.json(responseBody)
  }
}

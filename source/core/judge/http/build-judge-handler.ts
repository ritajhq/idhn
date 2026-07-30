import { Action } from '../action.ts'
import { Context } from '../context.ts'
import type { Judge } from '../judge.ts'
import type { DecideRequestBody, DecideResponseBody } from './wire.ts'

/** Wraps a `Judge` as an HTTP request handler exposing it over `POST /decide`. */
export function buildJudgeHandler(
  judge: Judge,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
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

    const decision = await judge.decide(
      new Action(body.action),
      new Context(body.context),
    )

    const responseBody: DecideResponseBody = { allowed: decision.allowed }
    return Response.json(responseBody)
  }
}

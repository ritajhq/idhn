import { Delegate, type Emitter } from '@duesabati/evento'
import * as Access from '@idhn/access'
import * as Judge from '@idhn/judge'
import type { ActionResolver } from './action-resolver.ts'
import type { Authenticator } from './authenticator.ts'
import { Rejection } from './rejection.ts'
import type { RequestRecord } from './request-record.ts'
import { RequestRecording } from './request-recording.ts'
import {
  type ServiceProvider,
  ServiceUnreachableError,
} from './service-provider.ts'

/**
 * Orchestrates one request: resolves what action is being attempted, finds
 * out who is attempting it, asks a `Judge` whether it's allowed, and forwards
 * or rejects accordingly. The identity reaches the judge as the reserved
 * `auth` fact of the context, and decides how a denial is answered: a
 * caller without a valid identity is told to authenticate rather than that
 * it is forbidden. Holds no infrastructure of its own — every
 * collaborator is injected as an interface, and none of them are generic
 * over the request's raw shape.
 *
 * A judge that is temporarily unavailable is a rejection, not a failure: the
 * request is denied (fail closed) as unavailable, so its caller knows to try
 * again. So is a protected service that can't be reached to forward an
 * allowed request to: it is answered as unreachable. Any other failure
 * propagates.
 *
 * The guard waits at most `judgeTimeoutMs` for a judgement. That wait is the
 * deadline the judge is handed, and every hop behind it answers within it, so
 * the judge's answer — an unavailable one included — always arrives in time.
 *
 * How the request was handled, including a failure, is announced on
 * `OnHandled` before `execute` settles.
 */
/** How long a guard waits for a judgement when not told otherwise. */
const DEFAULT_JUDGE_TIMEOUT_MS = 5000

export class Guard {
  private readonly handled = new Delegate<[RequestRecord]>()

  constructor(
    private readonly judge: Judge.Behavior,
    private readonly actionResolver: ActionResolver,
    private readonly authenticator: Authenticator,
    private readonly serviceProvider: ServiceProvider,
    private readonly judgeTimeoutMs: number = DEFAULT_JUDGE_TIMEOUT_MS,
  ) {}

  get OnHandled(): Emitter<[RequestRecord]> {
    return this.handled
  }

  async execute(): Promise<void> {
    const recording = new RequestRecording()
    try {
      await this.guard(recording)
    } catch (error) {
      if (!(error instanceof Judge.UnavailableError)) {
        recording.failed(error)
        throw error
      }
      recording.unavailable(error)
      await this.reject(Rejection.Unavailable, recording)
    } finally {
      this.handled.Invoke(recording.toRecord())
    }
  }

  private async guard(recording: RequestRecording): Promise<void> {
    const resolved = await this.actionResolver.resolve()
    if (resolved === null) {
      return await this.reject(Rejection.Forbidden, recording)
    }
    recording.resolved(resolved.action)

    const identity = await this.authenticator.authenticate()
    recording.authenticated(identity)
    const context = resolved.context.with({
      [Access.Identity.FACT]: identity.toFact(),
    })
    const decision = await this.judge.decide(
      resolved.action,
      context,
      Judge.Deadline.in(this.judgeTimeoutMs),
    )
    recording.judged(decision)

    if (decision.allowed) {
      return await this.forward(identity, recording)
    }

    return await this.reject(
      this.authenticator.rejectionFor(identity),
      recording,
    )
  }

  private async forward(
    identity: Access.Identity,
    recording: RequestRecording,
  ): Promise<void> {
    try {
      await this.serviceProvider.forward(identity)
      recording.forwarded()
    } catch (error) {
      if (!(error instanceof ServiceUnreachableError)) {
        throw error
      }
      recording.unreachable(error)
      await this.reject(Rejection.Unreachable, recording)
    }
  }

  private async reject(
    rejection: Rejection,
    recording: RequestRecording,
  ): Promise<void> {
    await this.serviceProvider.reject(rejection)
    recording.rejected(rejection)
  }
}

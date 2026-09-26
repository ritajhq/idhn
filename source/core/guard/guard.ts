import * as Access from '@idhn/access'
import type * as Judge from '@idhn/judge'
import type { ActionResolver } from './action-resolver.ts'
import type { Authenticator } from './authenticator.ts'
import type { ServiceProvider } from './service-provider.ts'

/**
 * Orchestrates one request: resolves what action is being attempted, finds
 * out who is attempting it, asks a `Judge` whether it's allowed, and forwards
 * or rejects accordingly. The identity reaches the judge as the reserved
 * `auth` fact of the context. Holds no infrastructure of its own — every
 * collaborator is injected as an interface, and none of them are generic
 * over the request's raw shape.
 */
export class Guard {
  constructor(
    private readonly judge: Judge.Behavior,
    private readonly actionResolver: ActionResolver,
    private readonly authenticator: Authenticator,
    private readonly serviceProvider: ServiceProvider,
  ) {}

  async execute(): Promise<void> {
    const resolved = await this.actionResolver.resolve()
    if (resolved === null) {
      await this.serviceProvider.reject()
      return
    }

    const identity = await this.authenticator.authenticate()
    const context = resolved.context.with({
      [Access.Identity.FACT]: identity.toFact(),
    })
    const decision = await this.judge.decide(resolved.action, context)

    if (decision.allowed) {
      return await this.serviceProvider.forward()
    }

    return await this.serviceProvider.reject()
  }
}

import type { Judge } from '@mithaq/judge'
import type { ActionResolver } from './action-resolver.ts'
import type { ServiceProvider } from './service-provider.ts'

/**
 * Orchestrates one request: resolves what action is being attempted, asks a
 * `Judge` whether it's allowed, and forwards or rejects accordingly. Holds no
 * infrastructure of its own — every collaborator is injected as an
 * interface, and none of them are generic over the request's raw shape.
 */
export class Guard {
  constructor(
    private readonly judge: Judge,
    private readonly actionResolver: ActionResolver,
    private readonly serviceProvider: ServiceProvider,
  ) {}

  async execute(): Promise<void> {
    const resolved = await this.actionResolver.resolve()
    if (resolved === null) {
      await this.serviceProvider.reject()
      return
    }

    const decision = await this.judge.decide(resolved.action, resolved.context)

    if (decision.allowed) {
      return await this.serviceProvider.forward()
    }

    return await this.serviceProvider.reject()
  }
}

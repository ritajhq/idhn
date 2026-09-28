import { Delegate, type Emitter } from '@duesabati/evento'
import type * as Distribution from '@idhn/distribution'

/**
 * Pulls policy sets from a policy builder: once on `start()`, then every
 * `pollMs`, announcing each newer set on `OnPolicySet`. A builder that can't
 * be reached, or has nothing yet, is simply asked again at the next poll —
 * the judge keeps whatever it already has. Pulling going wrong is announced
 * on `OnFailed` once, not at every poll, until it goes wrong differently;
 * pulling working again is announced on `OnRecovered`.
 */
export class PolicyPuller {
  private readonly policySet = new Delegate<[Distribution.PolicySet]>()
  private readonly failed = new Delegate<[unknown]>()
  private readonly recovered = new Delegate<[]>()
  private failing: string | undefined

  constructor(
    private readonly client: Distribution.Http.Client,
    private readonly pollMs: number,
  ) {}

  get OnPolicySet(): Emitter<[Distribution.PolicySet]> {
    return this.policySet
  }

  get OnFailed(): Emitter<[unknown]> {
    return this.failed
  }

  get OnRecovered(): Emitter<[]> {
    return this.recovered
  }

  async start(): Promise<void> {
    await this.pull()
    setInterval(() => this.pull(), this.pollMs)
  }

  private async pull(): Promise<void> {
    try {
      const fetched = await this.client.fetch()
      if (this.failing !== undefined) {
        this.failing = undefined
        this.recovered.Invoke()
      }
      if (fetched !== null) this.policySet.Invoke(fetched.set)
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error)
      if (failure === this.failing) return
      this.failing = failure
      this.failed.Invoke(error)
    }
  }
}

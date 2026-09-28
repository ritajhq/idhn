import type * as Distribution from '@idhn/distribution'
import * as Judge from '@idhn/judge'
import * as OPA from '@idhn/opa'
import * as Policy from '@idhn/policy'

/**
 * Builds a judge from a policy set: an OPA engine for its bundle (with its
 * `data`), a registry of its associations, its enrichment lookups (none when
 * it has none), combined by deny-overrides, which denies by default. Throws
 * if any part of the set is malformed.
 */
export class JudgeAssembly {
  constructor(private readonly maxDecisionMs: number) {}

  async assemble(set: Distribution.PolicySet): Promise<Judge.Local> {
    const data = set.data === undefined ? {} : JSON.parse(set.data)
    const engine = await OPA.PolicyEngine.load(set.bundle, data)
    const registry = new Policy.Registries.InMemory(
      new Policy.Registries.Associations().parse(set.registry),
    )
    const enricher = set.enrichment === undefined
      ? new Judge.Enrichers.Passthrough()
      : new Judge.Enrichers.Definitions().parse(set.enrichment)

    return new Judge.Local(
      registry,
      engine,
      new Judge.DenyOverridesStrategy(new Judge.Decision(false)),
      enricher,
      this.maxDecisionMs,
    )
  }
}

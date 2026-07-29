import { assertEquals } from '@std/assert'
import { Action } from './action.ts'
import { Context } from './context.ts'
import { Decision } from './decision.ts'
import type { DecisionStrategy } from './decision-strategy.ts'
import { DenyOverridesStrategy } from './deny-overrides-strategy.ts'
import { Judge } from './judge.ts'
import type { PolicyEngine } from './policy-engine.ts'
import { Policy } from './policy.ts'
import { PolicyResult } from './policy-result.ts'
import type { PolicyRepository } from './policy-repository.ts'
import { Verdict } from './verdict.ts'

class FakePolicyRepository implements PolicyRepository {
  constructor(private readonly policies: Policy[]) {}

  findPoliciesFor(_action: Action): Promise<Policy[]> {
    return Promise.resolve(this.policies)
  }
}

class FakePolicyEngine implements PolicyEngine {
  constructor(private readonly verdicts: Map<string, Verdict>) {}

  evaluate(policy: Policy, _context: Context): Promise<PolicyResult> {
    const verdict = this.verdicts.get(policy.id) ?? Verdict.Neutral
    return Promise.resolve(new PolicyResult(policy, verdict))
  }
}

class StubDecisionStrategy implements DecisionStrategy {
  constructor(private readonly decision: Decision) {}

  combine(_results: readonly PolicyResult[]): Decision {
    return this.decision
  }
}

const action = new Action('invoice.approve')
const context = new Context({ subject: 'alice' })

Deno.test("Judge.decide: resolves policies, evaluates each, and returns the strategy's combined decision", async () => {
  const policyA = new Policy('policy.a')
  const policyB = new Policy('policy.b')
  const repository = new FakePolicyRepository([policyA, policyB])
  const engine = new FakePolicyEngine(
    new Map([
      [policyA.id, Verdict.Allow],
      [policyB.id, Verdict.Neutral],
    ]),
  )
  const strategy = new DenyOverridesStrategy(new Decision(false))

  const judge = new Judge(repository, engine, strategy)
  const decision = await judge.decide(action, context)

  assertEquals(decision.allowed, true)
  assertEquals(decision.results.length, 2)
  assertEquals(decision.results[0].verdict, Verdict.Allow)
  assertEquals(decision.results[1].verdict, Verdict.Neutral)
})

Deno.test('Judge.decide: passes an empty result set to the strategy when no policies govern the action', async () => {
  const repository = new FakePolicyRepository([])
  const engine = new FakePolicyEngine(new Map())
  const fallback = new Decision(false)
  const strategy = new StubDecisionStrategy(fallback)

  const judge = new Judge(repository, engine, strategy)
  const decision = await judge.decide(action, context)

  assertEquals(decision, fallback)
})

Deno.test('Judge.decide: delegates entirely to the injected strategy, never deciding allow/deny itself', async () => {
  const policy = new Policy('policy.always-allow')
  const repository = new FakePolicyRepository([policy])
  const engine = new FakePolicyEngine(new Map([[policy.id, Verdict.Allow]]))
  const forcedDeny = new Decision(false)
  const strategy = new StubDecisionStrategy(forcedDeny)

  const judge = new Judge(repository, engine, strategy)
  const decision = await judge.decide(action, context)

  assertEquals(decision, forcedDeny)
})

import { assertEquals } from '@std/assert'
import * as Access from '@idhn/access'
import * as Policy from '@idhn/policy'
import { Decision } from './decision.ts'
import type { DecisionStrategy } from './decision-strategy.ts'
import { DenyOverridesStrategy } from './deny-overrides-strategy.ts'
import type { Enricher } from './enricher.ts'
import { Passthrough } from './enrichers/index.ts'
import { Local } from './local.ts'

class FakePolicyRepository implements Policy.Repository {
  constructor(private readonly policies: Policy.Identifier[]) {}

  findPoliciesFor(_action: Access.Action): Promise<Policy.Identifier[]> {
    return Promise.resolve(this.policies)
  }
}

class FakePolicyEngine implements Policy.Engine {
  constructor(private readonly verdicts: Map<string, Policy.Verdict>) {}

  evaluate(
    policy: Policy.Identifier,
    _context: Access.Context,
  ): Promise<Policy.Result> {
    const verdict = this.verdicts.get(policy.toString()) ??
      Policy.Verdict.Neutral
    return Promise.resolve(new Policy.Result(policy, verdict))
  }
}

class StubDecisionStrategy implements DecisionStrategy {
  constructor(private readonly decision: Decision) {}

  combine(_results: readonly Policy.Result[]): Decision {
    return this.decision
  }
}

const action = new Access.Action('invoice.approve')
const context = new Access.Context({ subject: 'alice' })

Deno.test("Local.decide: resolves policies, evaluates each, and returns the strategy's combined decision", async () => {
  const policyA = new Policy.Identifier('policy.a')
  const policyB = new Policy.Identifier('policy.b')
  const repository = new FakePolicyRepository([policyA, policyB])
  const engine = new FakePolicyEngine(
    new Map([
      [policyA.toString(), Policy.Verdict.Allow],
      [policyB.toString(), Policy.Verdict.Neutral],
    ]),
  )
  const strategy = new DenyOverridesStrategy(new Decision(false))

  const local = new Local(repository, engine, strategy, new Passthrough())
  const decision = await local.decide(action, context)

  assertEquals(decision.allowed, true)
  assertEquals(decision.results.length, 2)
  assertEquals(decision.results[0].verdict, Policy.Verdict.Allow)
  assertEquals(decision.results[1].verdict, Policy.Verdict.Neutral)
})

Deno.test('Local.decide: passes an empty result set to the strategy when no policies govern the action', async () => {
  const repository = new FakePolicyRepository([])
  const engine = new FakePolicyEngine(new Map())
  const fallback = new Decision(false)
  const strategy = new StubDecisionStrategy(fallback)

  const local = new Local(repository, engine, strategy, new Passthrough())
  const decision = await local.decide(action, context)

  assertEquals(decision, fallback)
})

Deno.test('Local.decide: delegates entirely to the injected strategy, never deciding allow/deny itself', async () => {
  const policy = new Policy.Identifier('policy.always-allow')
  const repository = new FakePolicyRepository([policy])
  const engine = new FakePolicyEngine(
    new Map([[policy.toString(), Policy.Verdict.Allow]]),
  )
  const forcedDeny = new Decision(false)
  const strategy = new StubDecisionStrategy(forcedDeny)

  const local = new Local(repository, engine, strategy, new Passthrough())
  const decision = await local.decide(action, context)

  assertEquals(decision, forcedDeny)
})

class RecordingEnricher implements Enricher {
  calls = 0

  constructor(private readonly additional: Record<string, unknown>) {}

  enrich(
    _action: Access.Action,
    context: Access.Context,
  ): Promise<Access.Context> {
    this.calls++
    return Promise.resolve(context.with(this.additional))
  }
}

class ContextCapturingPolicyEngine implements Policy.Engine {
  received: Access.Context[] = []

  evaluate(
    policy: Policy.Identifier,
    context: Access.Context,
  ): Promise<Policy.Result> {
    this.received.push(context)
    return Promise.resolve(new Policy.Result(policy, Policy.Verdict.Allow))
  }
}

Deno.test('Local.decide: evaluates every governing policy against the enriched context', async () => {
  const repository = new FakePolicyRepository([
    new Policy.Identifier('policy.a'),
    new Policy.Identifier('policy.b'),
  ])
  const engine = new ContextCapturingPolicyEngine()
  const enricher = new RecordingEnricher({ directory: { active: true } })
  const local = new Local(
    repository,
    engine,
    new DenyOverridesStrategy(new Decision(false)),
    enricher,
  )

  await local.decide(action, context)

  assertEquals(enricher.calls, 1)
  assertEquals(engine.received.length, 2)
  for (const received of engine.received) {
    assertEquals(received.facts, {
      subject: 'alice',
      directory: { active: true },
    })
  }
})

Deno.test('Local.decide: does not enrich when no policy governs the action', async () => {
  const enricher = new RecordingEnricher({ directory: { active: true } })
  const local = new Local(
    new FakePolicyRepository([]),
    new ContextCapturingPolicyEngine(),
    new StubDecisionStrategy(new Decision(false)),
    enricher,
  )

  await local.decide(action, context)

  assertEquals(enricher.calls, 0)
})

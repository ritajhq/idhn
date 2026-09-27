import { assertEquals, assertNotEquals, assertRejects } from '@std/assert'
import * as Access from '@idhn/access'
import * as Policy from '@idhn/policy'
import { Decision } from './decision.ts'
import { Deadline } from './deadline.ts'
import type { DecisionRecord } from './decision-record.ts'
import type { DecisionStrategy } from './decision-strategy.ts'
import { DenyOverridesStrategy } from './deny-overrides-strategy.ts'
import type { Enricher } from './enricher.ts'
import { Passthrough } from './enrichers/index.ts'
import { Local } from './local.ts'
import { UnavailableError } from './unavailable-error.ts'

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
  const decision = await local.decide(action, context, Deadline.unbounded())

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
  const decision = await local.decide(action, context, Deadline.unbounded())

  assertEquals(decision.allowed, fallback.allowed)
  assertEquals(decision.results, fallback.results)
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
  const decision = await local.decide(action, context, Deadline.unbounded())

  assertEquals(decision.allowed, forcedDeny.allowed)
  assertEquals(decision.results, forcedDeny.results)
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

  await local.decide(action, context, Deadline.unbounded())

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

  await local.decide(action, context, Deadline.unbounded())

  assertEquals(enricher.calls, 0)
})

class FailingEnricher implements Enricher {
  enrich(): Promise<Access.Context> {
    return Promise.reject(new Error('directory unreachable'))
  }
}

function recordsOf(local: Local): DecisionRecord[] {
  const records: DecisionRecord[] = []
  local.OnDecision.Do((record) => records.push(record))
  return records
}

Deno.test('Local.decide: identifies each decision, and records it under the same id with the verdicts and the context the policies saw', async () => {
  const policy = new Policy.Identifier('policy.a')
  const local = new Local(
    new FakePolicyRepository([policy]),
    new FakePolicyEngine(new Map([[policy.toString(), Policy.Verdict.Allow]])),
    new DenyOverridesStrategy(new Decision(false)),
    new RecordingEnricher({ directory: { active: true } }),
  )
  const records = recordsOf(local)

  const decision = await local.decide(action, context, Deadline.unbounded())

  assertEquals(records.length, 1)
  const [record] = records
  assertEquals(record.decisionId, decision.id)
  assertEquals(record.action, 'invoice.approve')
  assertEquals(record.outcome, 'allowed')
  assertEquals(record.results, [
    { policy: 'policy.a', verdict: Policy.Verdict.Allow },
  ])
  assertEquals(record.context, {
    subject: 'alice',
    directory: { active: true },
  })
  assertEquals(record.error, undefined)
})

Deno.test('Local.decide: gives every decision its own id, even when the strategy returns the same fallback', async () => {
  const local = new Local(
    new FakePolicyRepository([]),
    new FakePolicyEngine(new Map()),
    new DenyOverridesStrategy(new Decision(false)),
    new Passthrough(),
  )
  const records = recordsOf(local)

  const first = await local.decide(action, context, Deadline.unbounded())
  const second = await local.decide(action, context, Deadline.unbounded())

  assertNotEquals(first.id, second.id)
  assertEquals(records.map((record) => record.outcome), ['denied', 'denied'])
  assertEquals(records[0].context, { subject: 'alice' })
})

Deno.test('Local.decide: records a judgement that fails, then fails the same way', async () => {
  const local = new Local(
    new FakePolicyRepository([new Policy.Identifier('policy.a')]),
    new FakePolicyEngine(new Map()),
    new DenyOverridesStrategy(new Decision(false)),
    new FailingEnricher(),
  )
  const records = recordsOf(local)

  await assertRejects(
    () => local.decide(action, context, Deadline.unbounded()),
    Error,
    'directory unreachable',
  )

  assertEquals(records.length, 1)
  assertEquals(records[0].outcome, 'failed')
  assertEquals(records[0].error, 'directory unreachable')
  assertEquals(records[0].results, [])
})

Deno.test('Local.decide: records serialize to a flat, self-describing log entry', async () => {
  const local = new Local(
    new FakePolicyRepository([]),
    new FakePolicyEngine(new Map()),
    new DenyOverridesStrategy(new Decision(false)),
    new Passthrough(),
  )
  const records = recordsOf(local)

  await local.decide(action, context, Deadline.unbounded())

  const entry = JSON.parse(JSON.stringify(records[0]))
  assertEquals(Object.keys(entry).sort(), [
    'action',
    'context',
    'decisionId',
    'durationMs',
    'outcome',
    'results',
    'timestamp',
  ])
})

class UnavailableEnricher implements Enricher {
  enrich(): Promise<Access.Context> {
    return Promise.reject(new UnavailableError('directory is down'))
  }
}

Deno.test('Local.decide: records a temporarily unavailable judgement as such, and names it in the error it throws', async () => {
  const local = new Local(
    new FakePolicyRepository([new Policy.Identifier('policy.a')]),
    new FakePolicyEngine(new Map()),
    new DenyOverridesStrategy(new Decision(false)),
    new UnavailableEnricher(),
  )
  const records = recordsOf(local)

  const error = await assertRejects(
    () => local.decide(action, context, Deadline.unbounded()),
    UnavailableError,
    'directory is down',
  )

  assertEquals(records[0].outcome, 'unavailable')
  assertEquals(error.decisionId, records[0].decisionId)
})

/** Waits for the deadline, then gives up the way a cooperating enricher does. */
class DeadlineAwareEnricher implements Enricher {
  sawDeadline = false

  enrich(
    _action: Access.Action,
    _context: Access.Context,
    deadline: AbortSignal,
  ): Promise<Access.Context> {
    return new Promise((_resolve, reject) => {
      deadline.addEventListener('abort', () => {
        this.sawDeadline = true
        reject(deadline.reason)
      })
    })
  }
}

/** Never answers and ignores the deadline, like a hung dependency. */
class HungEnricher implements Enricher {
  enrich(): Promise<Access.Context> {
    return new Promise(() => {})
  }
}

function localWith(enricher: Enricher, deadlineMs: number): Local {
  return new Local(
    new FakePolicyRepository([new Policy.Identifier('policy.a')]),
    new FakePolicyEngine(new Map()),
    new DenyOverridesStrategy(new Decision(false)),
    enricher,
    deadlineMs,
  )
}

Deno.test('Local.decide: fails as unavailable once the deadline passes, telling the enrichers to give up', async () => {
  const enricher = new DeadlineAwareEnricher()
  const local = localWith(enricher, 50)
  const records = recordsOf(local)

  const error = await assertRejects(
    () => local.decide(action, context, Deadline.unbounded()),
    UnavailableError,
    'not reached within 50ms',
  )

  assertEquals(enricher.sawDeadline, true)
  assertEquals(records[0].outcome, 'unavailable')
  assertEquals(error.decisionId, records[0].decisionId)
})

Deno.test('Local.decide: answers by the deadline even when an enricher ignores it', async () => {
  const local = localWith(new HungEnricher(), 50)
  const started = performance.now()

  await assertRejects(
    () => local.decide(action, context, Deadline.unbounded()),
    UnavailableError,
    'not reached within 50ms',
  )

  const elapsed = performance.now() - started
  assertEquals(elapsed < 500, true, `took ${elapsed}ms`)
})

Deno.test("Local.decide: fails as unavailable by the asker's deadline, even with no limit of its own", async () => {
  const local = new Local(
    new FakePolicyRepository([new Policy.Identifier('policy.a')]),
    new FakePolicyEngine(new Map()),
    new DenyOverridesStrategy(new Decision(false)),
    new HungEnricher(),
  )

  await assertRejects(
    () => local.decide(action, context, Deadline.in(50)),
    UnavailableError,
    'not reached within 50ms',
  )
})

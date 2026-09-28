import { assertEquals, assertRejects } from '@std/assert'
import * as Access from '@idhn/access'
import * as Policy from '@idhn/policy'
import { Decision } from './decision.ts'
import { Deadline } from './deadline.ts'
import type { DecisionRecord } from './decision-record.ts'
import { DenyOverridesStrategy } from './deny-overrides-strategy.ts'
import { Passthrough } from './enrichers/index.ts'
import { Local } from './local.ts'
import { Reloadable } from './reloadable.ts'
import { UnavailableError } from './unavailable-error.ts'

class OnePolicyRepository implements Policy.Repository {
  findPoliciesFor(_action: Access.Action): Promise<Policy.Identifier[]> {
    return Promise.resolve([new Policy.Identifier('policy.a')])
  }
}

/** An engine that gives every policy the same verdict. */
class FixedVerdictEngine implements Policy.Engine {
  constructor(private readonly verdict: Policy.Verdict) {}

  evaluate(
    policy: Policy.Identifier,
    _context: Access.Context,
  ): Promise<Policy.Result> {
    return Promise.resolve(new Policy.Result(policy, this.verdict))
  }
}

/** A `Local` judge whose every policy answers `verdict`. */
function judgeAnswering(verdict: Policy.Verdict): Local {
  return new Local(
    new OnePolicyRepository(),
    new FixedVerdictEngine(verdict),
    new DenyOverridesStrategy(new Decision(false)),
    new Passthrough(),
  )
}

const action = new Access.Action('invoice.approve')
const context = new Access.Context({})

Deno.test('Reloadable.decide: fails as unavailable until a judge is loaded', async () => {
  const reloadable = new Reloadable()

  await assertRejects(
    () => reloadable.decide(action, context, Deadline.unbounded()),
    UnavailableError,
  )
})

Deno.test('Reloadable.decide: judges with the judge it was given', async () => {
  const reloadable = new Reloadable()
  reloadable.replace(judgeAnswering(Policy.Verdict.Allow))

  const decision = await reloadable.decide(action, context, Deadline.unbounded())

  assertEquals(decision.allowed, true)
})

Deno.test('Reloadable.decide: judges with the new judge once replaced', async () => {
  const reloadable = new Reloadable()
  reloadable.replace(judgeAnswering(Policy.Verdict.Allow))

  reloadable.replace(judgeAnswering(Policy.Verdict.Deny))
  const decision = await reloadable.decide(action, context, Deadline.unbounded())

  assertEquals(decision.allowed, false)
})

Deno.test('Reloadable.OnDecision: announces the decisions of every judge it has held', async () => {
  const reloadable = new Reloadable()
  const recorded: DecisionRecord[] = []
  reloadable.OnDecision.Do((record) => recorded.push(record))

  reloadable.replace(judgeAnswering(Policy.Verdict.Allow))
  await reloadable.decide(action, context, Deadline.unbounded())
  reloadable.replace(judgeAnswering(Policy.Verdict.Deny))
  await reloadable.decide(action, context, Deadline.unbounded())

  assertEquals(recorded.map((record) => record.outcome), ['allowed', 'denied'])
})

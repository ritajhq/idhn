import { assertEquals } from '@std/assert'
import {
  Action,
  Context,
  Decision,
  DenyOverridesStrategy,
  InMemoryPolicyRegistry,
  type Judge,
  LocalJudge,
  Policy,
  Verdict,
} from '@mithaq/judge'
import { OpaPolicyEngine } from './opa-policy-engine.ts'

const bundlePath = new URL('./tests/fixtures/policy.wasm', import.meta.url)

/**
 * Proves `DenyOverridesStrategy` reconciles genuine OPA-compiled output —
 * not synthetic `Verdict` values from a fake engine — for a realistic
 * multi-policy scenario: a base policy that allows under a threshold, and a
 * fraud-override policy that denies outright when flagged, regardless of
 * what the base policy decided.
 */
async function buildJudge(): Promise<Judge> {
  const wasmBytes = await Deno.readFile(bundlePath)
  const engine = await OpaPolicyEngine.load(wasmBytes)

  const registry = new InMemoryPolicyRegistry()
  const action = new Action('invoice.approve')
  await registry.associate(action, new Policy('invoice.approve.base'))
  await registry.associate(action, new Policy('invoice.approve.fraud_override'))

  return new LocalJudge(
    registry,
    engine,
    new DenyOverridesStrategy(new Decision(false)),
  )
}

const action = new Action('invoice.approve')

Deno.test('Judge + OpaPolicyEngine + InMemoryPolicyRegistry: allows when the base policy allows and the override is silent', async () => {
  const judge = await buildJudge()

  const decision = await judge.decide(
    action,
    new Context({ subject: 'alice', amount: 500, flagged: false }),
  )

  assertEquals(decision.allowed, true)
  assertEquals(decision.results.length, 2)
})

Deno.test('Judge + OpaPolicyEngine + InMemoryPolicyRegistry: denies when the base policy denies (over threshold)', async () => {
  const judge = await buildJudge()

  const decision = await judge.decide(
    action,
    new Context({ subject: 'alice', amount: 5000, flagged: false }),
  )

  assertEquals(decision.allowed, false)
})

Deno.test('Judge + OpaPolicyEngine + InMemoryPolicyRegistry: the fraud override denies even when the base policy would allow', async () => {
  const judge = await buildJudge()

  const decision = await judge.decide(
    action,
    new Context({ subject: 'alice', amount: 500, flagged: true }),
  )

  assertEquals(decision.allowed, false)
  const verdicts = decision.results.map((result) => result.verdict).sort()
  assertEquals(verdicts, [Verdict.Allow, Verdict.Deny])
})

Deno.test('Judge + OpaPolicyEngine + InMemoryPolicyRegistry: denies when no policy governs the action at all', async () => {
  const wasmBytes = await Deno.readFile(bundlePath)
  const engine = await OpaPolicyEngine.load(wasmBytes)
  const registry = new InMemoryPolicyRegistry()
  const judge = new LocalJudge(
    registry,
    engine,
    new DenyOverridesStrategy(new Decision(false)),
  )

  const decision = await judge.decide(
    action,
    new Context({ subject: 'alice', amount: 500 }),
  )

  assertEquals(decision.allowed, false)
  assertEquals(decision.results.length, 0)
})

import { assertEquals, assertRejects } from '@std/assert'
import { Context, Policy, Verdict } from '@mithaq/judge'
import {
  EntrypointNotFoundError,
  OpaPolicyEngine,
} from './opa-policy-engine.ts'

const bundlePath = new URL('./tests/fixtures/policy.wasm', import.meta.url)

const approvePolicy = new Policy('invoice.approve')
const neutralPolicy = new Policy('invoice.neutral')

async function loadFixtureEngine(): Promise<OpaPolicyEngine> {
  const wasmBytes = await Deno.readFile(bundlePath)
  return await OpaPolicyEngine.load(wasmBytes)
}

Deno.test("OpaPolicyEngine.evaluate: returns Allow when the selected entrypoint's allow rule is true", async () => {
  const engine = await loadFixtureEngine()

  const result = await engine.evaluate(
    approvePolicy,
    new Context({ subject: 'alice' }),
  )

  assertEquals(result.verdict, Verdict.Allow)
})

Deno.test("OpaPolicyEngine.evaluate: returns Deny when the selected entrypoint's allow rule is false", async () => {
  const engine = await loadFixtureEngine()

  const result = await engine.evaluate(
    approvePolicy,
    new Context({ subject: 'bob' }),
  )

  assertEquals(result.verdict, Verdict.Deny)
})

Deno.test("OpaPolicyEngine.evaluate: returns Neutral when the selected entrypoint's allow rule is undefined", async () => {
  const engine = await loadFixtureEngine()

  const result = await engine.evaluate(
    neutralPolicy,
    new Context({ subject: 'alice' }),
  )

  assertEquals(result.verdict, Verdict.Neutral)
})

Deno.test('OpaPolicyEngine.evaluate: evaluates different policies against the same loaded bundle', async () => {
  const engine = await loadFixtureEngine()

  const approveResult = await engine.evaluate(
    approvePolicy,
    new Context({ subject: 'alice' }),
  )
  const neutralResult = await engine.evaluate(
    neutralPolicy,
    new Context({ subject: 'alice' }),
  )

  assertEquals(approveResult.verdict, Verdict.Allow)
  assertEquals(neutralResult.verdict, Verdict.Neutral)
})

Deno.test('OpaPolicyEngine.evaluate: rejects when the bundle has no entrypoint for the policy', async () => {
  const engine = await loadFixtureEngine()

  await assertRejects(
    () => engine.evaluate(new Policy('unknown.policy'), new Context()),
    EntrypointNotFoundError,
  )
})

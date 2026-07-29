import { assertEquals, assertRejects } from '@std/assert'
import { Context, Policy, Verdict } from '@mithaq/judge'
import { OpaPolicyEngine, PolicyNotLoadedError } from './opa-policy-engine.ts'

const fixturesDir = new URL('./tests/fixtures/', import.meta.url)

const approvePolicy = new Policy('invoice.approve')
const neutralPolicy = new Policy('invoice.neutral')

async function loadFixtureEngine(): Promise<OpaPolicyEngine> {
  const approveWasm = await Deno.readFile(
    new URL('invoice-approve.wasm', fixturesDir),
  )
  const neutralWasm = await Deno.readFile(
    new URL('invoice-neutral.wasm', fixturesDir),
  )
  return await OpaPolicyEngine.load(
    new Map([
      [approvePolicy, approveWasm],
      [neutralPolicy, neutralWasm],
    ]),
  )
}

Deno.test("OpaPolicyEngine.evaluate: returns Allow when the compiled policy's allow rule is true", async () => {
  const engine = await loadFixtureEngine()

  const result = await engine.evaluate(
    approvePolicy,
    new Context({ subject: 'alice' }),
  )

  assertEquals(result.verdict, Verdict.Allow)
})

Deno.test("OpaPolicyEngine.evaluate: returns Deny when the compiled policy's allow rule is false", async () => {
  const engine = await loadFixtureEngine()

  const result = await engine.evaluate(
    approvePolicy,
    new Context({ subject: 'bob' }),
  )

  assertEquals(result.verdict, Verdict.Deny)
})

Deno.test("OpaPolicyEngine.evaluate: returns Neutral when the compiled policy's allow rule is undefined", async () => {
  const engine = await loadFixtureEngine()

  const result = await engine.evaluate(
    neutralPolicy,
    new Context({ subject: 'alice' }),
  )

  assertEquals(result.verdict, Verdict.Neutral)
})

Deno.test("OpaPolicyEngine.evaluate: rejects when asked to evaluate a policy it wasn't loaded with", async () => {
  const engine = await loadFixtureEngine()

  await assertRejects(
    () => engine.evaluate(new Policy('unknown.policy'), new Context()),
    PolicyNotLoadedError,
  )
})

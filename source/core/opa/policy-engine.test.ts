import { assertEquals, assertRejects } from '@std/assert'
import * as Access from '@idhn/access'
import * as Policy from '@idhn/policy'
import { EntrypointNotFoundError, PolicyEngine } from './policy-engine.ts'

const bundlePath = new URL('./tests/fixtures/policy.wasm', import.meta.url)

const approvePolicy = new Policy.Identifier('invoice.approve')
const neutralPolicy = new Policy.Identifier('invoice.neutral')

async function loadFixtureEngine(): Promise<PolicyEngine> {
  const wasmBytes = await Deno.readFile(bundlePath)
  return await PolicyEngine.load(wasmBytes)
}

Deno.test("OPA.PolicyEngine.evaluate: returns Allow when the selected entrypoint's allow rule is true", async () => {
  const engine = await loadFixtureEngine()

  const result = await engine.evaluate(
    approvePolicy,
    new Access.Context({ subject: 'alice' }),
  )

  assertEquals(result.verdict, Policy.Verdict.Allow)
})

Deno.test("OPA.PolicyEngine.evaluate: returns Deny when the selected entrypoint's allow rule is false", async () => {
  const engine = await loadFixtureEngine()

  const result = await engine.evaluate(
    approvePolicy,
    new Access.Context({ subject: 'bob' }),
  )

  assertEquals(result.verdict, Policy.Verdict.Deny)
})

Deno.test("OPA.PolicyEngine.evaluate: returns Neutral when the selected entrypoint's allow rule is undefined", async () => {
  const engine = await loadFixtureEngine()

  const result = await engine.evaluate(
    neutralPolicy,
    new Access.Context({ subject: 'alice' }),
  )

  assertEquals(result.verdict, Policy.Verdict.Neutral)
})

Deno.test('OPA.PolicyEngine.evaluate: evaluates different policies against the same loaded bundle', async () => {
  const engine = await loadFixtureEngine()

  const approveResult = await engine.evaluate(
    approvePolicy,
    new Access.Context({ subject: 'alice' }),
  )
  const neutralResult = await engine.evaluate(
    neutralPolicy,
    new Access.Context({ subject: 'alice' }),
  )

  assertEquals(approveResult.verdict, Policy.Verdict.Allow)
  assertEquals(neutralResult.verdict, Policy.Verdict.Neutral)
})

Deno.test('OPA.PolicyEngine.evaluate: rejects when the bundle has no entrypoint for the policy', async () => {
  const engine = await loadFixtureEngine()

  await assertRejects(
    () =>
      engine.evaluate(
        new Policy.Identifier('unknown.policy'),
        new Access.Context(),
      ),
    EntrypointNotFoundError,
  )
})

const allowlistedPolicy = new Policy.Identifier('invoice.allowlisted')

Deno.test('OPA.PolicyEngine.load: policies read the supplied data document as `data`', async () => {
  const wasmBytes = await Deno.readFile(bundlePath)
  const engine = await PolicyEngine.load(wasmBytes, {
    approvers: ['alice', 'carol'],
  })

  const listed = await engine.evaluate(
    allowlistedPolicy,
    new Access.Context({ subject: 'carol' }),
  )
  const unlisted = await engine.evaluate(
    allowlistedPolicy,
    new Access.Context({ subject: 'bob' }),
  )

  assertEquals(listed.verdict, Policy.Verdict.Allow)
  assertEquals(unlisted.verdict, Policy.Verdict.Deny)
})

Deno.test('OPA.PolicyEngine.load: without data, a policy reading `data` denies rather than allowing', async () => {
  const engine = await loadFixtureEngine()

  const result = await engine.evaluate(
    allowlistedPolicy,
    new Access.Context({ subject: 'alice' }),
  )

  assertEquals(result.verdict, Policy.Verdict.Deny)
})

Deno.test("OPA.PolicyEngine.evaluate: a policy's `show` rule says how the answer's fields may be shown to this caller", async () => {
  const engine = await loadFixtureEngine()
  const directory = new Policy.Identifier('member.directory')
  const member = await engine.evaluate(
    directory,
    new Access.Context({
      auth: {
        status: 'authenticated',
        subject: 'u-1',
        claims: { role: 'member' },
      },
    }),
  )
  assertEquals(member.verdict, Policy.Verdict.Allow)
  assertEquals(member.disclosure.toJSON(), {
    '/members/*/email': { kind: 'partial', form: 'email' },
    '/members/*/name': { kind: 'replacement', using: 'initials' },
  })

  const admin = await engine.evaluate(
    directory,
    new Access.Context({
      auth: {
        status: 'authenticated',
        subject: 'u-2',
        claims: { role: 'admin' },
      },
    }),
  )
  assertEquals(admin.disclosure.toJSON()['/members/*/name'], 'visible')
})

Deno.test('OPA.PolicyEngine.evaluate: a policy without a `show` rule says nothing about the answer', async () => {
  const engine = await loadFixtureEngine()
  const result = await engine.evaluate(
    new Policy.Identifier('invoice.approve'),
    new Access.Context({
      amount: 50,
      approverId: 'manager-1',
      requesterId: 'employee-1',
    }),
  )
  assertEquals(result.disclosure.isEmpty, true)
})

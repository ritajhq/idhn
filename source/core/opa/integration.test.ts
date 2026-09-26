import { assertEquals } from '@std/assert'
import * as Access from '@idhn/access'
import * as Judge from '@idhn/judge'
import * as Policy from '@idhn/policy'
import { PolicyEngine } from './policy-engine.ts'

const bundlePath = new URL('./tests/fixtures/policy.wasm', import.meta.url)

/**
 * Proves `DenyOverridesStrategy` reconciles genuine OPA-compiled output —
 * not synthetic `Verdict` values from a fake engine — for a realistic
 * multi-policy scenario: a base policy that allows under a threshold, and a
 * fraud-override policy that denies outright when flagged, regardless of
 * what the base policy decided.
 */
async function buildJudge(): Promise<Judge.Behavior> {
  const wasmBytes = await Deno.readFile(bundlePath)
  const engine = await PolicyEngine.load(wasmBytes)

  const registry = new Policy.Registries.InMemory()
  const action = new Access.Action('invoice.approve')
  await registry.associate(
    action,
    new Policy.Identifier('invoice.approve.base'),
  )
  await registry.associate(
    action,
    new Policy.Identifier('invoice.approve.fraud_override'),
  )

  return new Judge.Local(
    registry,
    engine,
    new Judge.DenyOverridesStrategy(new Judge.Decision(false)),
    new Judge.Enrichers.Passthrough(),
  )
}

const action = new Access.Action('invoice.approve')

Deno.test('Judge + OPA.PolicyEngine + Policy.Registries.InMemory: allows when the base policy allows and the override is silent', async () => {
  const judge = await buildJudge()

  const decision = await judge.decide(
    action,
    new Access.Context({ subject: 'alice', amount: 500, flagged: false }),
  )

  assertEquals(decision.allowed, true)
  assertEquals(decision.results.length, 2)
})

Deno.test('Judge + OPA.PolicyEngine + Policy.Registries.InMemory: denies when the base policy denies (over threshold)', async () => {
  const judge = await buildJudge()

  const decision = await judge.decide(
    action,
    new Access.Context({ subject: 'alice', amount: 5000, flagged: false }),
  )

  assertEquals(decision.allowed, false)
})

Deno.test('Judge + OPA.PolicyEngine + Policy.Registries.InMemory: the fraud override denies even when the base policy would allow', async () => {
  const judge = await buildJudge()

  const decision = await judge.decide(
    action,
    new Access.Context({ subject: 'alice', amount: 500, flagged: true }),
  )

  assertEquals(decision.allowed, false)
  const verdicts = decision.results.map((result) => result.verdict).sort()
  assertEquals(verdicts, [Policy.Verdict.Allow, Policy.Verdict.Deny])
})

Deno.test('Judge + OPA.PolicyEngine + Policy.Registries.InMemory: denies when no policy governs the action at all', async () => {
  const wasmBytes = await Deno.readFile(bundlePath)
  const engine = await PolicyEngine.load(wasmBytes)
  const registry = new Policy.Registries.InMemory()
  const judge = new Judge.Local(
    registry,
    engine,
    new Judge.DenyOverridesStrategy(new Judge.Decision(false)),
    new Judge.Enrichers.Passthrough(),
  )

  const decision = await judge.decide(
    action,
    new Access.Context({ subject: 'alice', amount: 500 }),
  )

  assertEquals(decision.allowed, false)
  assertEquals(decision.results.length, 0)
})

Deno.test('Judge + OPA.PolicyEngine + HttpLookup: a policy decides on a fact fetched from a directory service before evaluation', async () => {
  const controller = new AbortController()
  const directory = Deno.serve(
    { port: 0, signal: controller.signal, onListen: () => {} },
    (request) => {
      const agent = new URL(request.url).pathname.split('/').at(-1)
      return Response.json({ active: agent === 'alice' })
    },
  )
  const origin = `http://localhost:${(directory.addr as Deno.NetAddr).port}`

  try {
    const wasmBytes = await Deno.readFile(bundlePath)
    const registry = new Policy.Registries.InMemory()
    const directoryAction = new Access.Action('invoice.directory_check')
    await registry.associate(
      directoryAction,
      new Policy.Identifier('invoice.directory'),
    )
    const judge = new Judge.Local(
      registry,
      await PolicyEngine.load(wasmBytes),
      new Judge.DenyOverridesStrategy(new Judge.Decision(false)),
      new Judge.Enrichers.HttpLookup({
        as: 'agent_directory',
        url: `${origin}/agents/{subject}`,
        ttlSeconds: 0,
        optional: false,
      }),
    )

    const active = await judge.decide(
      directoryAction,
      new Access.Context({ subject: 'alice' }),
    )
    const inactive = await judge.decide(
      directoryAction,
      new Access.Context({ subject: 'mallory' }),
    )

    assertEquals(active.allowed, true)
    assertEquals(inactive.allowed, false)
  } finally {
    controller.abort()
    await directory.finished
  }
})

const alice = Access.Identity.authenticated('u-1', 'portal', {
  username: 'alice',
  emailVerified: true,
})
const unverified = Access.Identity.authenticated('u-2', 'portal', {
  username: 'bob',
  emailVerified: false,
})

async function judgeGoverning(
  policy: string,
  data: Record<string, unknown> = {},
  enricher: Judge.Enricher = new Judge.Enrichers.Passthrough(),
): Promise<{ judge: Judge.Behavior; action: Access.Action }> {
  const registry = new Policy.Registries.InMemory()
  const governed = new Access.Action(policy)
  await registry.associate(governed, new Policy.Identifier(policy))
  const judge = new Judge.Local(
    registry,
    await PolicyEngine.load(await Deno.readFile(bundlePath), data),
    new Judge.DenyOverridesStrategy(new Judge.Decision(false)),
    enricher,
  )
  return { judge, action: governed }
}

function authenticatedAs(
  identity: Access.Identity,
  facts: Record<string, unknown> = {},
): Access.Context {
  return new Access.Context(facts).with({
    [Access.Identity.FACT]: identity.toFact(),
  })
}

Deno.test('Judge + OPA.PolicyEngine + auth: a policy requiring authentication reads the identity and its claims', async () => {
  const { judge, action } = await judgeGoverning('profile.read')

  const verified = await judge.decide(action, authenticatedAs(alice))
  const notVerified = await judge.decide(action, authenticatedAs(unverified))
  const anonymous = await judge.decide(
    action,
    authenticatedAs(Access.Identity.anonymous()),
  )
  const invalid = await judge.decide(
    action,
    authenticatedAs(Access.Identity.invalid()),
  )

  assertEquals(verified.allowed, true)
  assertEquals(notVerified.allowed, false)
  assertEquals(anonymous.allowed, false)
  assertEquals(invalid.allowed, false)
})

Deno.test('Judge + OPA.PolicyEngine + auth: a role the identity provider cannot say comes from data, keyed by the subject', async () => {
  const { judge, action } = await judgeGoverning('report.view', {
    roles: { 'u-1': ['auditor'], 'u-2': ['viewer'] },
  })

  const auditor = await judge.decide(action, authenticatedAs(alice))
  const viewer = await judge.decide(action, authenticatedAs(unverified))
  const anonymous = await judge.decide(
    action,
    authenticatedAs(Access.Identity.anonymous()),
  )

  assertEquals(auditor.allowed, true)
  assertEquals(viewer.allowed, false)
  assertEquals(anonymous.allowed, false)
})

Deno.test('Judge + OPA.PolicyEngine + auth + HttpLookup: a relationship is looked up by the authenticated subject', async () => {
  const requested: string[] = []
  const controller = new AbortController()
  const managers = Deno.serve(
    { port: 0, signal: controller.signal, onListen: () => {} },
    (request) => {
      const subject = new URL(request.url).pathname.split('/').at(-2) ?? ''
      requested.push(subject)
      return Response.json({ places: subject === 'u-1' ? ['p-1'] : [] })
    },
  )
  const origin = `http://localhost:${(managers.addr as Deno.NetAddr).port}`

  try {
    const { judge, action } = await judgeGoverning(
      'place.manage',
      {},
      new Judge.Enrichers.HttpLookup({
        as: 'managed_places',
        url: `${origin}/managers/{auth.subject}/places`,
        ttlSeconds: 0,
        // An anonymous identity has no subject: omit the fact, and let the policy deny.
        optional: true,
      }),
    )

    const manager = await judge.decide(
      action,
      authenticatedAs(alice, { placeId: 'p-1' }),
    )
    const otherPlace = await judge.decide(
      action,
      authenticatedAs(alice, { placeId: 'p-2' }),
    )
    const notManager = await judge.decide(
      action,
      authenticatedAs(unverified, { placeId: 'p-1' }),
    )
    const anonymous = await judge.decide(
      action,
      authenticatedAs(Access.Identity.anonymous(), { placeId: 'p-1' }),
    )

    assertEquals(manager.allowed, true)
    assertEquals(otherPlace.allowed, false)
    assertEquals(notManager.allowed, false)
    assertEquals(anonymous.allowed, false)
    assertEquals(requested, ['u-1', 'u-1', 'u-2'])
  } finally {
    controller.abort()
    await managers.finished
  }
})

Deno.test('Judge + OPA.PolicyEngine + auth: when the identity cannot be checked, public actions still pass and protected ones are denied', async () => {
  const outage = Access.Identity.unavailable()
  const publicAction = await judgeGoverning('catalog.browse')
  const protectedAction = await judgeGoverning('profile.read')

  const onPublic = await publicAction.judge.decide(
    publicAction.action,
    authenticatedAs(outage),
  )
  const onProtected = await protectedAction.judge.decide(
    protectedAction.action,
    authenticatedAs(outage),
  )

  assertEquals(onPublic.allowed, true)
  assertEquals(onProtected.allowed, false)
})

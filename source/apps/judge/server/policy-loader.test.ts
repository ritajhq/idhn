import { assertEquals, assertRejects } from '@std/assert'
import * as Access from '@idhn/access'
import * as Distribution from '@idhn/distribution'
import * as Judge from '@idhn/judge'
import { JudgeAssembly } from './judge-assembly.ts'
import { PolicyLoader } from './policy-loader.ts'

// The fixture bundle: `catalog.browse` allows everyone.
const bundle = await Deno.readFile(
  new URL('../../../core/opa/tests/fixtures/policy.wasm', import.meta.url),
)

const setGoverningBy = (version: string, policy: string) =>
  new Distribution.PolicySet(version, bundle, `associations:\n  shop.browse: [${policy}]\n`)

const action = new Access.Action('shop.browse')
const context = new Access.Context({})

function loaderWithOutcomes() {
  const judge = new Judge.Reloadable()
  const loader = new PolicyLoader(new JudgeAssembly(5000), judge)
  const outcomes: string[] = []
  loader.OnLoaded.Do((set) => outcomes.push(`loaded ${set.version}`))
  loader.OnFailed.Do((set) => outcomes.push(`failed ${set.version}`))
  return { judge, loader, outcomes }
}

Deno.test('PolicyLoader.load: judges with the set it was given', async () => {
  const { judge, loader, outcomes } = loaderWithOutcomes()

  await loader.load(setGoverningBy('v1', 'catalog.browse'))
  const decision = await judge.decide(action, context, Judge.Deadline.unbounded())

  assertEquals(outcomes, ['loaded v1'])
  assertEquals(decision.allowed, true)
})

Deno.test('PolicyLoader.load: keeps judging with the last good set when a new one fails to build', async () => {
  const { judge, loader, outcomes } = loaderWithOutcomes()
  await loader.load(setGoverningBy('v1', 'catalog.browse'))

  await loader.load(new Distribution.PolicySet('v2', new TextEncoder().encode('not wasm'), 'associations: {}\n'))
  const decision = await judge.decide(action, context, Judge.Deadline.unbounded())

  assertEquals(outcomes, ['loaded v1', 'failed v2'])
  assertEquals(decision.allowed, true)
})

Deno.test('PolicyLoader.load: leaves the judge unavailable while no set has loaded', async () => {
  const { judge, loader } = loaderWithOutcomes()

  await loader.load(new Distribution.PolicySet('v1', bundle, 'associations: [malformed]\n'))

  await assertRejects(
    () => judge.decide(action, context, Judge.Deadline.unbounded()),
    Judge.UnavailableError,
  )
})

Deno.test('PolicyLoader.load: loads sets in the order given, so the last one wins', async () => {
  const { loader, outcomes } = loaderWithOutcomes()

  await Promise.all([
    loader.load(setGoverningBy('v1', 'catalog.browse')),
    loader.load(setGoverningBy('v2', 'catalog.browse')),
  ])

  assertEquals(outcomes, ['loaded v1', 'loaded v2'])
})

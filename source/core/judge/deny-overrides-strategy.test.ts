import { assertEquals } from '@std/assert'
import * as Policy from '@idhn/policy'
import { Decision } from './decision.ts'
import { DenyOverridesStrategy } from './deny-overrides-strategy.ts'

const policyA = new Policy.Identifier('policy.a')
const policyB = new Policy.Identifier('policy.b')

Deno.test('DenyOverridesStrategy.combine: allows when every applicable result allows', () => {
  const strategy = new DenyOverridesStrategy(new Decision(false))
  const results = [
    new Policy.Result(policyA, Policy.Verdict.Allow),
    new Policy.Result(policyB, Policy.Verdict.Allow),
  ]

  const decision = strategy.combine(results)

  assertEquals(decision.allowed, true)
  assertEquals(decision.results, results)
})

Deno.test('DenyOverridesStrategy.combine: denies when any result denies, even if others allow', () => {
  const strategy = new DenyOverridesStrategy(new Decision(false))
  const results = [
    new Policy.Result(policyA, Policy.Verdict.Allow),
    new Policy.Result(policyB, Policy.Verdict.Deny),
  ]

  const decision = strategy.combine(results)

  assertEquals(decision.allowed, false)
})

Deno.test('DenyOverridesStrategy.combine: a neutral result does not override an allow', () => {
  const strategy = new DenyOverridesStrategy(new Decision(false))
  const results = [
    new Policy.Result(policyA, Policy.Verdict.Allow),
    new Policy.Result(policyB, Policy.Verdict.Neutral),
  ]

  const decision = strategy.combine(results)

  assertEquals(decision.allowed, true)
})

Deno.test('DenyOverridesStrategy.combine: falls back to the configured default when there are no results', () => {
  const fallback = new Decision(true)
  const strategy = new DenyOverridesStrategy(fallback)

  const decision = strategy.combine([])

  assertEquals(decision, fallback)
})

Deno.test('DenyOverridesStrategy.combine: falls back to the configured default when every result is neutral', () => {
  const fallback = new Decision(false)
  const strategy = new DenyOverridesStrategy(fallback)
  const results = [
    new Policy.Result(policyA, Policy.Verdict.Neutral),
    new Policy.Result(policyB, Policy.Verdict.Neutral),
  ]

  const decision = strategy.combine(results)

  assertEquals(decision, fallback)
})

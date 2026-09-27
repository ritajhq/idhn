import { assertEquals } from '@std/assert'
import * as Access from '@idhn/access'
import type { Behavior } from './behavior.ts'
import { Deadline } from './deadline.ts'
import { AuthenticatedOnly } from './authenticated-only.ts'

const action = new Access.Action('invoice.approve')

function decideFor(identity: Access.Identity) {
  const judge: Behavior = new AuthenticatedOnly()
  return judge.decide(
    action,
    new Access.Context({ [Access.Identity.FACT]: identity.toFact() }),
    Deadline.unbounded(),
  )
}

Deno.test('AuthenticatedOnly.decide: allows an authenticated caller, with no results and no id since no policy was evaluated', async () => {
  const decision = await decideFor(
    Access.Identity.authenticated('alice', 'https://auth.example'),
  )

  assertEquals(decision.allowed, true)
  assertEquals(decision.results, [])
  assertEquals(decision.id, undefined)
})

Deno.test('AuthenticatedOnly.decide: denies an anonymous, invalid or unavailable caller', async () => {
  for (
    const identity of [
      Access.Identity.anonymous(),
      Access.Identity.invalid(),
      Access.Identity.unavailable(),
    ]
  ) {
    assertEquals((await decideFor(identity)).allowed, false, identity.status)
  }
})

Deno.test('AuthenticatedOnly.decide: denies when the context has no auth fact at all', async () => {
  const judge: Behavior = new AuthenticatedOnly()
  const decision = await judge.decide(
    action,
    new Access.Context({}),
    Deadline.unbounded(),
  )

  assertEquals(decision.allowed, false)
})

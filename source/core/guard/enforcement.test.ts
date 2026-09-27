import { assertEquals, assertInstanceOf } from '@std/assert'
import * as Judge from '@idhn/judge'
import { Enforcement } from './enforcement.ts'

class FakeJudge implements Judge.Behavior {
  decide(): Promise<Judge.Decision> {
    return Promise.resolve(new Judge.Decision(false))
  }
}

const judging = () => new FakeJudge()

Deno.test('Enforcement full: asks the judge it is handed, and authenticates with the declared scheme', async () => {
  const enforcement = new Enforcement('full')

  assertInstanceOf(await enforcement.judge(judging), FakeJudge)
  assertEquals(
    enforcement.authentication(() => 'declared', () => 'none'),
    'declared',
  )
})

Deno.test('Enforcement authn-only: asks no judge but lets authenticated callers through, and authenticates with the declared scheme', async () => {
  const enforcement = new Enforcement('authn-only')

  assertInstanceOf(await enforcement.judge(judging), Judge.AuthenticatedOnly)
  assertEquals(
    enforcement.authentication(() => 'declared', () => 'none'),
    'declared',
  )
})

Deno.test('Enforcement permissive: asks no judge and authenticates no one', async () => {
  const enforcement = new Enforcement('permissive')

  assertInstanceOf(await enforcement.judge(judging), Judge.Permissive)
  assertEquals(
    enforcement.authentication(() => 'declared', () => 'none'),
    'none',
  )
})

Deno.test('Enforcement: never builds the judge a level does not ask', async () => {
  let built = false
  await new Enforcement('permissive').judge(() => {
    built = true
    return judging()
  })

  assertEquals(built, false)
})

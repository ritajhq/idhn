import { assert, assertEquals } from '@std/assert'
import { Deadline } from './deadline.ts'

Deno.test('Deadline.in: counts down from the wait it was set for, and passes when it runs out', async () => {
  const deadline = Deadline.in(30)

  assertEquals(deadline.ms, 30)
  assert(deadline.remainingMs() <= 30)
  assertEquals(deadline.passed, false)

  await new Promise((resolve) => setTimeout(resolve, 60))

  assertEquals(deadline.remainingMs(), 0)
  assertEquals(deadline.passed, true)
})

Deno.test('Deadline.unbounded: never passes', () => {
  const deadline = Deadline.unbounded()

  assertEquals(deadline.passed, false)
  assertEquals(deadline.remainingMs(), Number.POSITIVE_INFINITY)
})

Deno.test('Deadline.within: keeps the deadline when it comes first, and sets an earlier one otherwise', () => {
  const soon = Deadline.in(1000)

  assertEquals(soon.within(5000), soon)
  assertEquals(soon.within(10).ms, 10)
  assertEquals(Deadline.unbounded().within(10).ms, 10)
  const unbounded = Deadline.unbounded()
  assertEquals(unbounded.within(Number.POSITIVE_INFINITY), unbounded)
})

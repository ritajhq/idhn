import { assertEquals, assertThrows } from '@std/assert'
import { ConflictingFactError, Context } from './context.ts'

Deno.test('Context.with: returns a new context with the additional facts, leaving the original untouched', () => {
  const original = new Context({ subject: 'alice' })

  const extended = original.with({ directory: { active: true } })

  assertEquals(extended.facts, {
    subject: 'alice',
    directory: { active: true },
  })
  assertEquals(original.facts, { subject: 'alice' })
})

Deno.test('Context.with: refuses to overwrite a fact that is already present', () => {
  const context = new Context({ subject: 'alice' })

  assertThrows(
    () => context.with({ subject: 'mallory' }),
    ConflictingFactError,
    'subject',
  )
})

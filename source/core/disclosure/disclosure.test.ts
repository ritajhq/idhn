import { assertEquals, assertThrows } from '@std/assert'
import {
  Disclosure,
  Field,
  InvalidFieldError,
  InvalidPresentationError,
  MASK,
  Presentation,
} from './index.ts'

const show = (spec: unknown, value: unknown) =>
  Presentation.parse(spec, 'show').present(value)

Deno.test('Presentation: each kind shows what it says, and covers what it cannot apply to', () => {
  assertEquals(show('visible', 'ada@example.com'), 'ada@example.com')
  assertEquals(show('covered', 'ada@example.com'), MASK)
  assertEquals(show('covered', { nested: true }), MASK)
  assertEquals(
    show({ kind: 'partial', keep: 'last', count: 4 }, '4111111111111111'),
    `${MASK}1111`,
  )
  assertEquals(
    show({ kind: 'partial', keep: 'first', count: 2 }, 12345),
    `12${MASK}`,
  )
  // Keeping as many characters as there are would show the whole value.
  assertEquals(show({ kind: 'partial', keep: 'last', count: 4 }, 'abcd'), MASK)
  assertEquals(
    show({ kind: 'partial', form: 'email' }, 'ada@example.com'),
    `${MASK}@example.com`,
  )
  assertEquals(show({ kind: 'partial', form: 'email' }, 'not an email'), MASK)
  assertEquals(
    show({ kind: 'replacement', using: 'initials' }, 'ada  lovelace'),
    'A. L.',
  )
  assertEquals(show({ kind: 'replacement', using: 'initials' }, 42), MASK)
  assertEquals(
    show({ kind: 'replacement', using: 'domain' }, 'ada@example.com'),
    'example.com',
  )
  assertEquals(
    show({ kind: 'replacement', using: 'constant', value: 'someone' }, 'Ada'),
    'someone',
  )
})

Deno.test('Presentation: the one that withholds more wins', () => {
  const partial = Presentation.parse({ kind: 'partial', form: 'email' }, 'a')
  const initials = Presentation.parse({
    kind: 'replacement',
    using: 'initials',
  }, 'b')
  assertEquals(Presentation.visible.strictest(partial), partial)
  assertEquals(partial.strictest(initials), initials)
  assertEquals(initials.strictest(Presentation.covered), Presentation.covered)
  assertEquals(
    Presentation.covered.strictest(Presentation.visible),
    Presentation.covered,
  )
})

Deno.test('Presentation: refuses what it cannot read, naming where', () => {
  for (
    const spec of [
      'hidden',
      { kind: 'blurred' },
      { kind: 'partial', keep: 'middle', count: 2 },
      { kind: 'partial', keep: 'last', count: 0 },
      { kind: 'partial', form: 'phone' },
      { kind: 'replacement', using: 'hash' },
      { kind: 'replacement', using: 'constant' },
    ]
  ) {
    assertThrows(
      () => Presentation.parse(spec, 'restrict[0].show'),
      InvalidPresentationError,
      'restrict[0].show',
    )
  }
})

Deno.test('Field: a JSON Pointer, with * for every item, and keys with dots or slashes', () => {
  const document = {
    data: {
      'query.result': {
        value: {
          users: [
            { email: 'ada@example.com', name: 'Ada' },
            { email: 'bob@example.com', name: 'Bob' },
          ],
          'a/b': 'slash',
        },
      },
    },
  }
  Field.parse('/data/query.result/value/users/*/email', 'f').presentIn(
    document,
    Presentation.covered,
  )
  Field.parse('/data/query.result/value/a~1b', 'f').presentIn(
    document,
    Presentation.covered,
  )
  Field.parse('/data/missing/field', 'f').presentIn(
    document,
    Presentation.covered,
  )
  assertEquals(document.data['query.result'].value, {
    users: [{ email: MASK, name: 'Ada' }, { email: MASK, name: 'Bob' }],
    'a/b': MASK,
  })
  assertThrows(() => Field.parse('user/email', 'f'), InvalidFieldError)
  assertThrows(() => Field.parse('/', 'f'), InvalidFieldError)
})

Deno.test('Disclosure: policies combine strictest-first, then stand in for the manifest default', () => {
  const email = Field.parse('/email', 'f')
  const name = Field.parse('/name', 'f')
  const defaults = Disclosure.of([[email, Presentation.covered], [
    name,
    Presentation.covered,
  ]])
  const relaxed = Disclosure.parse({
    '/email': { kind: 'partial', form: 'email' },
  }, 'show')
  const visible = Disclosure.parse({ '/email': 'visible' }, 'show')

  // Two policies: one would show the email, one only its domain. The stricter wins.
  const said = Disclosure.combine([visible, relaxed])
  assertEquals(said.toJSON(), { '/email': { kind: 'partial', form: 'email' } })

  // What they said replaces the default for that field; the name keeps its default.
  const shown = said.over(defaults).apply({
    email: 'ada@example.com',
    name: 'Ada',
    id: 'u-1',
  })
  assertEquals(shown, { email: `${MASK}@example.com`, name: MASK, id: 'u-1' })

  // Nobody said anything: the manifest's defaults hold, so nothing restricted leaks.
  assertEquals(
    Disclosure.none.over(defaults).apply({ email: 'ada@example.com' }),
    { email: MASK },
  )
  assertEquals(Disclosure.none.isEmpty, true)
})

Deno.test('Disclosure: applying never changes the original', () => {
  const original = { email: 'ada@example.com' }
  Disclosure.parse({ '/email': 'covered' }, 'show').apply(original)
  assertEquals(original, { email: 'ada@example.com' })
})

Deno.test('Disclosure: round-trips through its JSON, as a judge server sends it', () => {
  const disclosure = Disclosure.parse({
    '/email': { kind: 'partial', form: 'email' },
    '/card': { kind: 'partial', keep: 'last', count: 4 },
    '/name': { kind: 'replacement', using: 'constant', value: 'someone' },
    '/ssn': 'covered',
  }, 'show')
  assertEquals(
    Disclosure.parse(JSON.parse(JSON.stringify(disclosure)), 'wire').toJSON(),
    disclosure.toJSON(),
  )
})

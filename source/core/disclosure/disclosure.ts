import { Field } from './field.ts'
import { Presentation, type PresentationSpec } from './presentation.ts'

/**
 * How much of each restricted field of an answer a caller is shown: one
 * `Presentation` per `Field`. A field it doesn't name is shown as it is.
 *
 * Policies each say how a field may be shown to this caller; combined, the
 * one that withholds most wins, as a deny overrides an allow. What they say
 * then takes the place of the manifest's default for that field — so a field
 * the manifest restricts stays restricted unless a policy says otherwise.
 */
export class Disclosure {
  static readonly none: Disclosure = new Disclosure(new Map())

  private constructor(
    private readonly fields: ReadonlyMap<
      string,
      readonly [Field, Presentation]
    >,
  ) {}

  static of(entries: Iterable<readonly [Field, Presentation]>): Disclosure {
    const fields = new Map<string, readonly [Field, Presentation]>()
    for (const [field, presentation] of entries) {
      const known = fields.get(field.pointer)?.[1]
      fields.set(field.pointer, [
        field,
        known ? known.strictest(presentation) : presentation,
      ])
    }
    return new Disclosure(fields)
  }

  /**
   * Reads `{ "<pointer>": <presentation>, … }`, as a `show` rule answers and
   * a judge server sends it. Throws `InvalidFieldError` or
   * `InvalidPresentationError`.
   */
  static parse(raw: unknown, path: string): Disclosure {
    if (raw === undefined || raw === null) return Disclosure.none
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError(`${path} must map JSON Pointers to presentations`)
    }
    return Disclosure.of(
      Object.entries(raw).map(([pointer, spec]) =>
        [
          Field.parse(pointer, `${path} key ${JSON.stringify(pointer)}`),
          Presentation.parse(spec, `${path}[${JSON.stringify(pointer)}]`),
        ] as const
      ),
    )
  }

  /** Every field any of them restricts, each shown as the strictest of them says. */
  static combine(disclosures: Iterable<Disclosure>): Disclosure {
    return Disclosure.of(
      [...disclosures].flatMap((disclosure) => [...disclosure.fields.values()]),
    )
  }

  get isEmpty(): boolean {
    return this.fields.size === 0
  }

  /** Each field as this says, and as `defaults` says where this says nothing. */
  over(defaults: Disclosure): Disclosure {
    const fields = new Map(defaults.fields)
    for (const [pointer, entry] of this.fields) fields.set(pointer, entry)
    return new Disclosure(fields)
  }

  /** `document` as the caller may see it: a copy, every restricted field presented. */
  apply(document: unknown): unknown {
    const copy = structuredClone(document)
    for (const [field, presentation] of this.fields.values()) {
      field.presentIn(copy, presentation)
    }
    return copy
  }

  toJSON(): Record<string, PresentationSpec> {
    return Object.fromEntries(
      [...this.fields].map(([pointer, [, presentation]]) => [
        pointer,
        presentation.toJSON(),
      ]),
    )
  }
}

/**
 * What a hidden value, or the hidden part of one, is shown as. Always the
 * same, whatever it stands for, so nothing about the value — its length
 * included — shows through.
 */
export const MASK = '••••••'

/** What a presentation is written as, in a manifest or in a policy's `show` rule. */
export type PresentationSpec =
  | 'visible'
  | 'covered'
  | { kind: 'visible' }
  | { kind: 'covered' }
  | { kind: 'partial'; keep: 'first' | 'last'; count: number }
  | { kind: 'partial'; form: 'email' }
  | { kind: 'replacement'; using: 'initials' | 'domain' }
  | { kind: 'replacement'; using: 'constant'; value: string }

export class InvalidPresentationError extends Error {}

/**
 * How much of one field a caller is shown: all of it (`visible`), part of it
 * (`partial`), something derived from it (`replacement`), or none of it
 * (`covered`). Ranked by how much they withhold, so when two disagree the
 * one that withholds more wins.
 *
 * A presentation that can't apply to a value — the initials of a number, the
 * last characters of an object — covers it instead: what can't be shown in
 * part is not shown at all.
 */
export abstract class Presentation {
  /** How much it withholds: 0 for nothing, up to 3 for everything. */
  abstract readonly rank: number

  /** `value`, as the caller may see it. */
  abstract present(value: unknown): unknown

  abstract toJSON(): PresentationSpec

  /** Whichever of the two withholds more; this one when they withhold as much. */
  strictest(other: Presentation): Presentation {
    return other.rank > this.rank ? other : this
  }

  /** Shows the value as it is. */
  static get visible(): Presentation {
    return VISIBLE
  }

  /** Shows none of the value. */
  static get covered(): Presentation {
    return COVERED
  }

  /** Reads a presentation as written in a manifest or a `show` rule. Throws `InvalidPresentationError`. */
  static parse(raw: unknown, path: string): Presentation {
    if (raw === 'visible' || raw === 'covered') return KINDS[raw]({}, path)
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new InvalidPresentationError(
        `${path} must be "visible", "covered", or an object with a "kind"`,
      )
    }
    const spec = raw as Record<string, unknown>
    const parse = KINDS[spec.kind as Kind]
    if (!Object.hasOwn(KINDS, String(spec.kind)) || parse === undefined) {
      throw new InvalidPresentationError(
        `${path}.kind must be one of ${Object.keys(KINDS).join(', ')}`,
      )
    }
    return parse(spec, path)
  }
}

class Visible extends Presentation {
  readonly rank = 0

  present(value: unknown): unknown {
    return value
  }

  toJSON(): PresentationSpec {
    return 'visible'
  }
}

class Covered extends Presentation {
  readonly rank = 3

  present(): unknown {
    return MASK
  }

  toJSON(): PresentationSpec {
    return 'covered'
  }
}

/** The first or last `count` characters of a string or number; the rest masked. */
class PartialCharacters extends Presentation {
  readonly rank = 1

  constructor(
    private readonly keep: 'first' | 'last',
    private readonly count: number,
  ) {
    super()
  }

  present(value: unknown): unknown {
    if (typeof value !== 'string' && typeof value !== 'number') return MASK
    const text = String(value)
    // Keeping as many characters as there are would show it all.
    if (this.count >= text.length) return MASK
    return this.keep === 'first'
      ? `${text.slice(0, this.count)}${MASK}`
      : `${MASK}${text.slice(text.length - this.count)}`
  }

  toJSON(): PresentationSpec {
    return { kind: 'partial', keep: this.keep, count: this.count }
  }
}

/** An email with its local part masked: `••••••@example.com`. */
class PartialEmail extends Presentation {
  readonly rank = 1

  present(value: unknown): unknown {
    const domain = domainOf(value)
    return domain === undefined ? MASK : `${MASK}@${domain}`
  }

  toJSON(): PresentationSpec {
    return { kind: 'partial', form: 'email' }
  }
}

/** Something derived from the value instead of any of its characters. */
class Replacement extends Presentation {
  readonly rank = 2

  constructor(
    private readonly using: 'initials' | 'domain' | 'constant',
    private readonly derive: (value: unknown) => unknown,
    private readonly value?: string,
  ) {
    super()
  }

  present(value: unknown): unknown {
    return this.derive(value)
  }

  toJSON(): PresentationSpec {
    return this.using === 'constant'
      ? { kind: 'replacement', using: 'constant', value: this.value! }
      : { kind: 'replacement', using: this.using }
  }
}

/** `Ada Lovelace` → `A. L.` */
function initials(value: unknown): unknown {
  if (typeof value !== 'string') return MASK
  const words = value.trim().split(/\s+/).filter((word) => word.length > 0)
  if (words.length === 0) return MASK
  return words.map((word) => `${[...word][0].toUpperCase()}.`).join(' ')
}

function domainOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const at = value.lastIndexOf('@')
  if (at <= 0 || at === value.length - 1) return undefined
  return value.slice(at + 1)
}

type Kind = 'visible' | 'covered' | 'partial' | 'replacement'

/** How each kind is read from its spec. */
const KINDS: Readonly<
  Record<Kind, (spec: Record<string, unknown>, path: string) => Presentation>
> = {
  visible: () => VISIBLE,
  covered: () => COVERED,
  partial: (spec, path) => {
    if (spec.form !== undefined) {
      if (spec.form !== 'email') {
        throw new InvalidPresentationError(`${path}.form must be "email"`)
      }
      return new PartialEmail()
    }
    if (spec.keep !== 'first' && spec.keep !== 'last') {
      throw new InvalidPresentationError(
        `${path}.keep must be "first" or "last" (or give a "form")`,
      )
    }
    if (!Number.isInteger(spec.count) || (spec.count as number) < 1) {
      throw new InvalidPresentationError(
        `${path}.count must be a positive integer`,
      )
    }
    return new PartialCharacters(spec.keep, spec.count as number)
  },
  replacement: (spec, path) => {
    const derive = REPLACEMENTS[spec.using as keyof typeof REPLACEMENTS]
    if (!Object.hasOwn(REPLACEMENTS, String(spec.using)) || !derive) {
      throw new InvalidPresentationError(
        `${path}.using must be one of ${Object.keys(REPLACEMENTS).join(', ')}`,
      )
    }
    return derive(spec, path)
  },
}

/** How each replacement derives what it shows. */
const REPLACEMENTS = {
  initials: () => new Replacement('initials', initials),
  domain: () => new Replacement('domain', (value) => domainOf(value) ?? MASK),
  constant: (spec: Record<string, unknown>, path: string) => {
    if (typeof spec.value !== 'string') {
      throw new InvalidPresentationError(`${path}.value must be a string`)
    }
    const value = spec.value
    return new Replacement('constant', () => value, value)
  },
} as const

const VISIBLE = new Visible()
const COVERED = new Covered()

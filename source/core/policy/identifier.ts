const SEPARATOR = '.'

/**
 * A reference to a governing policy — a dotted path such as
 * `invoice.approve` that an `Engine` knows how to resolve and evaluate. The
 * path is the identifier's structure: adapters build whatever format they
 * need from `segments` rather than parsing text themselves. `Identifier`
 * never carries Rego source itself; that's the concern of whatever
 * implements `Engine`.
 */
export class Identifier {
  readonly segments: readonly string[]

  constructor(path: string) {
    const segments = path.split(SEPARATOR)
    if (segments.some((segment) => segment.trim().length === 0)) {
      throw new InvalidIdentifierError(
        `Policy identifier must be non-empty dot-separated segments, got "${path}"`,
      )
    }
    this.segments = segments
  }

  equals(other: Identifier): boolean {
    return this.toString() === other.toString()
  }

  toString(): string {
    return this.segments.join(SEPARATOR)
  }
}

export class InvalidIdentifierError extends Error {}

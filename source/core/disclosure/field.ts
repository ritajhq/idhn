import type { Presentation } from './presentation.ts'

export class InvalidFieldError extends Error {}

/** A reference token standing for every item of an array, or every value of an object. */
const EVERY = '*'

/**
 * Where a restricted value sits in a JSON answer: an RFC 6901 JSON Pointer
 * (`/data/query.result/value/user/email`), so keys holding dots or slashes
 * are reachable, extended with `*` for every item of a list
 * (`/users/*\/email`). A key that is literally `*` can't be addressed.
 */
export class Field {
  private constructor(
    /** The pointer as written. */
    readonly pointer: string,
    private readonly tokens: readonly string[],
  ) {}

  /** Throws `InvalidFieldError` unless `raw` is a JSON Pointer to something inside the document. */
  static parse(raw: unknown, path: string): Field {
    if (typeof raw !== 'string' || !raw.startsWith('/') || raw === '/') {
      throw new InvalidFieldError(
        `${path} must be a JSON Pointer to a field, such as "/user/email"`,
      )
    }
    const tokens = raw.slice(1).split('/').map((token) =>
      token.replaceAll('~1', '/').replaceAll('~0', '~')
    )
    return new Field(raw, tokens)
  }

  /** Presents every value this field points at in `document`, in place. Points at nothing: leaves it be. */
  presentIn(document: unknown, presentation: Presentation): void {
    this.visit(document, 0, presentation)
  }

  // Recursive: the document is a tree, and each token goes one level down.
  private visit(
    node: unknown,
    depth: number,
    presentation: Presentation,
  ): void {
    if (node === null || typeof node !== 'object') return
    const container = node as Record<string, unknown>
    const token = this.tokens[depth]
    const keys = token === EVERY ? Object.keys(container) : [token]
    const last = depth === this.tokens.length - 1
    for (const key of keys) {
      if (!Object.hasOwn(container, key)) continue
      if (last) container[key] = presentation.present(container[key])
      else this.visit(container[key], depth + 1, presentation)
    }
  }
}

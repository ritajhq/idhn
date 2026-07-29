/** Identifies what is being attempted — the thing a `Decision` is about. */
export class Action {
  readonly name: string

  constructor(name: string) {
    if (name.trim().length === 0) {
      throw new InvalidActionError('Action name must not be empty')
    }
    this.name = name
  }

  equals(other: Action): boolean {
    return this.name === other.name
  }

  toString(): string {
    return this.name
  }
}

export class InvalidActionError extends Error {}

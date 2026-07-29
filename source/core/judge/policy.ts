/**
 * A reference to a governing policy — an identifier a `PolicyEngine` knows
 * how to resolve and evaluate. `Policy` never carries Rego source itself;
 * that's the concern of whatever implements `PolicyEngine`.
 */
export class Policy {
  readonly id: string

  constructor(id: string) {
    if (id.trim().length === 0) {
      throw new InvalidPolicyError('Policy id must not be empty')
    }
    this.id = id
  }

  equals(other: Policy): boolean {
    return this.id === other.id
  }

  toString(): string {
    return this.id
  }
}

export class InvalidPolicyError extends Error {}

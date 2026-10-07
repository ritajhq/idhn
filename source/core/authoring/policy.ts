import * as Policies from '@idhn/policy'

/** Policy source that doesn't say which policy it is. */
export class InvalidPolicyError extends Error {}

/** `package shop.admin` — the line naming the policy a source declares. */
const PACKAGE_LINE =
  /^[ \t]*package[ \t]+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)[ \t]*(?:#.*)?$/m

/**
 * One policy as authored: its Rego source, and optionally its tests. Its name
 * is the package its source declares (`package shop.admin` is the policy
 * `shop.admin`), the name associations and judges know it by — so renaming a
 * policy is changing that line.
 */
export class Policy {
  private constructor(
    readonly name: Policies.Identifier,
    readonly source: string,
    readonly tests: string | undefined,
  ) {}

  /** Throws `InvalidPolicyError` unless `source` declares a package. */
  static write(source: string, tests?: string): Policy {
    const declared = PACKAGE_LINE.exec(source)?.[1]
    if (declared === undefined) {
      throw new InvalidPolicyError(
        'A policy starts by declaring its package, such as "package shop.admin": that is its name',
      )
    }
    const written = tests?.trim() ? tests : undefined
    return new Policy(new Policies.Identifier(declared), source, written)
  }

  /** Where its source sits in a source tree. */
  get sourcePath(): string {
    return `policies/${this.name}.rego`
  }

  /** Where its tests sit in a source tree, since the builder runs every `*_test.rego`. */
  get testsPath(): string {
    return `policies/${this.name}_test.rego`
  }
}

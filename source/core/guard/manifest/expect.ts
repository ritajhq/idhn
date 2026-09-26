import * as Access from '@idhn/access'

export class ManifestParseError extends Error {}

/**
 * `id` and action `name`s are joined with `.` and become Rego package/
 * entrypoint path segments (see `opa`'s `PolicyEngine`), and Rego
 * identifiers may only contain letters, digits, and underscores, and can't
 * start with a digit — so composite names must use `_`, not `-`.
 */
const REGO_SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

export function expectObject(
  raw: unknown,
  path: string,
): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ManifestParseError(`${path} must be an object`)
  }
  return raw as Record<string, unknown>
}

export function expectArray(raw: unknown, path: string): unknown[] {
  if (!Array.isArray(raw)) {
    throw new ManifestParseError(`${path} must be an array`)
  }
  return raw
}

export function expectString(raw: unknown, path: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new ManifestParseError(`${path} must be a non-empty string`)
  }
  return raw
}

export function expectRegoSafeIdentifier(raw: unknown, path: string): string {
  const value = expectString(raw, path)
  if (!REGO_SAFE_IDENTIFIER.test(value)) {
    throw new ManifestParseError(
      `${path} must contain only letters, digits, and underscores, and must not start with a digit (got "${value}") — composite names must use "_", not "-", since this value becomes a Rego package path segment`,
    )
  }
  return value
}

export function expectRegoSafeActionName(raw: unknown, path: string): string {
  const value = expectString(raw, path)
  const invalidSegment = value.split('.').find((segment) =>
    !REGO_SAFE_IDENTIFIER.test(segment)
  )
  if (invalidSegment !== undefined) {
    throw new ManifestParseError(
      `${path} segment "${invalidSegment}" must contain only letters, digits, and underscores, and must not start with a digit — composite names must use "_", not "-", since this value becomes a Rego package path segment`,
    )
  }
  return value
}

export function expectBoolean(raw: unknown, path: string): boolean {
  if (typeof raw !== 'boolean') {
    throw new ManifestParseError(`${path} must be a boolean`)
  }
  return raw
}

export function expectOneOf<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (
    typeof raw !== 'string' || !(allowed as readonly string[]).includes(raw)
  ) {
    throw new ManifestParseError(
      `${path} must be one of: ${allowed.join(', ')}`,
    )
  }
  return raw as T
}

/** A fact name a manifest may extract into: any non-empty string except the reserved `auth`, which only authentication writes. */
export function expectFactName(raw: unknown, path: string): string {
  const value = expectString(raw, path)
  if (value === Access.Identity.FACT) {
    throw new ManifestParseError(
      `${path} must not be "${Access.Identity.FACT}": that fact is reserved for the identity authentication reports`,
    )
  }
  return value
}

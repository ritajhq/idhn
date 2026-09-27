import { InvalidError } from './invalid-error.ts'
import type { Source } from './source.ts'

const MAX_PORT = 65535

/** Reads named settings from a `Source`, treating an empty value as unset and validating what it reads. Throws `InvalidError` on any missing or malformed setting. */
export class Reader {
  constructor(private readonly source: Source) {}

  requireString(name: string): string {
    const value = this.optionalString(name)
    if (value === undefined) {
      throw new InvalidError(`${name} must be set`)
    }
    return value
  }

  optionalString(name: string): string | undefined {
    const value = this.source.get(name)
    return value === undefined || value.length === 0 ? undefined : value
  }

  requireUrl(name: string): URL {
    return this.parseUrl(this.requireString(name), name)
  }

  optionalUrl(name: string): URL | undefined {
    const value = this.optionalString(name)
    return value === undefined ? undefined : this.parseUrl(value, name)
  }

  port(name: string, fallback: number): number {
    const value = this.optionalString(name)
    if (value === undefined) {
      return fallback
    }
    const port = Number(value)
    if (!Number.isInteger(port) || port <= 0 || port > MAX_PORT) {
      throw new InvalidError(
        `${name} must be a valid port number, got "${value}"`,
      )
    }
    return port
  }

  /** A positive number (a duration, a size), or `fallback` when unset. */
  positiveNumber(name: string, fallback: number): number {
    const value = this.optionalString(name)
    if (value === undefined) {
      return fallback
    }
    const number = Number(value)
    if (!Number.isFinite(number) || number <= 0) {
      throw new InvalidError(
        `${name} must be a positive number, got "${value}"`,
      )
    }
    return number
  }

  /** One of `values`, or `fallback` when unset. */
  oneOf<T extends string>(
    name: string,
    values: readonly T[],
    fallback: T,
  ): T {
    const value = this.optionalString(name)
    if (value === undefined) {
      return fallback
    }
    if (!(values as readonly string[]).includes(value)) {
      throw new InvalidError(
        `${name} must be one of ${values.join(', ')}, got "${value}"`,
      )
    }
    return value as T
  }

  private parseUrl(value: string, name: string): URL {
    try {
      return new URL(value)
    } catch {
      throw new InvalidError(`${name} must be a valid URL, got "${value}"`)
    }
  }
}

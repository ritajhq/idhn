import { parse as parseYaml } from '@std/yaml'
import { Identifier } from '../identifier.ts'

/**
 * Reads which policies govern which actions out of a registry document's YAML
 * text, keyed by action name:
 *
 *     associations:
 *       demo.home.visit:          # action name
 *         - demo.home.visit       # policies governing it
 *
 * Throws `MalformedFileError` for anything else.
 */
export class Associations {
  parse(text: string): Map<string, Identifier[]> {
    const associations = this.expectObject(
      this.expectObject(parseYaml(text), 'file').associations ?? {},
      'associations',
    )
    return new Map(
      Object.entries(associations).map(([action, policies]) => [
        action,
        this.expectArray(policies, `associations.${action}`).map((
          policy,
          index,
        ) =>
          new Identifier(
            this.expectString(policy, `associations.${action}[${index}]`),
          )
        ),
      ]),
    )
  }

  private expectObject(raw: unknown, path: string): Record<string, unknown> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new MalformedFileError(`${path} must be an object`)
    }
    return raw as Record<string, unknown>
  }

  private expectArray(raw: unknown, path: string): unknown[] {
    if (!Array.isArray(raw)) {
      throw new MalformedFileError(`${path} must be an array`)
    }
    return raw
  }

  private expectString(raw: unknown, path: string): string {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new MalformedFileError(`${path} must be a non-empty string`)
    }
    return raw
  }
}

export class MalformedFileError extends Error {}

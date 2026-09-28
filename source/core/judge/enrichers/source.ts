import { parse as parseYaml } from '@std/yaml'
import * as Access from '@idhn/access'
import type { Enricher } from '../enricher.ts'
import { Chain } from './chain.ts'
import { HttpLookup, type HttpLookupDefinition } from './http-lookup.ts'
import { Passthrough } from './passthrough.ts'

/** How long a lookup waits for its service's whole answer when its definition doesn't say. */
const DEFAULT_TIMEOUT_MS = 2000

export class InvalidDefinitionError extends Error {}

/**
 * Where a judge's enrichment lookups are declared — a YAML file — or
 * nowhere. `load()` builds the `Enricher` either way, a `Passthrough` when
 * nothing is configured, so nothing downstream handles "no enrichment".
 *
 *     lookups:
 *       - as: agent_directory            # fact name for the response
 *         actions: [billing.approve]     # optional; every action when omitted
 *         http:
 *           url: http://directory.internal/agents/{subject}
 *         ttl_seconds: 60                # optional; default 0 (no cache)
 *         timeout_ms: 2000               # optional; default 2000, then unavailable
 *         optional: false                # optional; default false (fail closed)
 */
export class Source {
  constructor(private readonly path: string | URL | undefined) {}

  async load(): Promise<Enricher> {
    if (this.path === undefined) {
      return new Passthrough()
    }
    return new Definitions().parse(await Deno.readTextFile(this.path))
  }
}

/**
 * Builds the `Enricher` a lookups document's YAML text declares (the shape
 * `Source` documents), wherever the text came from. Throws
 * `InvalidDefinitionError` for anything else.
 */
export class Definitions {
  parse(text: string): Enricher {
    const lookups = this.expectArray(
      this.expectObject(parseYaml(text), 'file').lookups,
      'lookups',
    )
    return new Chain(
      lookups.map((lookup, index) =>
        new HttpLookup(this.parseLookup(lookup, `lookups[${index}]`))
      ),
    )
  }

  private parseLookup(raw: unknown, path: string): HttpLookupDefinition {
    const lookup = this.expectObject(raw, path)
    const http = this.expectObject(lookup.http, `${path}.http`)
    return {
      as: this.expectFactName(lookup.as, `${path}.as`),
      actions: lookup.actions === undefined
        ? undefined
        : this.expectArray(lookup.actions, `${path}.actions`).map((
          action,
          index,
        ) => this.expectString(action, `${path}.actions[${index}]`)),
      url: this.expectString(http.url, `${path}.http.url`),
      ttlSeconds: lookup.ttl_seconds === undefined
        ? 0
        : this.expectNonNegativeNumber(
          lookup.ttl_seconds,
          `${path}.ttl_seconds`,
        ),
      timeoutMs: lookup.timeout_ms === undefined
        ? DEFAULT_TIMEOUT_MS
        : this.expectPositiveNumber(lookup.timeout_ms, `${path}.timeout_ms`),
      optional: lookup.optional === undefined
        ? false
        : this.expectBoolean(lookup.optional, `${path}.optional`),
    }
  }

  private expectObject(raw: unknown, path: string): Record<string, unknown> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new InvalidDefinitionError(`${path} must be an object`)
    }
    return raw as Record<string, unknown>
  }

  private expectArray(raw: unknown, path: string): unknown[] {
    if (!Array.isArray(raw)) {
      throw new InvalidDefinitionError(`${path} must be an array`)
    }
    return raw
  }

  private expectString(raw: unknown, path: string): string {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new InvalidDefinitionError(`${path} must be a non-empty string`)
    }
    return raw
  }

  private expectFactName(raw: unknown, path: string): string {
    const value = this.expectString(raw, path)
    if (value === Access.Identity.FACT) {
      throw new InvalidDefinitionError(
        `${path} must not be "${Access.Identity.FACT}": that fact is reserved for the identity authentication reports`,
      )
    }
    return value
  }

  private expectBoolean(raw: unknown, path: string): boolean {
    if (typeof raw !== 'boolean') {
      throw new InvalidDefinitionError(`${path} must be a boolean`)
    }
    return raw
  }

  private expectPositiveNumber(raw: unknown, path: string): number {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
      throw new InvalidDefinitionError(`${path} must be a positive number`)
    }
    return raw
  }

  private expectNonNegativeNumber(raw: unknown, path: string): number {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
      throw new InvalidDefinitionError(`${path} must be a non-negative number`)
    }
    return raw
  }
}

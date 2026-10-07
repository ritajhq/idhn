import * as Disclosure from '@idhn/disclosure'
import { Decision } from './records.ts'

/** What of `auth` is always kept: enough to attribute a decision. */
const ALWAYS_KEPT = ['status', 'subject']

/**
 * What of a decision's context the audit keeps in the clear. Every field of
 * the `auth` fact is covered except `status` and `subject`, unless kept by
 * name (`claims.role`, `issuer`); any other fact is covered where the
 * configured disclosure says (`/email`, `/card`). So the audit never holds
 * what a service's own logs shouldn't show, unless someone chose to keep it.
 */
export class Redaction {
  private readonly kept: ReadonlySet<string>

  constructor(
    keptAuth: readonly string[] = [],
    private readonly facts: Disclosure.Disclosure = Disclosure.Disclosure.none,
  ) {
    this.kept = new Set([...ALWAYS_KEPT, ...keptAuth])
  }

  apply(decision: Decision): Decision {
    const context = this.facts.apply(decision.context) as Record<
      string,
      unknown
    >
    if (context.auth !== undefined) {
      context.auth = this.cover(context.auth, '')
    }
    return new Decision(
      decision.recordId,
      decision.decisionId,
      decision.timestamp,
      decision.durationMs,
      decision.action,
      context,
      decision.outcome,
      decision.results,
      decision.error,
      decision.source,
    )
  }

  // Recursive: `auth` is a tree, and only its kept leaves stay in the clear.
  private cover(value: unknown, path: string): unknown {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return this.kept.has(path) ? value : Disclosure.MASK
    }
    if (this.kept.has(path)) return value
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        this.cover(inner, path === '' ? key : `${path}.${key}`),
      ]),
    )
  }
}

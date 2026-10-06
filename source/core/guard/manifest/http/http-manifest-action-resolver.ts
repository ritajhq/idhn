import * as Access from '@idhn/access'
import type { ActionResolver, ResolvedAction } from '../../action-resolver.ts'
import { extractContext } from './extract-context.ts'
import { matchRequest } from './match-request.ts'
import type { HttpManifest } from './schema.ts'

/**
 * An `ActionResolver` driven entirely by a declarative `Manifest`, matched
 * against a web-standard `Request`: tries each of the manifest's actions in
 * order, and resolves to the first whole match (method + path + header
 * criteria, and every non-optional `extract` entry present). Constructed
 * per-request with the `Manifest` (shared across requests) and the one
 * `Request` it's judging.
 */
export class HttpManifestActionResolver implements ActionResolver {
  constructor(
    private readonly manifest: HttpManifest,
    private readonly request: Request,
  ) {}

  async resolve(): Promise<ResolvedAction | null> {
    for (const manifestAction of this.manifest.actions) {
      const matchResult = matchRequest(manifestAction.match, this.request)
      if (matchResult === null) {
        continue
      }

      // Extraction may read the body, which a Request allows only once: it
      // reads a clone, leaving the original's body for the guard to forward
      // and for a later action to read again.
      const facts = manifestAction.extract === undefined
        ? {}
        : await extractContext(
          manifestAction.extract,
          this.request.clone(),
          matchResult,
        )
      if (facts === null) {
        continue
      }

      const action = new Access.Action(
        `${this.manifest.id}.${manifestAction.name}`,
      )
      return {
        action,
        context: new Access.Context(facts),
        restrictions: manifestAction.restrict,
      }
    }

    return null
  }
}

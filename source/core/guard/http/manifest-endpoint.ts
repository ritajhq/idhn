import * as Access from '@idhn/access'
import type * as Disclosure from '@idhn/disclosure'
import type { ActionResolver, ResolvedAction } from '../action-resolver.ts'
import { READ_MANIFEST } from '../manifest/reserved.ts'
import type { Manifest } from '../manifest/schema.ts'
import { writeManifest } from '../manifest/write-manifest.ts'
import type { Rejection } from '../rejection.ts'
import type { ServiceProvider } from '../service-provider.ts'
import type { RejectResponse } from './reject-responses/reject-response.ts'
import { RejectionAnswers } from './rejection-answers.ts'

/** Where every guard serves its manifest. */
export const MANIFEST_PATH = '/.well-known/idhn/manifest'

/** Whether `request` asks a guard for its manifest, rather than for the service behind it. */
export function asksForManifest(request: Request): boolean {
  return request.method === 'GET' &&
    new URL(request.url).pathname === MANIFEST_PATH
}

/**
 * Resolves a request for the guard's manifest to the reserved action
 * `<manifest id>.idhn.manifest.read`, with no facts: reading a manifest is
 * judged like any other action, so policies decide who may.
 */
export class ManifestActionResolver implements ActionResolver {
  constructor(private readonly manifest: Manifest) {}

  // deno-lint-ignore require-await
  async resolve(): Promise<ResolvedAction> {
    return {
      action: new Access.Action(`${this.manifest.id}.${READ_MANIFEST}`),
      context: new Access.Context({}),
    }
  }
}

/**
 * Answers an allowed request for the guard's manifest itself, as JSON in the
 * manifest's own syntax (see `writeManifest`), with any field a policy
 * restricts shown as it says. Nothing is forwarded to the protected service.
 * A rejection is answered as for any request (see `RejectionAnswers`).
 */
export class ManifestServiceProvider implements ServiceProvider {
  constructor(
    private readonly manifest: Manifest,
    private readonly resolve: (response: Response) => void,
    private readonly rejectResponse: RejectResponse,
  ) {}

  // deno-lint-ignore require-await
  async forward(
    _identity: Access.Identity,
    disclosure: Disclosure.Disclosure,
  ): Promise<void> {
    this.resolve(Response.json(disclosure.apply(writeManifest(this.manifest))))
  }

  // deno-lint-ignore require-await
  async reject(rejection: Rejection): Promise<void> {
    this.resolve(new RejectionAnswers(this.rejectResponse).answer(rejection))
  }
}

import * as Guard from '@idhn/guard'
import { Resource } from './resource.ts'

/** The guard answered, but would not hand its manifest to this caller. */
export class RefusedError extends Error {
  constructor(
    readonly rejection: 'unauthenticated' | 'forbidden',
    origin: URL,
  ) {
    super(
      rejection === 'unauthenticated'
        ? `The guard at ${origin.origin} wants you to sign in before reading its manifest`
        : `The guard at ${origin.origin} does not let you read its manifest`,
    )
  }
}

/** Nothing answered at that address, or not in time. */
export class UnreachableError extends Error {}

/** Something answered, but not with a guard's manifest. */
export class NotAGuardError extends Error {}

/** The statuses a guard refuses a caller with, and what each means. */
const REFUSALS: Readonly<Record<number, 'unauthenticated' | 'forbidden'>> = {
  401: 'unauthenticated',
  403: 'forbidden',
}

/** How long to wait for a guard's manifest when not told otherwise. */
const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Imports a resource from its guard: asks for the manifest every guard
 * serves at `Guard.MANIFEST_PATH`, presenting the caller's own credential
 * (its `cookie` and `authorization` headers), so the guard's policies decide
 * who may import it — the console has no identity of its own.
 */
export class Importer {
  constructor(
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Throws `RefusedError`, `UnreachableError` or `NotAGuardError`. */
  async import(origin: URL, credential: Headers): Promise<Resource> {
    const answer = await this.fetchManifest(origin, credential)
    const refusal = REFUSALS[answer.status]
    if (refusal !== undefined) {
      await answer.body?.cancel()
      throw new RefusedError(refusal, origin)
    }
    if (!answer.ok) {
      await answer.body?.cancel()
      throw new NotAGuardError(
        `${origin.origin} answered ${answer.status} for its manifest: is it an idhn guard?`,
      )
    }
    return new Resource(
      origin,
      this.now(),
      await this.manifestIn(answer, origin),
    )
  }

  private async fetchManifest(
    origin: URL,
    credential: Headers,
  ): Promise<Response> {
    const headers = new Headers({ accept: 'application/json' })
    for (const name of ['cookie', 'authorization']) {
      const value = credential.get(name)
      if (value !== null) headers.set(name, value)
    }
    try {
      return await fetch(new URL(Guard.MANIFEST_PATH, origin.origin), {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new UnreachableError(`Nothing answered at ${origin.origin}`, {
        cause: error,
      })
    }
  }

  private async manifestIn(
    answer: Response,
    origin: URL,
  ): Promise<Guard.Manifest> {
    try {
      return Guard.parseManifest(await answer.json())
    } catch (error) {
      throw new NotAGuardError(
        `${origin.origin} did not answer with a manifest: ${
          error instanceof Error ? error.message : error
        }`,
        { cause: error },
      )
    }
  }
}

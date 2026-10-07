import * as Authoring from '@idhn/authoring'
import * as Contract from '@idhn/contract'
import * as Resources from '@idhn/resources'

type ErrorClass = new (...args: never[]) => Error

/** How each refusal the console's core can make is told to the caller. */
const REASONS: readonly [ErrorClass, Contract.Reason][] = [
  [Authoring.InvalidPolicyError, 'invalid_policy'],
  [Authoring.UnknownPolicyError, 'unknown_policy'],
  [Authoring.StillGoverningError, 'still_governing'],
  [Authoring.UnknownRevisionError, 'unknown_revision'],
  [Authoring.RefusedError, 'does_not_build'],
  [Authoring.BuilderUnavailableError, 'builder_unavailable'],
  [Resources.NotAGuardError, 'not_a_guard'],
  [Resources.UnreachableError, 'guard_unreachable'],
]

const REFUSAL_REASONS: Readonly<
  Record<Resources.RefusedError['rejection'], Contract.Reason>
> = {
  unauthenticated: 'import_unauthenticated',
  forbidden: 'import_forbidden',
}

/**
 * Says a refusal from the console's core as the fault the caller gets — a
 * `Stale` draft, or `Rejected` with its reason and what there is to fix —
 * and anything else as it is, for horizon to answer as `Crashed`.
 */
export function asFault(error: unknown): unknown {
  if (error instanceof Authoring.StaleDraftError) {
    return new Contract.Stale(error.basedOn, error.current, error.message)
  }
  if (error instanceof Resources.RefusedError) {
    return new Contract.Rejected(
      REFUSAL_REASONS[error.rejection],
      error.message,
    )
  }
  const reason = REASONS.find(([type]) => error instanceof type)?.[1]
  if (reason === undefined) return error
  return new Contract.Rejected(
    reason,
    (error as Error).message,
    detailsOf(error),
  )
}

function detailsOf(error: unknown): readonly string[] {
  if (error instanceof Authoring.RefusedError) return error.problems
  if (error instanceof Authoring.StillGoverningError) return error.actions
  return []
}

/** `work`, with any refusal said as a fault. */
export async function refusing<T>(work: () => T | Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw asFault(error)
  }
}

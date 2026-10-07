import * as Horizon from '@ritaj/horizon'

/** Why a call was refused, for the caller to act on. */
export type Reason =
  | 'invalid_policy'
  | 'unknown_policy'
  | 'still_governing'
  | 'unknown_revision'
  | 'does_not_build'
  | 'builder_unavailable'
  | 'unknown_resource'
  | 'import_unauthenticated'
  | 'import_forbidden'
  | 'not_a_guard'
  | 'guard_unreachable'
  | 'invalid_query'

/**
 * The console refused a call for a reason the caller can act on: `Reason`
 * says which, the message says it for people, and `Details` lists what there
 * is to fix (every problem stopping policies from building, the actions a
 * policy still governs).
 */
export class Rejected extends Horizon.Fault {
  private readonly reason = this.c.String('', 'fault.rejected.reason')
  private readonly details = this.c.Object<string[]>(
    [],
    'fault.rejected.details',
  )

  constructor(reason?: Reason, message = '', details: readonly string[] = []) {
    super(message)
    if (reason === undefined) return
    this.reason.Write(reason)
    this.details.Write([...details])
  }

  get Reason(): Reason {
    return this.reason.Read() as Reason
  }

  get Details(): string[] {
    return this.details.Read()
  }
}

/** The draft changed since the caller read it: their change was not made, so nobody's is lost. */
export class Stale extends Horizon.Fault {
  private readonly basedOn = this.c.Number(0, 'fault.stale.based_on')
  private readonly current = this.c.Number(0, 'fault.stale.current')

  constructor(basedOn = 0, current = 0, message = '') {
    super(message)
    this.basedOn.Write(basedOn)
    this.current.Write(current)
  }

  get BasedOn(): number {
    return this.basedOn.Read()
  }

  get Current(): number {
    return this.current.Read()
  }
}

Horizon.Fault.Register(Rejected, '/idhn.rejected')
Horizon.Fault.Register(Stale, '/idhn.stale')

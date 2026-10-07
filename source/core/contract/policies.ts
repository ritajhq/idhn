import * as Horizon from '@ritaj/horizon'
import type { Rejected, Stale } from './faults.ts'

export interface PolicyView {
  name: string
  source: string
  tests?: string
  /** The actions it governs. */
  governs: string[]
}

/** The policy sources being worked on. */
export interface DraftView {
  revision: number
  policies: PolicyView[]
  /** Action → the policies governing it. */
  associations: Record<string, string[]>
}

export interface RevisionView {
  number: number
  version: string
  publishedAt: string
  publishedBy: string
  draftRevision: number
  /** The source tree published; only when one revision is asked for. */
  files?: Record<string, string>
}

/** The draft. */
export class Draft extends Horizon.Query<DraftView> {}

/** A change to the draft, made only if it is still at revision `basedOn`. */
class Change extends Horizon.Action<DraftView, Rejected | Stale> {
  private readonly basedOn = this.c.Number(0, 'policies.based_on')

  constructor(basedOn = 0) {
    super()
    this.basedOn.Write(basedOn)
  }

  get BasedOn(): number {
    return this.basedOn.Read()
  }
}

/** Writes a policy, new or changed; in place of `replacing` when its package was renamed. */
export class Write extends Change {
  private readonly source = this.c.String('', 'policies.write.source')
  private readonly tests = this.c.String('', 'policies.write.tests')
  private readonly replacing = this.c.String('', 'policies.write.replacing')

  constructor(basedOn = 0, source = '', tests = '', replacing = '') {
    super(basedOn)
    this.source.Write(source)
    this.tests.Write(tests)
    this.replacing.Write(replacing)
  }

  get Source(): string {
    return this.source.Read()
  }

  get Tests(): string | undefined {
    return this.tests.Read() || undefined
  }

  get Replacing(): string | undefined {
    return this.replacing.Read() || undefined
  }
}

/** Removes a policy that governs nothing any more. */
export class Remove extends Change {
  private readonly name = this.c.String('', 'policies.remove.name')

  constructor(basedOn = 0, name = '') {
    super(basedOn)
    this.name.Write(name)
  }

  get Name(): string {
    return this.name.Read()
  }
}

/** An action and a policy, as associating or dissociating them takes. */
class Pairing extends Change {
  private readonly action = this.c.String('', 'policies.pairing.action')
  private readonly policy = this.c.String('', 'policies.pairing.policy')

  constructor(basedOn = 0, action = '', policy = '') {
    super(basedOn)
    this.action.Write(action)
    this.policy.Write(policy)
  }

  get Action(): string {
    return this.action.Read()
  }

  get Policy(): string {
    return this.policy.Read()
  }
}

/** Lets a policy govern an action too. */
export class Associate extends Pairing {}

/** Stops a policy governing an action. */
export class Dissociate extends Pairing {}

/** Puts back the sources of a revision published before. */
export class Restore extends Change {
  private readonly number = this.c.Number(0, 'policies.restore.number')

  constructor(basedOn = 0, number = 0) {
    super(basedOn)
    this.number.Write(number)
  }

  get Number(): number {
    return this.number.Read()
  }
}

/** Every problem that would stop the draft at `revision` from building; none when it would. */
export class Check extends Horizon.Query<string[], Rejected> {
  private readonly revision = this.c.Number(0, 'policies.check.revision')

  constructor(revision = 0) {
    super()
    this.revision.Write(revision)
  }
}

/** Publishes the draft for judges to pull, as the next revision. */
export class Publish extends Horizon.Action<RevisionView, Rejected> {}

/** Every revision published, newest first. */
export class Revisions extends Horizon.Query<RevisionView[]> {}

/** One revision, with the sources it published. */
export class Revision extends Horizon.Query<RevisionView, Rejected> {
  private readonly number = this.c.Number(0, 'policies.revision.number')

  constructor(number = 0) {
    super()
    this.number.Write(number)
  }

  get Number(): number {
    return this.number.Read()
  }
}

Horizon.Query.Register(Draft, '/policies.draft')
Horizon.Action.Register(Write, '/policies.write')
Horizon.Action.Register(Remove, '/policies.remove')
Horizon.Action.Register(Associate, '/policies.associate')
Horizon.Action.Register(Dissociate, '/policies.dissociate')
Horizon.Action.Register(Restore, '/policies.restore')
Horizon.Query.Register(Check, '/policies.check')
Horizon.Action.Register(Publish, '/policies.publish')
Horizon.Query.Register(Revisions, '/policies.revisions')
Horizon.Query.Register(Revision, '/policies.revision')

import * as Horizon from '@ritaj/horizon'
import { Change } from './change.ts'

export interface LookupView {
  /** The fact policies read the answer as: `input.<name>`. */
  name: string
  url: string
  ttlSeconds: number
  /** The judge's default when absent. */
  timeoutMs?: number
  optional: boolean
  /** The policies it provides its fact to. */
  providesTo: string[]
  /** The actions a judge makes it for: every one those policies govern. */
  madeFor: string[]
}

/** Writes a lookup, new or changed; in place of `replacing` when it was renamed. */
export class Write extends Change {
  private readonly name = this.c.String('', 'lookups.write.name')
  private readonly url = this.c.String('', 'lookups.write.url')
  private readonly ttlSeconds = this.c.Number(0, 'lookups.write.ttl_seconds')
  // 0: the judge's default.
  private readonly timeoutMs = this.c.Number(0, 'lookups.write.timeout_ms')
  private readonly optional = this.c.Boolean(false, 'lookups.write.optional')
  private readonly replacing = this.c.String('', 'lookups.write.replacing')

  constructor(
    basedOn = 0,
    lookup: Omit<LookupView, 'providesTo' | 'madeFor'> = {
      name: '',
      url: '',
      ttlSeconds: 0,
      optional: false,
    },
    replacing = '',
  ) {
    super(basedOn)
    this.name.Write(lookup.name)
    this.url.Write(lookup.url)
    this.ttlSeconds.Write(lookup.ttlSeconds)
    this.timeoutMs.Write(lookup.timeoutMs ?? 0)
    this.optional.Write(lookup.optional)
    this.replacing.Write(replacing)
  }

  get Name(): string {
    return this.name.Read()
  }

  get Url(): string {
    return this.url.Read()
  }

  get TtlSeconds(): number {
    return this.ttlSeconds.Read()
  }

  get TimeoutMs(): number | undefined {
    return this.timeoutMs.Read() || undefined
  }

  get Optional(): boolean {
    return this.optional.Read()
  }

  get Replacing(): string | undefined {
    return this.replacing.Read() || undefined
  }
}

/** Removes a lookup that provides to no policy any more. */
export class Remove extends Change {
  private readonly name = this.c.String('', 'lookups.remove.name')

  constructor(basedOn = 0, name = '') {
    super(basedOn)
    this.name.Write(name)
  }

  get Name(): string {
    return this.name.Read()
  }
}

/** A lookup and a policy, as providing or withdrawing takes. */
class Provision extends Change {
  private readonly lookup = this.c.String('', 'lookups.provision.lookup')
  private readonly policy = this.c.String('', 'lookups.provision.policy')

  constructor(basedOn = 0, lookup = '', policy = '') {
    super(basedOn)
    this.lookup.Write(lookup)
    this.policy.Write(policy)
  }

  get Lookup(): string {
    return this.lookup.Read()
  }

  get Policy(): string {
    return this.policy.Read()
  }
}

/** Lets a lookup provide its fact to a policy too, for every action it governs. */
export class Provide extends Provision {}

/** Stops a lookup providing to a policy. */
export class Withdraw extends Provision {}

Horizon.Action.Register(Write, '/lookups.write')
Horizon.Action.Register(Remove, '/lookups.remove')
Horizon.Action.Register(Provide, '/lookups.provide')
Horizon.Action.Register(Withdraw, '/lookups.withdraw')

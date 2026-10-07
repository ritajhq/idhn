import * as Horizon from '@ritaj/horizon'
import type { Rejected } from './faults.ts'

/** One action of a resource, by the name judges know it by. */
export interface ActionView {
  name: string
  /** An action every guard answers itself (reading its manifest). */
  builtIn: boolean
  /** How a request is recognized as it, in the manifest's syntax; none for a built-in action. */
  match?: Record<string, unknown>
  /** Each restricted field and how it is shown by default; none when nothing is restricted. */
  restrictions?: Record<string, unknown>
}

export interface ResourceView {
  id: string
  origin: string
  importedAt: string
  protocol: string
  authentication: string
  actions: ActionView[]
  /** The whole manifest, in its own syntax. */
  manifest: Record<string, unknown>
}

/** Every resource imported so far. */
export class List extends Horizon.Query<ResourceView[]> {}

/** Imports a resource from its guard, presenting the caller's own credential, or re-imports it. */
export class Import extends Horizon.Action<ResourceView, Rejected> {
  private readonly origin = this.c.String('', 'resources.import.origin')

  constructor(origin = '') {
    super()
    this.origin.Write(origin)
  }

  get Origin(): string {
    return this.origin.Read()
  }
}

/** Forgets a resource; its associations stay with the policies. */
export class Remove extends Horizon.Action<undefined, Rejected> {
  private readonly id = this.c.String('', 'resources.remove.id')

  constructor(id = '') {
    super()
    this.id.Write(id)
  }

  get Id(): string {
    return this.id.Read()
  }
}

Horizon.Query.Register(List, '/resources.list')
Horizon.Action.Register(Import, '/resources.import')
Horizon.Action.Register(Remove, '/resources.remove')

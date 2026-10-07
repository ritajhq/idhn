import type * as Disclosure from '@idhn/disclosure'
import * as Guard from '@idhn/guard'

/** One action of a resource, by the name judges know it by (`<manifest id>.<action>`). */
export interface Action {
  readonly name: string
  /** What its answer restricts by default; none when nothing is. */
  readonly restrictions: Disclosure.Disclosure | undefined
  /** An action every guard answers itself (reading its manifest), not one the service declared. */
  readonly builtIn: boolean
}

/** A `Resource` as stored and sent: its manifest in the manifest's own syntax. */
export interface ResourceDocument {
  readonly origin: string
  readonly importedAt: string
  readonly manifest: Record<string, unknown>
}

/**
 * One service behind a guard, as last imported from that guard: its
 * manifest, the guard's origin it came from, and when. Re-importing it
 * replaces it, so it is always what the guard held at `importedAt`.
 */
export class Resource {
  constructor(
    readonly origin: URL,
    readonly importedAt: Date,
    readonly manifest: Guard.Manifest,
  ) {}

  static fromDocument(document: ResourceDocument): Resource {
    return new Resource(
      new URL(document.origin),
      new Date(document.importedAt),
      Guard.parseManifest(document.manifest),
    )
  }

  /** The manifest's id: what every one of its action names starts with. */
  get id(): string {
    return this.manifest.id
  }

  /** Every action policies can govern, the one reading its manifest included. */
  get actions(): Action[] {
    return [
      ...this.manifest.actions.map((action) => ({
        name: `${this.id}.${action.name}`,
        restrictions: action.restrict,
        builtIn: false,
      })),
      {
        name: `${this.id}.${Guard.READ_MANIFEST}`,
        restrictions: undefined,
        builtIn: true,
      },
    ]
  }

  toDocument(): ResourceDocument {
    return {
      origin: this.origin.origin,
      importedAt: this.importedAt.toISOString(),
      manifest: Guard.writeManifest(this.manifest),
    }
  }
}

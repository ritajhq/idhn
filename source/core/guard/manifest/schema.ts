import type { HttpManifest } from './http/schema.ts'

/**
 * Every protocol a manifest can declare actions for, mapped to that
 * protocol's manifest shape. A new protocol adds one entry here, one parser
 * in `parse-manifest.ts`, and its own resolver — nothing existing changes.
 */
export interface ProtocolManifests {
  http: HttpManifest
}

export type Protocol = keyof ProtocolManifests

/** A service's declared actions: how to recognize them on one protocol, and what context to extract. */
export type Manifest<P extends Protocol = Protocol> = ProtocolManifests[P]

/**
 * Everything a judge is made of, as one immutable value: the compiled policy
 * bundle, the registry of which policies govern which actions, and optionally
 * the enrichment lookups and the reference `data` document, each as the text
 * of its document. `version` says where it came from (a commit, a content
 * hash) — for people reading logs, never compared by code.
 *
 * It travels from a policy builder to the judges that pull it; each judge
 * builds its own judge from it.
 */
export class PolicySet {
  constructor(
    readonly version: string,
    readonly bundle: Uint8Array,
    readonly registry: string,
    readonly enrichment: string | undefined = undefined,
    readonly data: string | undefined = undefined,
  ) {}
}

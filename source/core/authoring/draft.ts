import { parse as parseYaml, stringify as stringifyYaml } from '@std/yaml'
import { Enrichment, ENRICHMENT_PATH } from './enrichment.ts'
import { Lookup, type LookupDocument } from './lookup.ts'
import { Policy } from './policy.ts'

/** A policy the draft has none of. */
export class UnknownPolicyError extends Error {}

/** A lookup the draft has none of. */
export class UnknownLookupError extends Error {}

/** A lookup that can't be removed while it still provides to policies. */
export class StillProvidingError extends Error {
  constructor(readonly lookup: string, readonly policies: readonly string[]) {
    super(
      `${lookup} still provides to ${
        policies.join(', ')
      }: withdraw it from them first`,
    )
  }
}

/** A policy that can't be removed while actions are still governed by it. */
export class StillGoverningError extends Error {
  constructor(readonly policy: string, readonly actions: readonly string[]) {
    super(
      `${policy} still governs ${
        actions.join(', ')
      }: dissociate it from them first`,
    )
  }
}

/** Files of a source tree the console keeps as they are, without editing them. */
const KEPT_AS_IS = ['data.json'] as const

/** The registry's path in a source tree. */
const ASSOCIATIONS_PATH = 'policies.yaml'

const TEST_SUFFIX = '_test.rego'

/** A `Draft` as stored. */
export interface DraftDocument {
  readonly revision: number
  readonly policies: readonly { source: string; tests?: string }[]
  readonly associations: Readonly<Record<string, readonly string[]>>
  /** Absent from drafts saved before the console authored lookups. */
  readonly lookups?: readonly LookupDocument[]
  /** Lookup → the policies it provides to. */
  readonly provisions?: Readonly<Record<string, readonly string[]>>
  readonly keptAsIs: Readonly<Record<string, string>>
}

const ENRICHMENT = new Enrichment()

/**
 * The policy sources being worked on, shared by everyone authoring them:
 * the policies, which of them govern which actions, the lookups and which
 * policies each provides its fact to, and the files the console keeps
 * without editing (`data.json`). Exactly what the policy builder takes, as
 * `files()`, where each lookup is made for the actions its policies govern
 * (see `Enrichment`).
 *
 * Each saved change makes a new `revision`, so an author editing a revision
 * someone else has since changed is told so instead of overwriting them
 * (see `Workspace.edit`).
 */
export class Draft {
  private constructor(
    readonly revision: number,
    private policies: Map<string, Policy>,
    private associations: Map<string, Set<string>>,
    private lookups: Map<string, Lookup>,
    private provisions: Map<string, Set<string>>,
    private keptAsIs: Map<string, string>,
  ) {}

  static empty(): Draft {
    return new Draft(0, new Map(), new Map(), new Map(), new Map(), new Map())
  }

  static fromDocument(document: DraftDocument): Draft {
    const draft = new Draft(
      document.revision,
      new Map(
        document.policies.map(({ source, tests }) => {
          const policy = Policy.write(source, tests)
          return [policy.name.toString(), policy]
        }),
      ),
      new Map(
        Object.entries(document.associations).map((
          [action, policies],
        ) => [action, new Set(policies)]),
      ),
      new Map(
        (document.lookups ?? []).map((
          lookup,
        ) => [lookup.name, Lookup.fromDocument(lookup)]),
      ),
      new Map(
        Object.entries(document.provisions ?? {}).map((
          [lookup, policies],
        ) => [lookup, new Set(policies)]),
      ),
      new Map(
        Object.entries(document.keptAsIs).filter(([path]) =>
          path !== ENRICHMENT_PATH
        ),
      ),
    )
    // Saved before the console authored lookups: they were kept as a file.
    const kept = document.keptAsIs[ENRICHMENT_PATH]
    if (document.lookups === undefined && kept !== undefined) {
      draft.adoptLookups(kept)
    }
    return draft
  }

  /** Every policy, by name. */
  get all(): Policy[] {
    return [...this.policies.values()].sort((a, b) =>
      a.name.toString().localeCompare(b.name.toString())
    )
  }

  policy(name: string): Policy | undefined {
    return this.policies.get(name)
  }

  /** The policies governing `action`, by name. */
  governing(action: string): string[] {
    return [...this.associations.get(action) ?? []].sort()
  }

  /** Every lookup, by name. */
  get allLookups(): Lookup[] {
    return [...this.lookups.values()].sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  }

  /** The policies `lookup` provides its fact to, by name. */
  providedTo(lookup: string): string[] {
    return [...this.provisions.get(lookup) ?? []].sort()
  }

  /** The lookups providing `policy` their facts, by name. */
  providing(policy: string): string[] {
    return [...this.provisions]
      .filter(([, policies]) => policies.has(policy))
      .map(([lookup]) => lookup)
      .sort()
  }

  /** The actions a judge makes `lookup` for: every one its policies govern. */
  madeFor(lookup: string): string[] {
    return [
      ...new Set(
        this.providedTo(lookup).flatMap((policy) => this.governedBy(policy)),
      ),
    ].sort()
  }

  /** The actions `policy` governs. */
  governedBy(policy: string): string[] {
    return [...this.associations]
      .filter(([, policies]) => policies.has(policy))
      .map(([action]) => action)
      .sort()
  }

  /**
   * Adds `policy`, or replaces the one of the same name. Written in place of
   * `replacing` under another name (its `package` line changed), it is that
   * policy renamed: it governs what that one did, and that one is gone.
   * Throws `UnknownPolicyError` when there is no `replacing`.
   */
  write(policy: Policy, replacing?: string): void {
    const name = policy.name.toString()
    if (replacing !== undefined && replacing !== name) {
      this.known(replacing)
      for (const action of this.governedBy(replacing)) {
        this.dissociate(action, replacing)
        const policies = this.associations.get(action) ?? new Set()
        this.associations.set(action, policies.add(name))
      }
      for (const lookup of this.providing(replacing)) {
        this.withdraw(lookup, replacing)
        const policies = this.provisions.get(lookup) ?? new Set()
        this.provisions.set(lookup, policies.add(name))
      }
      this.policies.delete(replacing)
    }
    this.policies.set(name, policy)
  }

  /**
   * Throws `UnknownPolicyError`, or `StillGoverningError` while it governs
   * any action. The lookups providing to it, which governing nothing it no
   * longer gets, stop providing to it.
   */
  remove(name: string): void {
    this.known(name)
    const actions = this.governedBy(name)
    if (actions.length > 0) throw new StillGoverningError(name, actions)
    for (const lookup of this.providing(name)) this.withdraw(lookup, name)
    this.policies.delete(name)
  }

  /**
   * Adds `lookup`, or replaces the one of the same name. Written in place of
   * `replacing` under another name, it is that lookup renamed: it provides
   * to whom that one did, and that one is gone. Throws `UnknownLookupError`
   * when there is no `replacing`.
   */
  writeLookup(lookup: Lookup, replacing?: string): void {
    if (replacing !== undefined && replacing !== lookup.name) {
      this.knownLookup(replacing)
      const policies = this.provisions.get(replacing)
      this.provisions.delete(replacing)
      if (policies !== undefined) this.provisions.set(lookup.name, policies)
      this.lookups.delete(replacing)
    }
    this.lookups.set(lookup.name, lookup)
  }

  /** Throws `UnknownLookupError`, or `StillProvidingError` while it provides to any policy. */
  removeLookup(name: string): void {
    this.knownLookup(name)
    const policies = this.providedTo(name)
    if (policies.length > 0) throw new StillProvidingError(name, policies)
    this.lookups.delete(name)
  }

  /** Lets `lookup` provide its fact to `policy` too. Throws `UnknownLookupError` or `UnknownPolicyError`. */
  provide(lookup: string, policy: string): void {
    this.knownLookup(lookup)
    this.known(policy)
    const policies = this.provisions.get(lookup) ?? new Set()
    this.provisions.set(lookup, policies.add(policy))
  }

  /** Stops `lookup` providing to `policy`; a no-op if it didn't. */
  withdraw(lookup: string, policy: string): void {
    const policies = this.provisions.get(lookup)
    policies?.delete(policy)
    if (policies?.size === 0) this.provisions.delete(lookup)
  }

  /** Lets `policy` govern `action` too. Throws `UnknownPolicyError`. */
  associate(action: string, policy: string): void {
    this.known(policy)
    const policies = this.associations.get(action) ?? new Set()
    this.associations.set(action, policies.add(policy))
  }

  /** Stops `policy` governing `action`; a no-op if it didn't. */
  dissociate(action: string, policy: string): void {
    const policies = this.associations.get(action)
    policies?.delete(policy)
    if (policies?.size === 0) this.associations.delete(action)
  }

  /** Replaces everything with the source tree `files` (a revision published before, say). */
  restore(files: Readonly<Record<string, string>>): void {
    const sources = Object.entries(files).filter(([path]) =>
      path.startsWith('policies/') && path.endsWith('.rego') &&
      !path.endsWith(TEST_SUFFIX)
    )
    this.policies = new Map(sources.map(([path, source]) => {
      const tests = files[path.replace(/\.rego$/, TEST_SUFFIX)]
      const policy = Policy.write(source, tests)
      return [policy.name.toString(), policy]
    }))
    this.associations = this.associationsIn(files[ASSOCIATIONS_PATH])
    this.lookups = new Map()
    this.provisions = new Map()
    const enrichment = files[ENRICHMENT_PATH]
    if (enrichment !== undefined) this.adoptLookups(enrichment)
    this.keptAsIs = new Map(
      KEPT_AS_IS.filter((path) => files[path] !== undefined)
        .map((path) => [path, files[path]]),
    )
  }

  /** The source tree, path → content, as the policy builder takes it. */
  files(): Record<string, string> {
    const files: Record<string, string> = {}
    for (const policy of this.all) {
      files[policy.sourcePath] = policy.source
      if (policy.tests !== undefined) files[policy.testsPath] = policy.tests
    }
    files[ASSOCIATIONS_PATH] = stringifyYaml({
      associations: Object.fromEntries(
        [...this.associations.keys()].sort().map((action) => [
          action,
          this.governing(action),
        ]),
      ),
    })
    const enrichment = ENRICHMENT.write(
      this.allLookups.map((lookup) => ({
        lookup,
        providesTo: this.providedTo(lookup.name),
        actions: this.madeFor(lookup.name),
      })),
    )
    if (enrichment !== undefined) files[ENRICHMENT_PATH] = enrichment
    for (const [path, content] of this.keptAsIs) files[path] = content
    return files
  }

  toDocument(): DraftDocument {
    return {
      revision: this.revision,
      policies: this.all.map((policy) => ({
        source: policy.source,
        ...(policy.tests === undefined ? {} : { tests: policy.tests }),
      })),
      associations: Object.fromEntries(
        [...this.associations.keys()].map((action) => [
          action,
          this.governing(action),
        ]),
      ),
      lookups: this.allLookups.map((lookup) => lookup.toDocument()),
      provisions: Object.fromEntries(
        [...this.provisions.keys()].map((lookup) => [
          lookup,
          this.providedTo(lookup),
        ]),
      ),
      keptAsIs: Object.fromEntries(this.keptAsIs),
    }
  }

  /** This draft, saved as the revision after it. */
  next(): Draft {
    return new Draft(
      this.revision + 1,
      this.policies,
      this.associations,
      this.lookups,
      this.provisions,
      this.keptAsIs,
    )
  }

  private known(name: string): void {
    if (!this.policies.has(name)) {
      throw new UnknownPolicyError(`There is no policy ${name}`)
    }
  }

  private knownLookup(name: string): void {
    if (!this.lookups.has(name)) {
      throw new UnknownLookupError(`There is no lookup ${name}`)
    }
  }

  /** Takes up the lookups an enrichment file declares; one naming a policy the draft has none of doesn't provide to it. */
  private adoptLookups(text: string): void {
    for (const { lookup, providesTo } of ENRICHMENT.read(text)) {
      this.lookups.set(lookup.name, lookup)
      const known = providesTo.filter((policy) => this.policies.has(policy))
      if (known.length > 0) this.provisions.set(lookup.name, new Set(known))
    }
  }

  private associationsIn(text: string | undefined): Map<string, Set<string>> {
    if (text === undefined) return new Map()
    const raw = parseYaml(text) as {
      associations?: Record<string, string[]>
    } | null
    return new Map(
      Object.entries(raw?.associations ?? {}).map((
        [action, policies],
      ) => [action, new Set(policies)]),
    )
  }
}

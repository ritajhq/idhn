import { parse as parseYaml, stringify as stringifyYaml } from '@std/yaml'
import { Policy } from './policy.ts'

/** A policy the draft has none of. */
export class UnknownPolicyError extends Error {}

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
const KEPT_AS_IS = ['enrichment.yaml', 'data.json'] as const

/** The registry's path in a source tree. */
const ASSOCIATIONS_PATH = 'policies.yaml'

const TEST_SUFFIX = '_test.rego'

/** A `Draft` as stored. */
export interface DraftDocument {
  readonly revision: number
  readonly policies: readonly { source: string; tests?: string }[]
  readonly associations: Readonly<Record<string, readonly string[]>>
  readonly keptAsIs: Readonly<Record<string, string>>
}

/**
 * The policy sources being worked on, shared by everyone authoring them:
 * the policies, which of them govern which actions, and the files the
 * console keeps without editing (`enrichment.yaml`, `data.json`). Exactly
 * what the policy builder takes, as `files()`.
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
    private keptAsIs: Map<string, string>,
  ) {}

  static empty(): Draft {
    return new Draft(0, new Map(), new Map(), new Map())
  }

  static fromDocument(document: DraftDocument): Draft {
    return new Draft(
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
      new Map(Object.entries(document.keptAsIs)),
    )
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
      this.policies.delete(replacing)
    }
    this.policies.set(name, policy)
  }

  /** Throws `UnknownPolicyError`, or `StillGoverningError` while it governs any action. */
  remove(name: string): void {
    this.known(name)
    const actions = this.governedBy(name)
    if (actions.length > 0) throw new StillGoverningError(name, actions)
    this.policies.delete(name)
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
      keptAsIs: Object.fromEntries(this.keptAsIs),
    }
  }

  /** This draft, saved as the revision after it. */
  next(): Draft {
    return new Draft(
      this.revision + 1,
      this.policies,
      this.associations,
      this.keptAsIs,
    )
  }

  private known(name: string): void {
    if (!this.policies.has(name)) {
      throw new UnknownPolicyError(`There is no policy ${name}`)
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
